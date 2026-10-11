"""Fast contract checks use declarations, never a real world replay."""
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from server.preplay_audit import audit, inspect_contracts, read_bundle
from server.runtime import WORLD_BUNDLE


class PreplayAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib, cls.source, cls.files = read_bundle(WORLD_BUNDLE)

    def test_actual_assets_expose_gaps_without_being_structural_errors(self):
        findings = inspect_contracts(self.lib, self.source)
        self.assertFalse(any(row['status'] == 'error' for row in findings))
        gaps = {row['code']: row for row in findings if row['status'] == 'gap'}
        self.assertEqual(set(gaps), {'wall-detail', 'hall-invitation'})
        self.assertEqual(len(gaps['hall-invitation']['evidence']), 5)
        self.assertEqual({row['code'] for row in findings if row['status'] == 'review'},
                         {'public-cost', 'resident-reply'})

    def test_audit_does_not_launch_processes_or_create_a_session(self):
        with patch('subprocess.Popen', side_effect=AssertionError('No child process')):
            report = audit(WORLD_BUNDLE)
        self.assertEqual((report['compileCount'], report['sessions'], report['actions']), (0, 0, 0))
        self.assertEqual(report['worldHashes'], self.files)

    def test_missing_player_read_is_an_error(self):
        source = deepcopy(self.source)
        seat = next(row for row in source['seats'] if row.get('actor') == 'adventurer')
        seat['read'].remove('adventurer.known_walls')
        self.assertTrue(any(row['code'] == 'player-read' and row['status'] == 'error'
                            for row in inspect_contracts(self.lib, source)))

    def test_missing_wall_source_is_an_error_not_unknown_detail(self):
        lib = deepcopy(self.lib)
        wall = next(row for row in lib['records'] if row['name'] == 'KnownWall')
        wall['fields'] = [row for row in wall['fields'] if row['name'] != 'observed_ref']
        self.assertTrue(any(row['code'] == 'wall-record' and row['status'] == 'error'
                            for row in inspect_contracts(lib, self.source)))

    def test_an_extra_wall_field_does_not_certify_a_detail_producer(self):
        lib = deepcopy(self.lib)
        wall = next(row for row in lib['records'] if row['name'] == 'KnownWall')
        wall['fields'].append({'name': 'closed', 'type': 'bool'})
        detail = next(row for row in inspect_contracts(lib, self.source) if row['code'] == 'wall-detail')
        self.assertEqual(detail['status'], 'review')

    def test_missing_hearing_domain_is_an_error(self):
        source = deepcopy(self.source)
        next(row for row in source['events'] if row.get('family') == 'escort_heard')['actor_domain'] = 'absent'
        self.assertTrue(any(row['code'] == 'escort-domain' and row['status'] == 'error'
                            for row in inspect_contracts(self.lib, source)))

    def test_missing_hall_domain_is_not_a_successful_empty_coverage(self):
        source = deepcopy(self.source)
        source['actor_domains'] = [row for row in source['actor_domains'] if row['name'] != 'hall_bokolds']
        self.assertTrue(any(row['code'] == 'hall-domain' and row['status'] == 'error'
                            for row in inspect_contracts(self.lib, source)))

    def test_duplicate_hall_or_hearing_domain_is_not_silently_overwritten(self):
        for name, code in [('hall_bokolds', 'hall-domain'), ('residents', 'escort-domain')]:
            with self.subTest(domain=name):
                source = deepcopy(self.source)
                source['actor_domains'].append(deepcopy(next(row for row in source['actor_domains'] if row['name'] == name)))
                self.assertTrue(any(row['code'] == code and row['status'] == 'error'
                                    for row in inspect_contracts(self.lib, source)))

    def test_declared_coverage_removes_only_the_coverage_gap(self):
        source = deepcopy(self.source)
        domains = {row['name']: row for row in source['actor_domains']}
        domains['residents']['owners'] += domains['hall_bokolds']['owners']
        findings = inspect_contracts(self.lib, source)
        self.assertNotIn('hall-invitation', {row['code'] for row in findings})
        self.assertIn('resident-reply', {row['code'] for row in findings})

    def test_path_escape_and_wrong_schema_fail_before_other_files(self):
        with TemporaryDirectory() as directory:
            bundle = Path(directory) / 'world.bundle.yaml'
            bundle.write_text('schema: old\n')
            with self.assertRaisesRegex(ValueError, 'current C0'):
                read_bundle(bundle)
            bundle.write_text('schema: c0.source_bundle.v1\nlib: ../escape.yaml\n')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                read_bundle(bundle)


if __name__ == '__main__':
    unittest.main()
