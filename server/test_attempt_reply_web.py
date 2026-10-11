"""Web-only source contracts; no world/appraisal compilation or engine steps."""
from copy import deepcopy
import json
from types import SimpleNamespace as R
import unittest
from unittest.mock import patch

from server.m1_policy import M1Policy
from server.player_result import player_result
from server.projection import movement_attempt, passage_warning, heard_escort_replies
from server.player_information import PlayerInformation


ATTEMPT = 'adventurer.conversations.movement_attempt'
REPLIES = 'adventurer.conversations.heard_escort_replies'


def heard(hearing=None, status='ready_now', speaker='private-speaker'):
    return R(hearing=object() if hearing is None else hearing,
             reply=R(speaker=speaker, recipient='adventurer', site='a', destination='b', status=status,
                     invitation=object(), invitation_hearing=object(), action=object()))


def move(destination='b', entry='move_adventurer'):
    return R(entry=entry, payload=(('destination', destination),))


class AttemptResultTests(unittest.TestCase):
    def setUp(self):
        self.old, self.new = object(), object()
        self.before = {'adventurer.site': 'a', ATTEMPT: R(start='a', destination='b', landing='a',
                       outcome='blocked', action=self.old),
                       'adventurer.vital.endurance': 3}
        self.instant = {**self.before,
                        ATTEMPT: R(start='a', destination='b', landing='a',
                                   outcome='blocked', action=self.new)}

    def result(self, instant=None, offer=None, published=True):
        instant = self.instant if instant is None else instant
        return player_result(offer or move(), self.before, instant,
                             {**instant, 'adventurer.vital.endurance': 2}, published)

    def test_paid_blocked_attempt_is_not_refusal_arrival_or_motion(self):
        result = self.result()
        self.assertEqual(result['movementAttempt'],
            dict(start='a', destination='b', landing='a', outcome='blocked'))
        self.assertEqual((result['target'], result['landing']), ('b', 'a'))
        self.assertEqual(result['laterChanges'],
            [{'field': 'endurance', 'before': 3, 'after': 2}])
        self.assertFalse({'action', 'collision', 'actor_motion'} & set(result))
        self.assertNotIn(repr(self.new), json.dumps(result))
        self.assertIsNone(self.result(published=False))

    def test_arrival_requires_matching_new_action_receipt(self):
        instant = {**self.instant, 'adventurer.site': 'b',
                   ATTEMPT: R(start='a', destination='b', landing='b', outcome='arrived', action=self.new)}
        self.assertEqual(self.result(instant)['movementAttempt']['outcome'], 'arrived')

    def test_retained_wrong_or_absent_receipt_is_not_this_step(self):
        records = [None,
            R(start='a', destination='b', landing='a', outcome='blocked', action=self.old),
            R(start='elsewhere', destination='b', landing='elsewhere', outcome='blocked', action=self.new),
            R(start='a', destination='c', landing='a', outcome='blocked', action=self.new),
            R(start='a', destination='b', landing='b', outcome='blocked', action=self.new),
            R(start='a', destination='b', landing='a', outcome='slipped', action=self.new),
            R(start=1, destination='b', landing='a', outcome='blocked', action=self.new)]
        for record in records:
            with self.subTest(record=record):
                result = self.result({**self.instant, ATTEMPT: record})
                self.assertNotIn('movementAttempt', result)
                self.assertNotIn('landing', result)
        self.assertNotIn('movementAttempt', self.result(offer=move(entry='wait_adventurer')))

    def test_top_level_or_private_receipts_are_never_sources(self):
        fields = {'adventurer.site': 'a',
                  'adventurer.movement_attempt': self.instant[ATTEMPT],
                  'scene.movement_attempt': self.instant[ATTEMPT]}
        self.assertIsNone(movement_attempt(fields))
        self.assertNotIn('movementAttempt', self.result(fields))


class PassageWarningTests(unittest.TestCase):
    def test_unknown_stays_unknown_despite_private_floor_or_guard(self):
        fields = {'adventurer.site': 'a', 'scene.floor.frozen': True,
                  'private.guard': False}
        self.assertEqual(passage_warning(move(), fields, []),
            dict(floorState='unknown', lastAttemptBlocked=False, crossingIndexes=[]))
        fields['adventurer.floor_sighting'] = R(site='elsewhere', frozen=True)
        self.assertEqual(passage_warning(move(), fields, [])['floorState'], 'unknown')

    def test_matching_known_crossing_only_without_probing_or_guaranteeing(self):
        fields = {'adventurer.site': 'a',
            'adventurer.floor_sighting': R(site='a', frozen=True),
            'adventurer.known_crossings': (R(key='match', start='a', intended='b'),
                R(key='wrong-start', start='c', intended='b'), R(key='wrong-end', start='a', intended='c'))}
        offers = [(i, R(entry='cross_ice_adventurer', payload=(('crossing', key),)))
                  for i, key in enumerate(('match', 'wrong-start', 'wrong-end', 'private'), 1)]
        self.assertEqual(passage_warning(move(), fields, offers),
            dict(floorState='frozen', lastAttemptBlocked=False, crossingIndexes=[1]))
        self.assertIsNone(passage_warning(move(entry='bridge_slow_adventurer'), fields, offers))

    def test_generic_block_does_not_infer_ice_and_only_matches_same_route(self):
        fields = {'adventurer.site': 'a', ATTEMPT:
            R(start='a', destination='b', landing='a', outcome='blocked', action=object())}
        warning = passage_warning(move(), fields, [])
        self.assertTrue(warning['lastAttemptBlocked'])
        self.assertEqual(warning['floorState'], 'unknown')
        self.assertFalse(passage_warning(move('c'), fields, [])['lastAttemptBlocked'])
        self.assertFalse(passage_warning(move(), {**fields, 'adventurer.site': 'c'}, [])['lastAttemptBlocked'])
        fields['adventurer.floor_sighting'] = R(site='a', frozen=False)
        self.assertEqual(passage_warning(move(), fields, [])['floorState'], 'clear')


class HeardReplyTests(unittest.TestCase):
    def capture(self, memory, records, prior=()):
        return memory.capture_replies(heard_escort_replies({REPLIES: records}),
            lambda _: 'seen-1', {}, 100, 1, heard_escort_replies({REPLIES: prior}))

    def test_all_actual_heard_statuses_project_anonymous_speaker_without_refs(self):
        for status in ('ready_now', 'not_ready_now', 'unable_now'):
            memory, record = PlayerInformation(), heard(status=status)
            discoveries = self.capture(memory, (record,))
            reply = discoveries[0]['reply']
            self.assertEqual(discoveries[0]['kind'], 'escort_reply')
            self.assertEqual(reply['status'], status)
            self.assertEqual(reply['label'], '附近的人 · 1')
            self.assertEqual((reply['site'], reply['destination']), ('a', 'b'))
            public = json.dumps(memory.snapshot(), ensure_ascii=False)
            self.assertNotIn('private-speaker', public)
            self.assertNotIn(repr(record.hearing), public)
            self.assertNotIn('invitation_hearing', public)
            self.assertNotIn('action', reply)

    def test_no_reply_from_private_or_unheard_untyped_or_missing_source(self):
        record = heard()
        self.assertEqual(heard_escort_replies({'scene.escort_reply': record.reply}), ())
        self.assertEqual(heard_escort_replies({'npc.escort_reply': record.reply}), ())
        self.assertEqual(heard_escort_replies({REPLIES: None}), ())
        self.assertEqual(heard_escort_replies({REPLIES: [record]}), ())
        self.assertEqual(heard_escort_replies({REPLIES: (R(reply=record.reply, hearing=None),)}), ())
        record.reply.action = None
        self.assertEqual(heard_escort_replies({REPLIES: (record,)}), ())
        self.assertEqual(heard_escort_replies({REPLIES: (heard(status='following_safely'),)}), ())

    def test_before_after_hearing_identity_only_new_records_are_discoveries(self):
        memory, old, new = PlayerInformation(), heard(), heard()
        discoveries = self.capture(memory, (old, new), (old,))
        self.assertEqual([row['reply']['id'] for row in discoveries], ['reply-2'])
        self.assertEqual(len(memory.snapshot()['escortReplies']), 2)
        self.assertEqual(self.capture(memory, (new, old)), [])
        original = memory.snapshot()
        old.reply.status = 'unable_now'
        self.assertEqual(self.capture(memory, (old,)), [])
        self.assertEqual(memory.snapshot(), original)
        self.capture(memory, ())
        self.assertEqual(memory.snapshot(), original)

    def test_invitation_old_reply_and_movement_are_not_new_assent_or_safe_following(self):
        memory, old = PlayerInformation(), heard()
        self.capture(memory, (old,))
        memory.record_invitation()
        self.assertEqual(self.capture(memory, (old,), (old,)), [])
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')
        memory.capture_movements(R(entries=(R(motion=R(name='one', start='a', end='b', action=object()),
                                             observation=object()),)), lambda _: 'seen-1', {}, 100, 1)
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'movement_observed')
        self.capture(memory, (old, heard(status='not_ready_now')), (old,))
        response = memory.snapshot()['escortResponse']
        self.assertEqual(response['status'], 'reply_heard')
        self.assertIn('不保证', response['label'])
        self.assertIn('跟随', response['label'])
        memory.record_invitation()
        self.assertEqual(memory.snapshot()['escortResponse']['status'], 'not_observed')


def public_frame():
    return {'time': 0, 'ending': None,
        'fields': dict(locationId='a', lifeState='alive', coldState='mobile', endurance=3, everflameCharges=5),
        'scene': {'routes': []}, 'observations': [],
        'information': {'visibleEntities': [], 'ritual': {'phase': 'unknown'}},
        'offers': [dict(index=1, entry='move_adventurer', label='Try B', destination='b', movementKind='walk'),
                   dict(index=2, entry='move_adventurer', label='Try C', destination='c', movementKind='walk'),
                   dict(index=3, entry='cross_ice_adventurer', label='Cross B', destination='b', movementKind='ice')]}


class FailedAttemptMemoryTests(unittest.TestCase):
    def policy(self):
        entries = ('move_adventurer', 'cross_ice_adventurer')
        appraisal = R(compiled=R(features=(('explore', 'Explore'),), bindings=dict.fromkeys(entries, 'move')),
            inputs={entry: {'scope': scope, 'movement_kind': kind}
                for entry, scope, kind in zip(entries, ('travel', 'ice_travel'), ('walk', 'ice'))},
            evaluate=lambda entry, local, opportunity: None if opportunity.was_tried else
                {'explore': 1, 'inspection': False, 'interruption': False})
        with patch('server.m1_policy.PublicPlanner', return_value=R(goals={})):
            return M1Policy(appraisal=appraisal, score_rules=object(), profiles={name: {} for name in
                ('cautious_investigator', 'helpful_rescuer', 'decisive_explorer')})

    def test_all_profiles_share_paid_failure_without_price_time_or_index_reset(self):
        policy, before = self.policy(), public_frame()
        after = deepcopy(before)
        after['feedback'] = {'status': 'published', 'result': {'movementAttempt':
            dict(start='a', destination='b', landing='a', outcome='blocked')}}
        policy.observe_episode(after, R(facts=policy.facts, places={'a'}), before['offers'][0], before, True)
        after['time'] = 800
        after['fields'].update(endurance=1, everflameCharges=2, gold=40, movementSpeed=80)
        after['offers'][0].update(index=80, forecasts=[{'label': '行动值消耗', 'value': 999}])
        after['offers'][0]['passageWarning'] = dict(floorState='unknown', lastAttemptBlocked=True, crossingIndexes=[3])
        for name in policy.profiles:
            candidates = policy._candidates_for_plans(after, name, (), [])
            self.assertEqual({row.index for row in candidates}, {2, 3})
        after['observations'] = [dict(id='floor', kind='floor', site='a', state='normal', facts=[])]
        self.assertIn(80, {row.index for row in policy._candidates_for_plans(after, 'decisive_explorer', (), [])})

    def test_public_floor_change_allows_retry_but_unchanged_detail_timestamp_does_not(self):
        policy, before = self.policy(), public_frame()
        before['observations'] = [dict(id='floor', kind='floor', site='a', state='frozen', facts=[])]
        after = deepcopy(before)
        after['feedback'] = {'status': 'published', 'result': {'movementAttempt':
            dict(start='a', destination='b', landing='a', outcome='blocked')}}
        policy.observe_episode(after, R(facts=policy.facts, places={'a'}), before['offers'][0], before, True)
        after['observations'][0]['recordedAt'] = {'time': 900, 'revision': 8}
        self.assertTrue(policy.failed_attempt(after, after['offers'][0]))
        after['observations'][0]['state'] = 'normal'
        self.assertFalse(policy.failed_attempt(after, after['offers'][0]))

    def test_no_paid_failure_from_unrelated_stale_or_successful_result(self):
        for receipt in (None, dict(start='a', destination='c', landing='a', outcome='blocked'),
                        dict(start='a', destination='b', landing='b', outcome='arrived')):
            policy, before = self.policy(), public_frame()
            after = {**before, 'feedback': {'status': 'published', 'result': {'movementAttempt': receipt}}}
            policy.observe_episode(after, R(facts=policy.facts, places={'a'}), before['offers'][0], before, True)
            self.assertFalse(policy.failed_attempts)


class AttemptTransportTests(unittest.TestCase):
    def test_web_transport_published_block_retained_receipt_and_refusal(self):
        from collections import OrderedDict
        from server.bridge import Game
        from server.player_information import PlayerInformation

        class Publication:
            pass

        game = Game.__new__(Game)
        policy = FailedAttemptMemoryTests().policy()
        policy.appraisal.project = lambda entry, payload, *args: (
            {'destination': payload['destination'], 'movementKind': 'walk'}
            if entry == 'move_adventurer' else None)
        policy.action_merits = lambda *args: (None, {})
        game.policy, game.policy_revision = policy, 0
        game.session_id, game.revision, game.seat = 'web-fixture', 0, 'adventurer'
        game.terms = {}
        # Even labelled receipt paths must be consumed by their dedicated projection.
        game.labels = {ATTEMPT: 'Movement receipt', ATTEMPT + '.action': 'PRIVATE ACTION'}
        game.player_information, game.observation_ids = PlayerInformation(), {}
        game.presentation = R(published='Published', rejected='Refused', finish_on_action=(),
                              published_actions=(), rejected_actions=())
        game.completed, game.journal, game.feedback, game.faulted = OrderedDict(), [], None, False
        game.play_ledger = R(facts=policy.facts, places={'a'}, record=lambda **kwargs: None)
        game.remember_visible = lambda *args: None
        game.response = lambda: {'frame': game.frame, 'revision': game.revision, 'entries': game.journal}
        action = object()
        offer = R(entry='move_adventurer', payload=(('destination', 'b'),), label='Try B', label_fragments=())
        old_reply, reply, later_reply = heard(), heard(), heard(status='unable_now')
        before = {'adventurer.site': 'a', 'adventurer.vital.endurance': 3, REPLIES: (old_reply,)}
        instant = {**before, ATTEMPT: R(start='a', destination='b', landing='a', outcome='blocked', action=action),
                   ATTEMPT + '.action': action, REPLIES: (old_reply, reply)}

        def frame(fields, time):
            return R(view=R(fields=tuple(fields.items())), offers=(offer,), time=time, finished=False)

        game.engine_frame = frame(before, 10)
        game.capture_information(before, 10, 0)
        game.frame = game.render()
        latest = frame(instant, 10)
        later = frame({**instant, 'adventurer.vital.endurance': 2, REPLIES: (old_reply, reply, later_reply)}, 110)
        game.session = R(apply_control=lambda *args: R(result=Publication()),
                         form_frame=lambda *args: latest, continue_form=lambda *args: later)
        with patch('server.bridge.K0Published', Publication), patch('server.bridge.compile_m1', side_effect=AssertionError('No compilation')):
            response = game.mutate('actions', dict(index=1, revision=0, requestId='new'))
            feedback = response['frame']['feedback']
            self.assertEqual(feedback['status'], 'published')
            self.assertEqual(feedback['result']['movementAttempt']['outcome'], 'blocked')
            self.assertEqual(feedback['result']['elapsed'], dict(action=0, subsequent=100))
            self.assertEqual(feedback['result']['laterChanges'],
                [dict(field='endurance', before=3, after=2)])
            self.assertIn('具体原因尚不清楚', feedback['text'])
            self.assertFalse(response['frame']['information']['movements'])
            self.assertEqual([row['reply']['id'] for row in feedback['result']['discoveries']], ['reply-2'])
            self.assertEqual([row['reply']['id'] for row in feedback['result']['laterDiscoveries']], ['reply-3'])
            self.assertEqual(len(response['frame']['information']['escortReplies']), 3)
            self.assertTrue(policy.failed_attempts)
            rendered = json.dumps(response, ensure_ascii=False)
            self.assertNotIn('PRIVATE ACTION', rendered)
            self.assertNotIn(repr(action), rendered)
            self.assertNotIn('Movement receipt', rendered)
            self.assertNotIn(repr(reply.hearing), rendered)
            self.assertNotIn('private-speaker', rendered)
            latest = frame(instant, 110)
            later = frame(instant, 210)
            retained = game.mutate('actions', dict(index=1, revision=1, requestId='retained'))
            self.assertNotIn('movementAttempt', retained['frame']['feedback']['result'])
            self.assertFalse(retained['frame']['feedback']['result']['discoveries'])
            self.assertFalse(retained['frame']['feedback']['result']['laterDiscoveries'])
            game.session.apply_control = lambda *args: R(result=object())
            refused = game.mutate('actions', dict(index=1, revision=2, requestId='refused'))
            self.assertEqual(refused['frame']['feedback']['status'], 'rejected')
            self.assertIsNone(refused['frame']['feedback']['result'])


if __name__ == '__main__':
    unittest.main()
