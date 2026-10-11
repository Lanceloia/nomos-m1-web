"""Session-local display memory of already authorized, rendered observations."""
import copy
import json


RITUAL_PHASES = {
    'preparing': ('preparing', '曾察觉仪式正在准备'),
    'gathering': ('gathering', '曾察觉仪式仍在进行'),
    'critical': ('critical', '曾察觉仪式接近完成'),
    'disrupted': ('disrupted', '曾察觉仪式已中断'),
    'erupted': ('completed', '曾察觉仪式已完成'),
}


class PlayerInformation:
    """Presentation history, not Actor knowledge or a live entity registry."""

    def __init__(self):
        self.records = {}
        self.ritual = {'phase': 'unknown', 'label': '尚未察觉仪式现况',
                       'evidence': 'unknown', 'recordedAt': None}
        self.movements = {}
        self.escort_replies = {}
        self.invitation_baseline = None
        self.reply_baseline = None
        self.anonymous_labels = {}
        self.descriptions = {}
        self.description_labels = {}
        self.person_subjects = set()
        self.last_inputs = {}
        self.visible_entities = []
        self.nearby_entities = []
        self.visibility = 'not_provided'

    def capture_surface(self, fields, identify, terms):
        """Translate the authored current-area projection, without owner lookups."""
        site = fields.get('adventurer.site')
        rows = dict(fields.get('known_site_protection', ()))
        cells = dict(rows.get(site, ()))
        available = cells.get('surface_available')
        self.visibility = 'provided' if available is True else 'unavailable' if available is False else 'not_provided'
        self.visible_entities = []
        self.nearby_entities = []
        if available is not True:
            return []
        for field, description in cells.items():
            if field.startswith('description_person_') and type(description) is str and description:
                self.descriptions[field.removeprefix('description_person_')] = description
        object_labels = {'chandelier': '枝形吊灯', 'reservoir': '吊灯储能器', 'torch': '永焰'}
        for field, present in cells.items():
            if field.startswith('visible_person_') and type(present) is str and present:
                subject = field.removeprefix('visible_person_')
                entity = {'id': identify(subject), 'kind': 'person',
                          'label': self.person_label(subject, identify, terms),
                          'site': present, 'state': 'unknown', 'facts': [],
                          'evidence': 'current_surface', 'presence': 'current'}
                (self.visible_entities if present == site else self.nearby_entities).append(entity)
                continue
            if present is not True or not field.startswith('presence_'):
                continue
            if field.startswith('presence_object_'):
                subject = field.removeprefix('presence_object_')
                identity = cells.get('target_' + subject)
                if identity is None:
                    raise ValueError('Authored visible object lacks its actual target identity')
                kind, label = 'everflame' if subject == 'torch' else subject, object_labels.get(subject, subject)
            else:
                continue
            self.visible_entities.append({'id': identify(identity), 'kind': kind, 'label': label,
                                          'site': site, 'state': 'unknown', 'facts': [],
                                          'evidence': 'current_surface', 'presence': 'current'})
        return [{**row, 'evidence': 'last_perceived', '_source': 'current_surface'}
                for row in (*self.visible_entities, *self.nearby_entities)]

    def capture(self, records, notice, time, revision):
        """A receipt time locates the readback, not the world's observation Event."""
        discoveries = []
        stamp = {'time': time, 'revision': revision}
        incoming = {}
        fresh_details = set()
        current_ids = {row['id'] for row in records if row['_source'] == 'current_surface'}
        # Local publication order separates retained details from newer location
        # receipts. The authored current surface is later than retained records.
        ordered = sorted(records, key=lambda row: (
            row['_source'] == 'current_surface', getattr(row.get('_basis'), 'value', -1)))
        for record in ordered:
            item = copy.deepcopy(record)
            basis = item.pop('_basis', None)
            source = item.pop('_source')
            stream = (item['id'], source)
            signature = (basis, json.dumps(item, sort_keys=True))
            # Surface presence is a current reading, not a retained observation
            # slot. Reappearance must override a location acquired while absent.
            if source != 'current_surface' and self.last_inputs.get(stream) == signature:
                continue
            self.last_inputs[stream] = signature
            if basis is not None and (item['facts'] or item['state'] != 'unknown'):
                fresh_details.add(item['id'])
            prior = incoming.get(item['id'])
            if prior and not item['facts'] and item['state'] == 'unknown':
                item['facts'], item['state'] = prior['facts'], prior['state']
                item['evidence'] = prior['evidence']
            incoming[item['id']] = item
        for record in incoming.values():
            prior = self.records.get(record['id'])
            item = copy.deepcopy(record)
            item['presence'] = 'not_confirmed'
            item['recordedAt'] = stamp.copy()
            item['detailRecordedAt'] = stamp.copy() if item['facts'] or item['state'] != 'unknown' else None
            if prior:
                # A generic identity sighting does not retract an acquired detail.
                if not item['facts'] and item['state'] == 'unknown':
                    item['facts'] = copy.deepcopy(prior['facts'])
                    item['state'] = prior['state']
                    item['detailRecordedAt'] = copy.deepcopy(prior['detailRecordedAt'])
                if item['site'] is None and prior['site'] is not None:
                    item['site'] = prior['site']
                if item['id'] not in fresh_details and item['facts'] == prior['facts'] and item['state'] == prior['state']:
                    item['detailRecordedAt'] = copy.deepcopy(prior['detailRecordedAt'])
                if item['id'] not in fresh_details and all(item[key] == prior[key] for key in ('kind', 'label', 'site', 'state', 'facts', 'evidence')):
                    if item['id'] in current_ids:
                        # A real current reading renews location evidence, not detail.
                        self.records[item['id']] = item
                    continue
            self.records[item['id']] = item
            discoveries.append({'kind': 'observation', 'change': 'updated' if prior else 'new',
                                'observation': copy.deepcopy(item)})
        phase = RITUAL_PHASES.get(notice)
        if phase and phase[0] != self.ritual['phase']:
            self.ritual = {'phase': phase[0], 'label': phase[1],
                           'evidence': 'last_observed', 'recordedAt': stamp.copy()}
            discoveries.append({'kind': 'ritual', 'phase': phase[0], 'label': phase[1]})
        return discoveries

    def observations(self):
        return copy.deepcopy(list(self.records.values()))

    def person_label(self, name, identify, terms):
        """Provide a stable local handle, without revealing an unlearned name."""
        self.person_subjects.add(name)
        if name in terms:
            return terms[name]
        identity = identify(name)
        description = self.descriptions.get(name)
        if description:
            key = (identity, description)
            if key not in self.description_labels:
                number = 1 + sum(label.startswith(description + ' · ')
                                 for label in self.description_labels.values())
                self.description_labels[key] = f'{description} · {number}'
            return self.description_labels[key]
        if identity not in self.anonymous_labels:
            self.anonymous_labels[identity] = f'附近的人 · {len(self.anonymous_labels) + 1}'
        return self.anonymous_labels[identity]

    def record_invitation(self):
        """Remember a published player invitation, without claiming NPC assent."""
        self.invitation_baseline = frozenset(self.movements)
        self.reply_baseline = frozenset(self.escort_replies)

    def capture_replies(self, records, identify, terms, time, revision, prior=()):
        """Append actual heard receipts; old hearing refs are never this step."""
        discoveries = []
        prior_hearings = {record.hearing for record in prior}
        for record in records:
            if record.hearing in self.escort_replies:
                continue
            reply = record.reply
            item = {'id': f'reply-{len(self.escort_replies) + 1}',
                    'subjectId': identify(reply.speaker),
                    'label': self.person_label(reply.speaker, identify, terms),
                    'site': reply.site, 'destination': reply.destination, 'status': reply.status,
                    'recordedAt': {'time': time, 'revision': revision}}
            self.escort_replies[record.hearing] = item
            if record.hearing not in prior_hearings:
                discoveries.append({'kind': 'escort_reply', 'reply': copy.deepcopy(item)})
        return discoveries

    def capture_movements(self, log, identify, terms, time, revision):
        """Accept only the declared player-local movement records, not NPC state."""
        discoveries = []
        for record in (() if log is None else log.entries):
            basis = (record.motion.action, record.observation)
            if basis in self.movements:
                continue
            motion = record.motion
            item = {'id': f'motion-{len(self.movements) + 1}',
                    'subjectId': identify(motion.name), 'label': self.person_label(motion.name, identify, terms),
                    'start': motion.start, 'end': motion.end,
                    'recordedAt': {'time': time, 'revision': revision}}
            self.movements[basis] = item
            discoveries.append({'kind': 'movement', 'movement': copy.deepcopy(item)})
        return discoveries

    def snapshot(self):
        movements = copy.deepcopy(list(self.movements.values()))
        after_invitation = self.invitation_baseline is not None and any(
            basis not in self.invitation_baseline for basis in self.movements)
        heard_after = self.reply_baseline is not None and any(
            hearing not in self.reply_baseline for hearing in self.escort_replies)
        response_label = ('邀请后实际听到了人物答复；这是当时的准备状态，不保证随后跟随、抵达或安全。'
                          if heard_after else
                          '邀请后察觉附近人物的实际移动；不证明因邀请而行动、答应护送或已经获救。'
                          if after_invitation else '邀请后尚未观察到新的附近人物移动；不能据此认定接受或拒绝。'
                          if self.invitation_baseline is not None else '尚未发出护送邀请；人物自行移动不表示回应。')
        return {'visibleEntities': copy.deepcopy(self.visible_entities),
                'nearbyEntities': copy.deepcopy(self.nearby_entities), 'visibility': self.visibility,
                'visibilityNotice': '这里只确认眼前存在和粗略位置；详细状态仍需观察。' if self.visibility == 'provided' else
                                    '当前无法取得表面感知；历史记录不能证明眼前在场。',
                'ritual': copy.deepcopy(self.ritual),
                'movements': movements,
                'escortReplies': copy.deepcopy(list(self.escort_replies.values())),
                'escortResponse': {'status': 'reply_heard' if heard_after else 'movement_observed' if after_invitation else 'not_observed',
                                   'label': response_label},
                'timingNotice': '观察和其他行动都会推进寒冷与仪式；停下来思考不会推进世界。'}
