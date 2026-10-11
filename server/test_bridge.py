"""Real C0/K0 transport regressions; no parallel simulation of world rules."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

from server.bridge import ApiError, Bridge, Game, compile_m1, make_handler
from server.player_information import PlayerInformation


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.program, cls.assets, cls.runtime_info = compile_m1()

    def setUp(self):
        self.game = Game(self.program, self.assets)
        self.request = 0

    def submit(self, offer):
        self.request += 1
        return self.game.mutate('actions', {'index': offer['index'], 'revision': self.game.revision,
                                           'requestId': f'action-{self.request}'})

    def choose(self, prefix):
        return self.submit(next(o for o in self.game.frame['offers'] if o['label'].startswith(prefix)))

    def movement(self, offers, destination):
        choices = [o for o in offers if o.get('destination') == destination]
        # This test explicitly chooses ordinary movement when ice is also offered.
        return next((o for o in choices if o['label'].startswith('Move to ')), choices[0] if choices else None)

    def travel(self, destination):
        for _ in range(30):
            if self.game.frame['scene']['playerSite'] == destination:
                return
            offers = self.game.frame['offers']
            target = self.movement(offers, destination)
            if target is None:
                queue = [(self.game.frame['scene']['playerSite'], [])]
                visited = set()
                while queue:
                    site, path = queue.pop(0)
                    if site in visited:
                        continue
                    visited.add(site)
                    if site == destination and path:
                        target = self.movement(offers, path[0])
                        break
                    queue.extend((route['end'], [*path, route['end']])
                                 for route in self.game.frame['scene']['routes'] if route['start'] == site)
            if target is None:
                target = next((o for o in offers if o['label'] == 'Look for routes from here'), None)
            self.assertIsNotNone(target, f'No local route or observation toward {destination}: {offers}')
            self.submit(target)
        self.fail('Bounded route did not arrive')

    def ritual(self):
        for destination in ('ritual_passage_entry', 'ritual_threshold', 'ritual_ring'):
            self.travel(destination)

    def test_opening_is_player_local_and_has_explicit_movement(self):
        result = self.game.response()
        self.assertEqual(len(result['entries']), 1)
        self.assertEqual([t['id'] for t in result['frame']['scene']['tokens']], ['player'])
        self.assertNotIn('ritual_side_wall', result['frame']['scene']['knownSites'])
        offers = result['frame']['offers']
        self.assertEqual(len(offers), len(self.game.engine_frame.offers))
        self.assertTrue(any(o['label'].startswith('Inspect reachable climbing') for o in offers))
        escort = next(o for o in offers if o['label'].startswith('Call out'))
        self.assertNotIn('destination', escort)
        self.assertTrue(any(o.get('destination') == 'halls_ballroom_door' for o in offers))
        self.assertFalse(any(o.get('destination') == 'palace_exit' for o in offers))
        self.assertNotIn('palace_exit', result['frame']['scene']['knownSites'])
        self.assertFalse(any(r['end'] == 'palace_exit' for r in result['frame']['scene']['routes']))
        self.assertNotIn('die_seed', json.dumps(result))
        self.assertNotIn('bokold_one', json.dumps(result))

    def test_completed_ritual_allows_fifth_wait_in_default_engine(self):
        for _ in range(5):
            self.choose('Wait')
        fields = self.game.frame['fields']
        self.assertEqual(fields['everflameCharges'], 5)
        self.assertEqual(fields['movementSpeed'], 5)
        self.assertEqual(fields['coldCondition'], 'Able to move')
        self.assertIsNone(fields['lastColdRoll'])
        self.assertEqual(fields['protection'][0]['now'], "Within the Everflame's reach")

        self.assertEqual(self.game.frame['time'], 500)
        self.assertFalse(self.game.faulted)
        self.assertIsNone(self.game.frame['ending'])
        self.assertTrue(self.game.frame['offers'])

    def test_halls_and_two_bridge_steps_preserve_local_map_and_player(self):
        self.travel('halls_ballroom_door')
        self.assertNotIn('bridge_midspan', self.game.frame['scene']['knownSites'])
        self.choose('Look for routes')
        choices = [o for o in self.game.frame['offers'] if o.get('destination') == 'halls_bridge_door']
        self.assertEqual(len(choices), 2)
        self.assertEqual({o['label'].split()[0] for o in choices}, {'Move', 'Cross'})
        for site in ('halls_bridge_door', 'bridge_palace_landing'):
            self.travel(site)
            self.assertEqual(self.game.frame['scene']['tokens'][0]['site'], site)
        self.choose('Look for routes')
        for site in ('bridge_midspan', 'palace_exit'):
            offers = [o for o in self.game.frame['offers'] if o.get('destination') == site]
            self.assertEqual(len(offers), 1)
            self.assertTrue(offers[0]['label'].startswith('Slowly cross'))
            before = self.game.frame['time']
            self.submit(offers[0])
            self.assertEqual(self.game.frame['time'] - before, 200)
            self.assertEqual(self.game.frame['scene']['tokens'][0]['site'], site)
            self.choose('Look for routes')
        visible = dict(self.game.engine_frame.view.fields)
        expected = {(p.start, p.end, 'path') for p in visible.get('adventurer.known_paths', ())}
        expected.update((p.start, p.intended, 'ice') for p in visible.get('adventurer.known_crossings', ()))
        expected.update((p.start, p.end, 'bridge') for p in visible.get('adventurer.known_bridge_paths', ()))
        scene = self.game.frame['scene']
        self.assertEqual({(r['start'], r['end'], r['kind']) for r in scene['routes']}, expected)
        self.assertEqual([t['id'] for t in scene['tokens']], ['player'])
        self.assertNotIn('bokold_one', json.dumps(self.game.response()))

    def test_invalid_stale_and_duplicate_requests_do_not_advance_world(self):
        before = self.game.response()
        for index in (0, 99, True, '1'):
            with self.assertRaises(ApiError):
                self.game.mutate('actions', {'index': index, 'revision': 0, 'requestId': f'bad-{index}'})
        self.assertEqual(self.game.response(), before)
        wait = next(o for o in self.game.frame['offers'] if o['label'] == 'Wait')
        body = {'index': wait['index'], 'revision': 0, 'requestId': 'repeat'}
        result = self.game.mutate('actions', body)
        self.assertEqual(self.game.mutate('actions', body), result)
        self.assertEqual(self.game.response(), result)
        with self.assertRaises(ApiError) as conflict:
            self.game.mutate('actions', {**body, 'requestId': 'stale'})
        self.assertEqual(conflict.exception.status, 409)
        self.assertEqual(self.game.response(), result)

    def test_detach_offer_disappears_without_host_rejection_tick(self):
        self.travel('ballroom_chandelier_reach')
        self.choose('Observe and call')
        self.assertIsNone(self.game.frame['fields']['carriedReservoirCharges'])
        self.choose('Detach the flame-glass')
        self.assertEqual(self.game.frame['fields']['carriedReservoirCharges'], 2)
        self.assertFalse(any(o['label'].startswith('Detach') for o in self.game.frame['offers']))
        self.assertFalse(any(o['label'].startswith('Load') for o in self.game.frame['offers']))

    def test_carry_is_available_before_thaw_and_not_after_thaw(self):
        self.ritual()
        self.assertTrue(any(o['label'].startswith('Carry toward') for o in self.game.frame['offers']))
        self.choose('Use Everflame to thaw')
        self.assertEqual(self.game.frame['fields']['everflameCharges'], 4)
        self.assertEqual(self.game.frame['fields']['ritualSigns'], 'The chant has broken')
        self.assertFalse(any(o['label'].startswith(('Carry toward', 'Use Everflame')) for o in self.game.frame['offers']))
        # Actual NPC position may only be checked in trusted test evidence.
        owners = dict(self.game.session.author_snapshot().owners)
        self.assertEqual(owners['ritual_resident'].site, 'ritual_ring')
        self.travel('ritual_threshold')
        owners = dict(self.game.session.author_snapshot().owners)
        self.assertEqual(owners['ritual_resident'].site, 'ritual_ring')

    def test_carry_frozen_body_is_actual_engine_transition(self):
        self.ritual()
        self.choose('Carry toward')
        self.assertEqual(self.game.frame['scene']['playerSite'], 'ritual_threshold')
        self.assertEqual(self.game.frame['fields']['everflameCharges'], 5)
        resident = dict(self.game.session.author_snapshot().owners)['ritual_resident']
        self.assertEqual(resident.site, 'ritual_threshold')
        self.assertEqual(resident.cold_state, 'frozen')

    def test_departure_and_restart_do_not_invent_rescue(self):
        for site in ('halls_ballroom_door', 'halls_bridge_door', 'bridge_palace_landing', 'bridge_midspan', 'palace_exit'):
            self.travel(site)
        self.choose('Leave the palace')
        self.assertEqual(self.game.frame['ending']['id'], 'departed_palace')
        self.assertEqual(self.game.frame['offers'], [])
        self.assertNotIn('获救', self.game.frame['ending']['narrationZh'])
        result = self.game.mutate('restart', {'revision': self.game.revision, 'requestId': 'restart'})
        self.assertEqual(result['frame']['fields']['location'], 'Ballroom entrance')
        self.assertEqual(len(result['entries']), 1)
        self.assertIsNone(result['frame']['ending'])

    def test_http_creation_refresh_errors_and_idempotence(self):
        bridge = Bridge(self.program, self.assets)
        http = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(bridge))
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{http.server_port}'
        def request(path, body=None, origin=None):
            headers = {'Content-Type': 'application/json'}
            if origin:
                headers['Origin'] = origin
            r = urllib.request.Request(base + path, json.dumps(body).encode() if body is not None else None,
                                       headers=headers)
            with urllib.request.urlopen(r) as response:
                return json.load(response)
        try:
            result = request('/api/sessions', {'requestId': 'create'})
            self.assertEqual(request('/api/sessions', {'requestId': 'create'}), result)
            self.assertEqual(request('/api/sessions/' + result['sessionId']), result)
            with self.assertRaises(urllib.error.HTTPError) as refused:
                request('/api/sessions', {'requestId': 'cross-origin'}, 'https://example.com')
            self.assertEqual(refused.exception.code, 403)
            refused.exception.close()
            with self.assertRaises(urllib.error.HTTPError) as missing:
                request('/api/sessions/missing')
            self.assertEqual(missing.exception.code, 404)
            missing.exception.close()
            self.assertEqual(len(bridge.games), 1)
        finally:
            http.shutdown()
            http.server_close()
            thread.join()


@dataclass(frozen=True)
class LocalPath:
    start: str
    end: str


class MapProjectionTests(unittest.TestCase):
    def render(self, fields, offers=()):
        # This is a view formatter test, not a substitute game implementation.
        game = Game.__new__(Game)
        game.engine_frame = SimpleNamespace(view=SimpleNamespace(fields=tuple(fields.items())),
                                            offers=offers, finished=False, time=0)
        game.terms = {'fresh_site': 'New authored place'}
        game.labels = {}
        game.observation_ids, game.player_information = {}, PlayerInformation()
        game.capture_information(game.engine_frame.view.fields, 0, 0)
        return game.render()

    def test_only_local_directed_routes_and_places_are_exported(self):
        crossing = SimpleNamespace(key='ice_way', start='fresh_site', intended='next_site', collision='hidden_wall')
        frame = self.render({'adventurer.site': 'fresh_site',
                             'adventurer.known_sites': (SimpleNamespace(site='visited_room'),),
                             'adventurer.known_paths': (LocalPath('fresh_site', 'next_site'),),
                             'adventurer.known_crossings': (crossing,),
                             'adventurer.known_bridge_paths': (LocalPath('bridge_palace_landing', 'bridge_midspan'),)})
        scene = frame['scene']
        self.assertEqual(scene['routes'], [
            {'start': 'fresh_site', 'end': 'next_site', 'kind': 'path'},
            {'start': 'fresh_site', 'end': 'next_site', 'kind': 'ice'},
            {'start': 'bridge_palace_landing', 'end': 'bridge_midspan', 'kind': 'bridge'}])
        self.assertIn('visited_room', scene['knownSites'])
        self.assertNotIn('hidden_wall', scene['knownSites'])
        self.assertNotIn('palace_exit', scene['knownSites'])
        self.assertEqual(scene['siteLabels']['fresh_site'], 'New authored place')

    def test_actual_moves_have_destinations_but_carry_and_speech_do_not(self):
        def offer(entry, **payload):
            return SimpleNamespace(entry=entry, payload=tuple(payload.items()), label=entry, label_fragments=())
        offers = (offer('bridge_slow_adventurer', destination='bridge_midspan'),
                  offer('move_wall_adventurer', destination='fresh_site'),
                  offer('carry_frozen_adventurer', destination='bridge_midspan'),
                  offer('carry_from_ritual_adventurer', destination='ritual_threshold'),
                  offer('offer_escort_adventurer', destination='palace_exit'))
        frame = self.render({'adventurer.site': 'bridge_palace_landing'}, offers)
        self.assertEqual(frame['offers'][0]['destination'], 'bridge_midspan')
        self.assertEqual(frame['offers'][1]['destination'], 'fresh_site')
        self.assertIn('fresh_site', frame['scene']['knownSites'])
        self.assertNotIn('destination', frame['offers'][2])
        self.assertNotIn('destination', frame['offers'][3])
        self.assertNotIn('destination', frame['offers'][4])

    def test_hidden_truth_and_reverse_routes_are_not_synthesized(self):
        frame = self.render({'adventurer.site': 'halls_ballroom_door',
                             'adventurer.known_paths': (LocalPath('halls_ballroom_door', 'halls_bridge_door'),),
                             'scene.hidden_npc_site': 'hidden_room',
                             'scene.ritual_progress': 4})
        self.assertEqual(frame['scene']['routes'], [
            {'start': 'halls_ballroom_door', 'end': 'halls_bridge_door', 'kind': 'path'}])
        self.assertEqual(frame['information']['ritual']['phase'], 'unknown')
        self.assertEqual(frame['scene']['tokens'][0]['site'], 'halls_ballroom_door')
        self.assertNotIn('hidden_room', json.dumps(frame))


if __name__ == '__main__':
    unittest.main()
