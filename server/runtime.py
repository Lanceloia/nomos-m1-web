"""Release checkout selection and diagnostic input provenance, not a security seal."""
import os
from pathlib import Path
import subprocess
import sys
import yaml

ENGINE_ROOT = Path(os.environ.get(
    'NOMOS_ENGINE_ROOT', str(Path(__file__).resolve().parents[2] / 'nomosengine2-release'))).resolve()
WORLD_ROOT = ENGINE_ROOT / 'src/nomos_examples/everflame'
WORLD_BUNDLE = WORLD_ROOT / 'world.bundle.yaml'


def install_roots():
    if not (ENGINE_ROOT / 'src/nomos_examples/__init__.py').is_file():
        raise RuntimeError('NOMOS_ENGINE_ROOT must select the release checkout with nomos_examples')
    sys.path[:0] = [str(ENGINE_ROOT / 'src'), str(ENGINE_ROOT / 'engine/kernel/src')]


def world_hashes(bundle):
    documents = (bundle.lib, bundle.ports, bundle.assets,
                 bundle.source.manifest, *bundle.source.parts)
    result = {}
    for document in documents:
        path = Path(document.file).resolve()
        if not path.is_relative_to(WORLD_ROOT):
            raise RuntimeError('World dependency escaped the release bundle: ' + str(path))
        result[str(path.relative_to(WORLD_ROOT))] = document.digest
    return result


def provenance(bundle=None):
    from nomos_examples import everflame_bundle_path
    from nomos_c0.source_bundle_v1 import read_source_bundle

    revision = subprocess.check_output(
        ['git', '-C', str(ENGINE_ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    origins = {}
    for name, module in tuple(sys.modules.items()):
        if name.split('.')[0] not in ('nomos_c0', 'nomos_kernel', 'nomos_examples'):
            continue
        origin = getattr(module, '__file__', None)
        if origin:
            path = Path(origin).resolve()
            if not path.is_relative_to(ENGINE_ROOT):
                raise RuntimeError('Runtime import escaped the release checkout: ' + name)
            origins[name] = str(path)
    selected = everflame_bundle_path().resolve()
    if selected != WORLD_BUNDLE.resolve():
        raise RuntimeError('Examples bundle is not from the selected release checkout')
    if bundle is None:
        bundle = read_source_bundle(selected)
    return {'engineRevision': revision, 'engineRoot': str(ENGINE_ROOT),
            'world': 'release-everflame', 'worldRoot': str(WORLD_ROOT),
            'worldBundle': str(selected), 'worldSourceRevision': revision,
            'worldHashes': world_hashes(bundle),
            'python': sys.version, 'pythonExecutable': sys.executable, 'pyyaml': yaml.__version__,
            'pyyamlOrigin': yaml.__file__, 'importOrigins': origins}
