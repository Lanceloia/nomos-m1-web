"""Presentation-only cases; these fixtures do not simulate engine actions."""
import json
import unittest
from types import SimpleNamespace as Record
from server.bridge import Game
from server.projection import MOVEMENTS, ICE_MOVEMENTS, scalar_records
from server.player_information import PlayerInformation


class ProjectionTests(unittest.TestCase):
    def test_wall_check_projects_actual_local_identity_and_connects_only_that_wall(self):
        wall, hidden = object(), object()
        offers = [Record(entry='open_plain_wall_adventurer', label='Open', label_fragments=(), payload=(('wall', item),)) for item in (wall, hidden)]
        game = self.game({'adventurer.known_walls': (Record(individual=wall, observed_ref=Record(value=3)),),
                          'scene.hidden_wall_status': 'PRIVATE'}, offers)
        first = game.render()
        observation = next(row for row in first['observations'] if row['kind'] == 'wall')
        self.assertEqual(observation['evidence'], 'checked_target')
        self.assertIsNone(observation['site'])
        self.assertIsNone(observation['detailRecordedAt'])
        self.assertEqual(observation['facts'], [])
        self.assertEqual(first['offers'][0]['targetIds'], [observation['id']])
        self.assertNotIn('targetIds', first['offers'][1])
        self.assertNotIn(repr(wall), json.dumps(first))
        self.assertNotIn('PRIVATE', json.dumps(first))
        self.assertEqual(first['observations'], game.render()['observations'])

    def test_appraised_wall_movement_keeps_its_observed_presentation_target(self):
        wall, hidden = object(), object()
        offers = [Record(entry='move_wall_adventurer', label='Pass wall', label_fragments=(),
                         payload=(('wall', item), ('destination', 'treasure_side'))) for item in (wall, hidden)]
        result = self.game({'adventurer.known_walls': (Record(individual=wall, observed_ref=Record(value=3)),)}, offers).render()
        self.assertEqual(result['offers'][0]['targetIds'], [result['observations'][0]['id']])
        self.assertFalse(result['offers'][1].get('targetIds'))
        self.assertNotIn(repr(hidden), json.dumps(result))

    def test_briefing_is_authored_text_not_a_private_world_lookup(self):
        game = self.game({'scene.secret_exit': 'HIDDEN'})
        self.assertEqual(game.render()['briefing'], '')
        game.presentation.opening = 'Explore the known passage; unknown routes need inspection.'
        frame = game.render()
        self.assertEqual(frame['briefing'], game.presentation.opening)
        self.assertNotIn('HIDDEN', json.dumps(frame))
        self.assertNotIn('palace_exit', frame['scene']['knownSites'])

    def game(self, fields, offers=(), outcome=None):
        game = Game.__new__(Game)
        game.terms, game.labels = {}, {}
        game.observation_ids, game.player_information = {}, PlayerInformation()
        from server.m1_policy import M1Policy
        game.policy = M1Policy()
        game.presentation = Record(finish_on_action=())
        game.engine_frame = Record(view=Record(fields=tuple({'adventurer.site': 'tower_base', **fields}.items())),
                                   offers=offers, time=0, finished=outcome is not None, outcome=outcome)
        game.capture_information(game.engine_frame.view.fields, 0, 0)
        return game

    def test_all_authored_movement_types_and_request_exclusion(self):
        entries = [*MOVEMENTS, 'offer_escort_adventurer', 'invite_guest_adventurer']
        offers = [Record(entry=entry, label=entry, label_fragments=(),
                         payload=(('destination', 'tower_top'), ('crossing', 'crossing-key'))) for entry in entries]
        frame = self.game({'adventurer.known_crossings': (Record(key='crossing-key', start='tower_base', intended='icebar_entry'),)}, offers).render()
        for entry, offer in zip(entries, frame['offers']):
            if entry in MOVEMENTS:
                self.assertEqual(offer['destination'], 'icebar_entry' if entry in ICE_MOVEMENTS else 'tower_top')
                self.assertEqual(offer['movementKind'], MOVEMENTS[entry])
            else:
                self.assertNotIn('destination', offer)

    def test_observed_people_have_no_invented_life_or_carry_status(self):
        frame = self.game({'adventurer.known_residents': (Record(name='emma', site='tower_top'),),
                           'scene.hidden_people': 'secret_person'}).render()
        person = frame['observations'][0]
        self.assertEqual(person['state'], 'unknown')
        self.assertEqual(person['facts'], [])
        self.assertTrue(frame['scene']['tokens'][1]['observed'])
        self.assertNotIn('secret_person', json.dumps(frame))

    def test_opaque_item_identity_is_stable_and_never_serialized(self):
        identity = object()
        fields = {'adventurer.resources.chest': Record(chest=identity, site='treasure_side', opened=True, gold=12)}
        offer = Record(entry='open_chest_adventurer', label='Open', label_fragments=(), payload=(('chest', identity),))
        game = self.game(fields, [offer])
        first, second = game.render(), game.render()
        self.assertEqual(first['observations'], second['observations'])
        self.assertEqual(first['offers'][0]['targetIds'], [first['observations'][0]['id']])
        self.assertNotIn(repr(identity), json.dumps(first))
        self.assertEqual(first['observations'][0]['facts'][1]['value'], '12')

    def test_death_is_distinct_from_rescue_window(self):
        dead = self.game({}, outcome='adventurer_dead').render()['ending']
        expired = self.game({}, outcome='rescue_window_expired').render()['ending']
        self.assertIn('死亡', dead['title'])
        self.assertIn('不表示角色死亡', expired['narrationZh'])

    def test_treasure_receipt_is_history_and_has_no_invented_site(self):
        frame = self.game({'adventurer.treasure_receipt': Record(item=object(), label='Skyhook')}).render()
        self.assertEqual(frame['observations'][0]['evidence'], 'last_acquired')
        self.assertIsNone(frame['observations'][0]['site'])
        self.assertEqual(len(frame['scene']['tokens']), 1)

    def test_prison_and_bar_contacts_are_public_observations(self):
        frame = self.game({'adventurer.known_bar_bears': (Record(name='bear', site='icebar_entry'),),
                           'adventurer.conversations.prison.contacts': (Record(name='prisoner', site='prison_holding'),)}).render()
        labels = {item['label'] for item in frame['observations']}
        self.assertEqual(len(labels), 2)
        self.assertTrue(all('附近的人' in item for item in labels))
        self.assertTrue(all(item['state'] == 'unknown' for item in frame['observations']))

    def test_new_vital_fields_and_climb_routes(self):
        frame = self.game({'adventurer.vital.life': 'alive', 'adventurer.vital.endurance': 2,
                           'adventurer.vital.max_endurance': 3, 'adventurer.gold': 20,
                           'adventurer.known_climbs': (Record(route=Record(start='tower_base', end='tower_top')),)}).render()
        self.assertEqual(frame['fields']['endurance'], 2)
        self.assertEqual(frame['fields']['gold'], 20)
        self.assertEqual(frame['scene']['routes'][0]['kind'], 'climb')

    def test_floor_action_links_only_to_the_visible_floor(self):
        offers = [Record(entry='thaw_floor_adventurer', label='Thaw floor', label_fragments=(),
                         payload=(('floor_key', key),)) for key in ('known-floor', 'hidden-floor')]
        frame = self.game({'adventurer.floor_sighting': Record(key='known-floor', site='tower_base', frozen=True)}, offers).render()
        self.assertEqual(frame['offers'][0]['targetIds'], [frame['observations'][0]['id']])
        self.assertNotIn('targetIds', frame['offers'][1])
        self.assertNotIn('hidden-floor', json.dumps(frame))

    def test_tower_terms_require_actual_local_hearing_and_do_not_expose_refs(self):
        item, hearing = object(), object()
        offer = Record(condition='emma_leaves_alive', item=item, utterance=object())
        conversation = Record(offer=offer, hearing=hearing)
        frame = self.game({'adventurer.conversations.tower': conversation}).render()
        dialogue = next(row for row in frame['observations'] if row['kind'] == 'dialogue')
        self.assertIn('艾玛活着离开宫殿', dialogue['facts'][0]['value'])
        self.assertIn('不保证最终兑现', dialogue['facts'][1]['value'])
        self.assertTrue(dialogue['facts'][2]['value'].startswith('若你选择接受'))
        self.assertIsNone(dialogue['site'])
        self.assertNotIn(repr(item), json.dumps(frame))
        self.assertNotIn(repr(hearing), json.dumps(frame))
        conversation.hearing = None
        unheard = self.game({'adventurer.conversations.tower': conversation}).render()
        self.assertFalse(any(row['kind'] == 'dialogue' for row in unheard['observations']))

    def test_missing_tower_offer_does_not_invent_terms_or_people(self):
        conversation = Record(offer=None, hearing=None)
        frame = self.game({'adventurer.conversations.tower': conversation}).render()
        self.assertEqual(frame['observations'], [])

    def test_paid_person_record_uses_the_same_public_anonymous_label(self):
        path = 'adventurer.person_sighting.subject'
        rows = scalar_records([path], {path: 'internal_actor_key'},
                              Record(fields=((path, '实际观察的对象'),)), {},
                              lambda identity: '未辨认姓名的个体 2')
        self.assertEqual(rows, [{'label': '实际观察的对象', 'value': '未辨认姓名的个体 2'}])
        self.assertNotIn('internal_actor_key', json.dumps(rows))


if __name__ == '__main__':
    unittest.main()
