"""Episode accounting over published Actions and the player's authorized readback."""
from copy import deepcopy
from dataclasses import dataclass, fields, replace
import json

from .runtime import WORLD_ROOT, install_roots


DIMENSIONS = ('cautious_investigator', 'helpful_rescuer', 'decisive_explorer')
SCORES = ('common', *DIMENSIONS, 'cost')
MERIT_FIELDS = dict(zip(DIMENSIONS, ('investigationMerit', 'rescueMerit', 'explorationMerit')))


@dataclass(frozen=True)
class ScoreFacts:
    publishedActions: int = 0
    manualActions: int = 0
    delegatedActions: int = 0
    rejectedAttempts: int = 0
    elapsed: int = 0
    visitedPlaces: int = 0
    peopleDetailed: int = 0
    peopleThawed: int = 0
    ritualDisrupted: int = 0
    departed: int = 0
    failed: int = 0
    enduranceSpent: int = 0
    knownChargeSpent: int = 0
    investigationMerit: int = 0
    rescueMerit: int = 0
    explorationMerit: int = 0


class ScoreRules:
    def __init__(self, document=None, *, program=None):
        install_roots()
        from nomos_c0.author_document_v1 import parse_author_document
        from nomos_c0.composable_value_v1 import C0ValuePorts, compile_value_program
        if document is None:
            path = WORLD_ROOT / 'player.score.yaml'
            parsed = parse_author_document(path.read_text(encoding='utf-8'), file=str(path), format='yaml')
            document, self.digest = parsed.to_data(), parsed.digest
        else:
            import hashlib
            self.digest = hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
        if (type(document) is not dict or set(document) != {'schema', 'scores', 'thaw_entries'}
                or document['schema'] != 'm1.play_score.v1'
                or type(document['scores']) is not dict or set(document['scores']) != set(SCORES)
                or type(document['thaw_entries']) is not list
                or any(type(item) is not str or not item for item in document['thaw_entries'])
                or len(set(document['thaw_entries'])) != len(document['thaw_entries'])):
            raise ValueError('Malformed play score contract')
        self.thaw_entries = frozenset(document['thaw_entries'])
        if program is not None and not self.thaw_entries <= set(dict(program.actions)):
            raise ValueError('Play score references an unselected Action')
        names = frozenset(field.name for field in fields(ScoreFacts))
        paths = frozenset('facts.' + name for name in names)
        reads = {ScoreFacts: names}
        ports = C0ValuePorts({'facts': ScoreFacts}, paths, paths, reads, reads,
                             {}, {}, {}, {}, {}, dict.fromkeys(SCORES, int))
        self.program = compile_value_program(json.dumps({'schema': 'c0.value.v1',
            'bindings': [], 'guard': True, 'outputs': document['scores']}), ports,
            admission_outputs=frozenset(SCORES))

    def evaluate(self, facts):
        return self.program.evaluate_admission_outputs({'facts': facts})


def detailed_people(frame):
    return {row['id'] for row in frame.get('observations', ())
            if row['kind'] == 'person' and row.get('detailRecordedAt') is not None
            and row.get('facts')}


class PlayLedger:
    def __init__(self, opening, rules):
        self.rules, self.start_time = rules, opening['time']
        self.facts = ScoreFacts()
        self.places = {opening['fields'].get('locationId')}
        self.details = detailed_people(opening)
        self.thawed = set()
        self.publications = set()
        self.style_choices = set()
        self.provenance = []
        self.achievements, self.actions = [], []
        self.ritual_seen = opening['information']['ritual']['phase'] == 'disrupted'

    def record(self, *, before, after, entry, label, publication, instant, personality=None,
               appraisal_key=None, merits=None, thawed_target_id=None):
        if publication is None:
            self.facts = replace(self.facts, rejectedAttempts=self.facts.rejectedAttempts + 1)
            return
        # Receipts are retained privately. One Action publication is one costed step.
        key = tuple(row.occurrence for row in publication.occurrences)
        if not key or key in self.publications:
            if not key:
                raise ValueError('Published Action needs an occurrence receipt')
            return
        if personality is not None and personality not in DIMENSIONS:
            raise ValueError('Unknown play report personality')
        if merits is not None and (set(merits) != set(DIMENSIONS)
                or any(type(value) is not int for value in merits.values())
                or appraisal_key is None):
            raise ValueError('Published style assessment needs all dimensions and a semantic key')
        previous = self.rules.evaluate(self.facts)
        facts = self.facts
        gains = []
        if merits is not None and appraisal_key not in self.style_choices:
            self.style_choices.add(appraisal_key)
            facts = replace(facts, **{field: getattr(facts, field) + merits[name]
                                     for name, field in MERIT_FIELDS.items()})

        def achieve(identity, text, evidence):
            self.achievements.append({'id': identity, 'label': text, 'evidence': evidence})
            gains.append(identity)

        place = after['fields'].get('locationId')
        # Known map endpoints are not visits; only the player's actual location counts.
        if place is not None and place not in self.places:
            self.places.add(place)
            facts = replace(facts, visitedPlaces=facts.visitedPlaces + 1)
            achieve('place:' + place, '到达：' + after['fields']['location'], '本人实际位置')
        for identity in sorted(detailed_people(after) - self.details):
            self.details.add(identity)
            row = next(row for row in after['observations'] if row['id'] == identity)
            facts = replace(facts, peopleDetailed=facts.peopleDetailed + 1)
            achieve('detail:' + identity, '了解：' + row['label'], '本人首次详细观察')
        target = instant.get('adventurer.last_thawed')
        if entry in self.rules.thaw_entries and type(target) is str and target not in self.thawed:
            self.thawed.add(target)
            facts = replace(facts, peopleThawed=facts.peopleThawed + 1)
            # Internal subject keys do not become browser target identities.
            achieve('thaw:' + str(len(self.thawed)), '实际解冻一位人物', '你花费永焰充能，让一位人物从冰封中解脱。')
        if not self.ritual_seen and after['information']['ritual']['phase'] == 'disrupted':
            self.ritual_seen = True
            facts = replace(facts, ritualDisrupted=1)
            achieve('ritual:disrupted', '察觉仪式已经中断', '你察觉到仪式不再继续，后来发生的事仍由你的见闻记下。')
        if not facts.departed and after['ending'] and after['ending']['id'] == 'departed_palace':
            facts = replace(facts, departed=1)
            achieve('ending:departed', '本人离开宫殿', '你在外岸实际选择离开，这段旅程结束。')
        if after['ending'] and after['ending']['id'] in {'adventurer_dead', 'rescue_window_expired'}:
            facts = replace(facts, failed=1)
        feedback = after.get('feedback') or {}
        result = feedback.get('result') or {}
        changes = [*result.get('changes', ()), *result.get('laterChanges', ())]

        def spent(field):
            return sum(max(0, row['before'] - row['after']) for row in changes
                       if row['field'] == field and type(row.get('before')) is int
                       and type(row.get('after')) is int)

        self.facts = replace(facts, publishedActions=facts.publishedActions + 1,
            manualActions=facts.manualActions + (personality is None),
            delegatedActions=facts.delegatedActions + (personality is not None),
            elapsed=after['time'] - self.start_time,
            enduranceSpent=facts.enduranceSpent + spent('endurance'),
            knownChargeSpent=facts.knownChargeSpent + spent('everflameCharges'))
        scores = self.rules.evaluate(self.facts)
        self.publications.add(key)
        self.provenance.append(publication)
        self.actions.append({'number': len(self.actions) + 1, 'label': label, 'entry': entry,
            'mode': 'delegated' if personality else 'manual', 'personality': personality,
            'timeBefore': before['time'], 'timeAfter': after['time'], 'achievements': gains,
            'scoreDelta': {name: scores[name] - previous[name] for name in SCORES}})
        if entry in self.rules.thaw_entries and type(target) is str and thawed_target_id:
            self.actions[-1]['thawedTargetId'] = thawed_target_id

    def snapshot(self, frame):
        scores = self.rules.evaluate(self.facts)
        count = self.facts.publishedActions
        return deepcopy({'schema': 'm1.play_report.v1',
            'status': 'finished' if frame['ending'] else 'ongoing',
            'scores': scores, 'metrics': {field.name: getattr(self.facts, field.name)
                                         for field in fields(self.facts)},
            'efficiency': {name: round((scores['common'] + scores[name] - scores['cost']) / count, 2)
                           if count else None for name in DIMENSIONS},
            'achievements': self.achievements, 'actions': self.actions,
            'rescuesConfirmed': None, 'scoreRulesDigest': self.rules.digest})
