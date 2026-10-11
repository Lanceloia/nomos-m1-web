"""Real C0/K0 W1 checks; no fake outcomes or hidden post-state rendering."""
import copy
import json
import os
import unittest
from pathlib import Path

from server.bridge import ApiError, Game, compile_m1


class W1LiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.program, cls.assets, cls.runtime_info = compile_m1()
        cls.evidence = []

    @classmethod
    def tearDownClass(cls):
        target = os.environ.get('M1_W1_EVIDENCE')
        if target:
            Path(target).write_text(json.dumps(cls.evidence, ensure_ascii=False, indent=2), encoding='utf-8')

    def submit(self, game, entry):
        index = next(index for index, offer in enumerate(game.engine_frame.offers, 1) if offer.entry == entry)
        body = {'index': index, 'revision': game.revision, 'requestId': f'w1-{entry}'}
        before = game.response()
        result = game.mutate('actions', body)
        self.assertEqual(game.mutate('actions', body), result)
        with self.assertRaises(ApiError) as stale:
            game.mutate('actions', {**body, 'requestId': 'stale'})
        self.assertEqual(stale.exception.status, 409)
        self.assertEqual(game.response(), result)
        return before, result

    def test_default_opening_publication_and_checked_preview(self):
        game = Game(self.program, self.assets)
        projected = game.frame['offers']
        for raw, shown in zip(game.engine_frame.offers, projected):
            columns = dict(game.presentation.preview_fields).get(raw.entry, ())
            self.assertEqual([item['label'] for item in shown['forecasts']], [heading for _, heading in columns])
            for (key, _), item in zip(columns, shown['forecasts']):
                value = dict(raw.preview).get(key)
                if type(value) in (str, int, bool):
                    self.assertEqual(item['value'], game.terms.get(value, value) if type(value) is str else value)
                else:
                    self.assertNotIn('value', item)
        self.assertTrue(any(item['forecasts'] for item in projected))
        before, result = self.submit(game, 'observe_floor_adventurer')
        feedback = result['frame']['feedback']
        self.assertEqual(feedback['status'], 'published')
        self.assertEqual(feedback['text'], dict(game.presentation.published_actions)['observe_floor_adventurer'])
        self.assertTrue(any(item['kind'] == 'floor' for item in result['frame']['observations']))
        self.evidence.append({'case': 'default Assets: actual floor observation', 'before': before, 'after': result})

    def test_legal_actor_local_start_refuses_frozen_floor_passage(self):
        # A bounded startup variation, not a default-start route playthrough.
        # Only the adventurer's start/knowledge changes; Scene, NPCs and rules are untouched.
        assets = copy.deepcopy(self.assets)
        adventurer = assets['opening']['adventurer']
        adventurer['site'] = 'stables_entry'
        adventurer['known_sites'] = [{'site': 'stables_entry'}]
        scene = assets['opening']['scene']
        path = next(path for path in scene['paths']
                    if path['start'] == 'stables_entry' and path['end'] == 'prison_outer')
        adventurer['known_paths'] = [copy.deepcopy(path)]
        self.assertEqual(assets['opening']['scene'], self.assets['opening']['scene'])
        game = Game(self.program, assets)  # Real, checked program.start; no state patch after Start.
        before, result = self.submit(game, 'move_adventurer')
        feedback = result['frame']['feedback']
        self.assertEqual(feedback['status'], 'rejected')
        self.assertEqual(feedback['text'], dict(game.presentation.rejected_actions)['move_adventurer'])
        self.assertEqual(result['frame']['time'], before['frame']['time'])
        self.assertEqual(result['frame']['scene']['playerSite'], 'stables_entry')
        self.assertEqual(result['frame']['fields'], before['frame']['fields'])
        self.evidence.append({'case': 'legal Actor-local Start variation: existing frozen stables floor',
                              'assetChanges': ['opening.adventurer.site', 'opening.adventurer.known_sites',
                                               'opening.adventurer.known_paths'], 'before': before, 'after': result})


if __name__ == '__main__':
    unittest.main()
