"""Short display contracts, not world or NPC simulation."""
import json
import unittest
from types import SimpleNamespace
from server.player_information import PlayerInformation
from server import test_projection


def observation(identity='one', state='unknown', site='hall', facts=()):
    return {'id': identity, 'kind': 'person', 'label': identity, 'site': site,
            'state': state, 'facts': list(facts), 'evidence': 'last_observed',
            '_source': 'person_sighting' if facts or state != 'unknown' else 'known_residents'}


class PlayerInformationTests(unittest.TestCase):
    def test_preparation_is_an_observed_phase_not_unknown_or_remote_progress(self):
        memory = PlayerInformation()
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'unknown')
        changes = memory.capture([], 'preparing', 100, 1)
        self.assertEqual(changes[0]['phase'], 'preparing')
        self.assertEqual(memory.snapshot()['ritual']['label'], '曾察觉仪式正在准备')
        memory.capture([], None, 200, 2)
        self.assertEqual(memory.snapshot()['ritual']['recordedAt'], {'time': 100, 'revision': 1})
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'preparing')
        memory.capture([], 'gathering', 300, 3)
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'gathering')

    def test_newer_contact_is_not_filtered_by_older_known_resident(self):
        from nomos_kernel import K0OccurrenceRef
        game = test_projection.ProjectionTests().game({
            'adventurer.known_residents': (SimpleNamespace(name='one', site='hall', observation=K0OccurrenceRef(1)),),
            'adventurer.conversations.prison.contacts': (
                SimpleNamespace(name='one', site='prison', observation=K0OccurrenceRef(2)),),
        })
        self.assertEqual(game.render()['observations'][0]['site'], 'prison')

    def test_reappearing_surface_overrides_location_acquired_while_absent(self):
        memory = PlayerInformation()
        surface = {**observation(site='hall'), '_source': 'current_surface'}
        memory.capture([surface], None, 100, 1)
        memory.capture([], None, 200, 2)
        detail = {**observation(site='prison', state='frozen'), '_basis': 3}
        memory.capture([detail], None, 300, 3)
        changes = memory.capture([detail, surface], None, 400, 4)
        self.assertEqual(len(changes), 1)
        self.assertEqual(memory.observations()[0]['site'], 'hall')
        self.assertEqual(memory.observations()[0]['detailRecordedAt'], {'time': 300, 'revision': 3})
        self.assertEqual(memory.capture([detail, surface], None, 500, 5), [])
        self.assertEqual(memory.observations()[0]['recordedAt'], {'time': 500, 'revision': 5})
        self.assertEqual(memory.observations()[0]['detailRecordedAt'], {'time': 300, 'revision': 3})

    def test_detail_and_location_streams_are_retained_and_merged_by_local_basis(self):
        from nomos_kernel import K0OccurrenceRef
        game = test_projection.ProjectionTests().game({
            'adventurer.known_residents': (SimpleNamespace(name='one', site='passage', observation=K0OccurrenceRef(9)),),
            'adventurer.person_sighting': SimpleNamespace(subject='one', site='threshold', cold_state='frozen',
                                                        life='alive', observation=K0OccurrenceRef(7)),
        })
        row = game.render()['observations'][0]
        self.assertEqual(row['site'], 'passage')
        self.assertEqual(row['state'], 'frozen')
        self.assertTrue(row['facts'])
        self.assertNotIn('_basis', json.dumps(game.render()))

    def test_stale_detail_stream_cannot_roll_back_newer_surface_location(self):
        memory = PlayerInformation()
        old = {**observation(state='frozen', site='threshold', facts=({'label': '御寒', 'value': '冻结'},)),
               '_source': 'person_sighting', '_basis': 7}
        first = {**observation(site='threshold'), 'evidence': 'last_perceived', '_source': 'current_surface'}
        memory.capture([old, first], None, 1900, 19)
        next_surface = {**first, 'site': 'passage'}
        memory.capture([old, next_surface], None, 2200, 22)
        current = memory.observations()[0]
        self.assertEqual(current['site'], 'passage')
        self.assertEqual(current['state'], 'frozen')
        self.assertEqual(current['detailRecordedAt'], {'time': 1900, 'revision': 19})
        self.assertEqual(memory.capture([old, next_surface], None, 2300, 23), [])
        self.assertEqual(memory.observations()[0]['recordedAt'], {'time': 2300, 'revision': 23})
        self.assertEqual(memory.observations()[0]['detailRecordedAt'], current['detailRecordedAt'])
        memory.capture([old, first], None, 2400, 24)
        self.assertEqual(memory.observations()[0]['site'], 'threshold')
        fresh = {**old, '_basis': 9}
        memory.capture([fresh, first], None, 2500, 25)
        self.assertEqual(memory.observations()[0]['detailRecordedAt'], {'time': 2500, 'revision': 25})
        self.assertNotIn('_basis', json.dumps(memory.snapshot()))
        self.assertNotIn('_source', json.dumps(memory.observations()))

    def test_unnamed_people_have_distinct_stable_handles_not_internal_role_names(self):
        memory = PlayerInformation()
        ids = {'private-role-one': 'seen-1', 'private-role-two': 'seen-2'}
        one = memory.person_label('private-role-one', ids.__getitem__, {})
        two = memory.person_label('private-role-two', ids.__getitem__, {})
        self.assertNotEqual(one, two)
        self.assertEqual(memory.person_label('private-role-one', ids.__getitem__, {}), one)
        self.assertNotIn('private-role', one + two)
        self.assertEqual(memory.person_label('private-role-one', ids.__getitem__, {'private-role-one': '居民一'}), '居民一')

    def test_chandelier_surface_observation_and_offer_share_the_real_target(self):
        identity = object()
        offer = SimpleNamespace(entry='observe_chandelier_adventurer', label='Observe', label_fragments=(),
                                payload=(('chandelier', identity),))
        game = test_projection.ProjectionTests().game({
            'known_site_protection': (('tower_base', (('status', 'unknown'), ('after_spend_one', 'unknown'), ('surface_available', True),
                 ('presence_object_chandelier', True), ('target_chandelier', identity))),),
            'adventurer.chandelier_sighting': SimpleNamespace(notice='voices', mount_observed=True),
        }, [offer])
        frame = game.render()
        self.assertEqual(len(frame['observations']), 1)
        current = frame['information']['visibleEntities'][0]
        self.assertEqual(current['id'], frame['observations'][0]['id'])
        self.assertEqual(frame['offers'][0]['targetIds'], [current['id']])
        self.assertEqual(current['facts'], [])
        self.assertTrue(frame['observations'][0]['facts'])
        self.assertNotIn(repr(identity), json.dumps(frame))

    def test_surface_does_not_refresh_old_detail_receipt_or_duplicate_discovery(self):
        memory = PlayerInformation()
        detail = observation(state='frozen', facts=({'label': '状态', 'value': '冻结'},))
        changes = memory.capture([detail, {**observation(), 'evidence': 'last_perceived'}], None, 10, 1)
        self.assertEqual(len(changes), 1)
        self.assertEqual(memory.capture([detail, {**observation(), 'evidence': 'last_perceived'}], None, 20, 2), [])
        moved = {**observation(site='bridge'), 'evidence': 'last_perceived'}
        memory.capture([moved], None, 30, 3)
        record = memory.observations()[0]
        self.assertEqual(record['site'], 'bridge')
        self.assertEqual(record['detailRecordedAt'], {'time': 10, 'revision': 1})
        self.assertEqual(record['recordedAt'], {'time': 30, 'revision': 3})

    def test_current_surface_uses_exact_visible_object_and_target_identity(self):
        identity = object()
        fields = {'adventurer.site': 'hall', 'known_site_protection': (
            ('hall', (('surface_available', True), ('visible_person_one', 'hall'),
                      ('visible_person_far', ''), ('presence_object_chandelier', True),
                      ('target_chandelier', identity))),
            ('remote', (('visible_person_remote', 'remote'),)),)}
        ids = {}
        def identify(value):
            if value not in ids:
                ids[value] = f'seen-{len(ids) + 1}'
            return ids[value]
        memory = PlayerInformation()
        rows = memory.capture_surface(fields, identify, {'one': '居民一'})
        memory.capture(rows, None, 0, 0)
        current = memory.snapshot()['visibleEntities']
        self.assertEqual([row['label'] for row in current], ['居民一', '枝形吊灯'])
        self.assertEqual(current[1]['id'], identify(identity))
        self.assertTrue(all(row['facts'] == [] and row['state'] == 'unknown' for row in current))
        memory.capture_surface({'adventurer.site': 'remote'}, identify, {})
        self.assertEqual(memory.snapshot()['visibleEntities'], [])
        self.assertEqual(len(memory.observations()), 2)
        self.assertNotIn('remote', json.dumps(current))

    def test_declared_motion_keeps_location_but_not_private_motive_or_world_refs(self):
        memory = PlayerInformation()
        record = SimpleNamespace(motion=SimpleNamespace(name='one', start='hall', end='bridge', action=1),
                                 observation=2)
        log = SimpleNamespace(entries=(record,))
        changes = memory.capture_movements(log, lambda _: 'seen-1', {'one': '居民一'}, 100, 1)
        self.assertEqual(changes[0]['kind'], 'movement')
        movement = memory.snapshot()['movements'][0]
        self.assertEqual((movement['start'], movement['end']), ('hall', 'bridge'))
        self.assertNotIn('action', movement)
        self.assertNotIn('observation', movement)
        self.assertNotIn('accepted', movement)
        self.assertEqual(memory.capture_movements(log, lambda _: 'seen-1', {}, 200, 2), [])
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')
        self.assertIn('尚未发出', memory.snapshot()['escortResponse']['label'])

    def test_existing_motion_is_not_relabelled_as_a_later_invitation_response(self):
        memory = PlayerInformation()
        record = SimpleNamespace(motion=SimpleNamespace(name='one', start='hall', end='bridge', action=1), observation=2)
        log = SimpleNamespace(entries=(record,))
        memory.capture_movements(log, lambda _: 'seen-1', {}, 100, 1)
        memory.record_invitation()
        memory.capture_movements(log, lambda _: 'seen-1', {}, 200, 2)
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')
        next_record = SimpleNamespace(motion=SimpleNamespace(name='one', start='bridge', end='hall', action=3), observation=4)
        memory.capture_movements(SimpleNamespace(entries=(next_record,)), lambda _: 'seen-1', {}, 300, 3)
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'movement_observed')
        self.assertIn('不证明因邀请而行动', memory.snapshot()['escortResponse']['label'])
        memory.record_invitation()
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')

    def test_another_person_does_not_erase_acquired_details(self):
        memory = PlayerInformation()
        dead = observation(state='dead', facts=({'label': '生命', 'value': 'Dead'},))
        memory.capture([dead], None, 100, 1)
        memory.capture([observation(), observation('two', 'immune')], None, 200, 2)
        first = memory.observations()[0]
        self.assertEqual(first['state'], 'dead')
        self.assertEqual(first['facts'], dead['facts'])
        self.assertEqual(first['detailRecordedAt'], {'time': 100, 'revision': 1})

    def test_missing_readback_preserves_memory_but_never_live_presence(self):
        memory = PlayerInformation()
        memory.capture([observation()], None, 100, 1)
        memory.capture([], None, 200, 2)
        self.assertEqual(memory.observations()[0]['presence'], 'not_confirmed')
        self.assertEqual(memory.snapshot()['visibleEntities'], [])
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')

    def test_identical_reads_do_not_change_history_or_manufacture_discovery(self):
        memory = PlayerInformation()
        row = observation()
        self.assertEqual(len(memory.capture([row], None, 100, 1)), 1)
        before = memory.observations()
        self.assertEqual(memory.capture([row], None, 200, 2), [])
        self.assertEqual(memory.observations(), before)

    def test_response_and_input_are_isolated_from_future_capture(self):
        memory = PlayerInformation()
        row = observation(state='frozen')
        memory.capture([row], None, 100, 1)
        response = memory.observations()
        row['state'] = 'dead'
        self.assertEqual(memory.observations()[0]['state'], 'frozen')
        memory.capture([row], None, 200, 2)
        self.assertEqual(response[0]['state'], 'frozen')
        response[0]['state'] = 'alive'
        self.assertEqual(memory.observations()[0]['state'], 'dead')

    def test_ritual_unknown_and_completion_are_not_the_same_zero(self):
        memory = PlayerInformation()
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'unknown')
        memory.capture([], 'critical', 100, 1)
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'critical')
        discoveries = memory.capture([], 'erupted', 200, 2)
        self.assertEqual(discoveries[0]['phase'], 'completed')
        memory.capture([], None, 300, 3)
        self.assertEqual(memory.snapshot()['ritual']['phase'], 'completed')

    def test_opaque_and_hidden_fields_never_enter_information_projection(self):
        game = test_projection.ProjectionTests().game({'scene.private': 'SECRET', 'private.seed': 42})
        frame = game.render()
        self.assertNotIn('SECRET', json.dumps(frame))
        self.assertNotIn('seed', json.dumps(frame))
        self.assertNotIn('chantLevel', frame['scene'])
        before = json.dumps(frame, sort_keys=True)
        self.assertEqual(json.dumps(game.render(), sort_keys=True), before)


if __name__ == '__main__':
    unittest.main()
