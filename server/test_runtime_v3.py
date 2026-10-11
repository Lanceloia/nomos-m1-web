import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from server.runtime import ENGINE_ROOT, WORLD_BUNDLE, provenance, world_hashes
from nomos_c0.source_bundle_v1 import read_source_bundle
from server.bridge import Bridge, ApiError

class RuntimeV3Tests(unittest.TestCase):
    def test_origins_and_release_bundle_are_explicit(self):
        meta = provenance()
        self.assertEqual(meta['engineRevision'], meta['worldSourceRevision'])
        self.assertEqual(meta['worldBundle'], str(WORLD_BUNDLE))
        self.assertIn('model.lib.yaml', meta['worldHashes'])
        self.assertIn('source/control/seats.yaml', meta['worldHashes'])
        self.assertEqual(meta['worldHashes'], world_hashes(read_source_bundle(WORLD_BUNDLE)))
        self.assertTrue(meta['importOrigins'])
        self.assertTrue(all(Path(p).is_relative_to(ENGINE_ROOT) for p in meta['importOrigins'].values()))
        self.assertIn('nomos_examples', meta['importOrigins'])

    def test_mutable_import_origin_is_not_silently_accepted(self):
        with patch.dict('sys.modules', {'nomos_c0.invalid': SimpleNamespace(__file__='/mutable/nomos_c0.py')}):
            with self.assertRaises(RuntimeError): provenance()

    def test_foreign_world_dependency_is_rejected(self):
        bundle = read_source_bundle(WORLD_BUNDLE)
        foreign = SimpleNamespace(lib=SimpleNamespace(file='/tmp/foreign.lib.yaml'),
                                  ports=bundle.ports, assets=bundle.assets, source=bundle.source)
        with self.assertRaises(RuntimeError): world_hashes(foreign)

    def test_provenance_uses_the_compilation_input_snapshot(self):
        bundle = read_source_bundle(WORLD_BUNDLE)
        with patch('server.runtime.Path.read_bytes', side_effect=AssertionError('must not reread live files')):
            hashes = world_hashes(bundle)
        self.assertEqual(hashes['model.lib.yaml'], bundle.lib.digest)

    def test_foreign_examples_bundle_is_rejected_before_compile(self):
        with patch('server.bridge.everflame_bundle_path', return_value=Path('/tmp/foreign/world.bundle.yaml')):
            from server.bridge import compile_m1
            with self.assertRaises(RuntimeError): compile_m1()

    def test_loading_and_load_error_are_not_world_refusals(self):
        bridge = Bridge(None, None)
        for state in ('loading', 'error'):
            bridge.state = state
            with self.assertRaises(ApiError) as error: bridge.create('start')
            self.assertEqual(error.exception.status, 503)
            self.assertEqual(bridge.games, {})
