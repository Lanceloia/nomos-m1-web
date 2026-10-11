"""Presentation of authorized observations; never reads author/world snapshots."""


def scalar_records(paths, visible, presentation, terms, describe_person=None):
    """Declared seat-visible scalars only; absent optional leaves are explicit."""
    labels = dict(presentation.fields)
    values = dict(visible)
    rows = []
    for path in paths:
        value = values.get(path)
        if path == 'adventurer.person_sighting.subject' and type(value) is str and describe_person:
            value = describe_person(value)
        row = {'label': labels[path]}
        if value is not None:
            if type(value) not in (str, int, bool):
                raise ValueError('Authored display record requires a visible scalar')
            row['value'] = terms.get(value, value) if type(value) is str else value
        rows.append(row)
    return rows


def offer_forecasts(offer, presentation, terms):
    """Only named, checked preview scalars; a missing value stays unknown."""
    columns = dict(getattr(presentation, 'preview_fields', ())).get(offer.entry, ())
    values = dict(getattr(offer, 'preview', ()))
    result = []
    for key, heading in columns:
        item = {'label': heading}
        value = values.get(key)
        if type(value) in (str, int, bool):
            item['value'] = terms.get(value, value) if type(value) is str else value
        result.append(item)
    return result


def action_feedback(offer, presentation, terms, published):
    """Publication describes the action, not achievement of its intended goal."""
    messages = getattr(presentation, 'published_actions' if published else 'rejected_actions', ())
    fallback = presentation.published if published else presentation.rejected
    action_label = ''.join(terms.get(text, text) if translate else text
                           for text, translate in offer.label_fragments) if offer.label_fragments else offer.label
    return {'status': 'published' if published else 'rejected', 'entry': offer.entry, 'actionLabel': action_label,
            'text': dict(messages).get(offer.entry, fallback)}

MOVEMENTS = {
    'move_adventurer': 'walk', 'move_wall_adventurer': 'walk',
    'bridge_slow_adventurer': 'bridge', 'bridge_rush_adventurer': 'rush',
    'pass_door_adventurer': 'door', 'climb_skyhook_adventurer': 'climb',
    'balloon_flight_adventurer': 'flight', 'balloon_push_adventurer': 'transport',
    'balloon_push_bridge_adventurer': 'transport', 'balloon_push_door_adventurer': 'transport',
    'carry_move_adventurer': 'carry', 'carry_bridge_slow_adventurer': 'carry',
    'carry_pass_door_adventurer': 'carry', 'cross_ice_adventurer': 'ice',
    'carry_cross_ice_adventurer': 'carry', 'balloon_push_ice_adventurer': 'transport',
}
ICE_MOVEMENTS = {'cross_ice_adventurer', 'carry_cross_ice_adventurer', 'balloon_push_ice_adventurer'}


def movement_attempt(visible):
    """Validate only the declared Actor-local receipt, retaining refs internally."""
    record = visible.get('adventurer.conversations.movement_attempt')
    if record is None:
        return None
    if any(type(getattr(record, name, None)) is not str
           for name in ('start', 'destination', 'landing', 'outcome')):
        return None
    if record.outcome not in ('arrived', 'blocked') or getattr(record, 'action', None) is None:
        return None
    expected = record.start if record.outcome == 'blocked' else record.destination
    return record if record.landing == expected else None


def passage_warning(offer, visible, alternatives):
    """Knowledge describes a possible passage, never private guard eligibility."""
    if offer.entry != 'move_adventurer':
        return None
    site = visible.get('adventurer.site')
    destination = dict(offer.payload).get('destination')
    floor = visible.get('adventurer.floor_sighting')
    floor_state = 'unknown'
    if (floor is not None and getattr(floor, 'site', None) == site
            and type(getattr(floor, 'frozen', None)) is bool):
        floor_state = 'frozen' if floor.frozen else 'clear'
    attempt = movement_attempt(visible)
    blocked = bool(attempt and attempt.start == site and attempt.destination == destination
                   and attempt.outcome == 'blocked')
    known = {c.key for c in visible.get('adventurer.known_crossings', ())
             if c.start == site and c.intended == destination}
    indexes = [index for index, other in alternatives
               if other.entry == 'cross_ice_adventurer'
               and dict(other.payload).get('crossing') in known]
    return {'floorState': floor_state, 'lastAttemptBlocked': blocked,
            'crossingIndexes': indexes}


def heard_escort_replies(visible):
    """Only the player's actual heard list establishes receipt of a reply."""
    records = visible.get('adventurer.conversations.heard_escort_replies')
    if type(records) is not tuple:
        return ()
    valid = []
    for record in records:
        reply = getattr(record, 'reply', None)
        if getattr(record, 'hearing', None) is None or reply is None:
            continue
        if any(type(getattr(reply, field, None)) is not str
               for field in ('speaker', 'recipient', 'site', 'destination', 'status')):
            continue
        if reply.status not in ('ready_now', 'not_ready_now', 'unable_now'):
            continue
        if any(getattr(reply, field, None) is None
               for field in ('invitation', 'invitation_hearing', 'action')):
            continue
        valid.append(record)
    return tuple(valid)


def observations(visible, terms, identify, describe_person):
    """Records are observation history, not an authoritative live inventory."""
    result = {}
    def translated(value):
        if type(value) is bool:
            return '是' if value else '否'
        return terms.get(value, value) if isinstance(value, str) else str(value)

    def put(identity, kind, title, site=None, state='unknown', facts=(), evidence='last_observed', source=None, basis=None):
        item = {'id': identify(identity), 'kind': kind,
                'label': describe_person(identity) if kind == 'person' else translated(title),
                'site': site, 'state': state, 'evidence': evidence,
                'facts': [{'label': key, 'value': translated(value)} for key, value in facts if value is not None]}
        item['_source'] = source or kind
        item['_basis'] = basis
        result[item['id'], item['_source']] = item

    for resident in visible.get('adventurer.known_residents', ()):
        put(resident.name, 'person', resident.name, resident.site,
            source='known_residents', basis=getattr(resident, 'observation', None))
    for wall in visible.get('adventurer.known_walls', ()):
        put(wall.individual, 'wall', '已检查的冰墙', evidence='checked_target',
            source='known_walls', basis=wall.observed_ref)
    for key in ('adventurer.known_bar_bears', 'adventurer.conversations.prison.contacts'):
        for contact in visible.get(key, ()):
            put(contact.name, 'person', contact.name, contact.site,
                source=key, basis=getattr(contact, 'observation', None))
    person = visible.get('adventurer.person_sighting')
    if person:
        state = person.life if person.life != 'alive' else person.cold_state
        put(person.subject, 'person', person.subject, person.site, state,
            [('生命', person.life), ('御寒', person.cold_state)],
            source='person_sighting', basis=getattr(person, 'observation', None))
    tower = visible.get('adventurer.conversations.tower')
    if tower is not None and tower.offer is not None and tower.hearing is not None:
        offer = tower.offer
        condition = {
            'emma_leaves_alive': '以艾玛活着离开宫殿为条件，提出交付所许诺的物品。',
        }.get(offer.condition, '已听到一项尚未能解释的条件。')
        put('observation:tower_offer', 'dialogue', '我实际听到的护送提议',
            state='heard', evidence='heard_offer', source='tower_offer', basis=tower.hearing,
            facts=[('条件', condition),
                   ('现状', '提议不等于已经交付，也不保证最终兑现。'),
                   ('接受的含义', '若你选择接受，你只是在当场表示接受；不保证对方听见、采取行动或交付物品。')])
    for key, kind, title, identity_key, fact_keys in (
        ('adventurer.resources.chest', 'chest', '宝箱', 'chest', [('开合', 'opened'), ('金币', 'gold')]),
        ('adventurer.resources.balloon', 'balloon', '气球', 'balloon', [('已观察充能', 'charges')]),
        ('adventurer.drink_sighting', 'drink', '饮料容器', 'container', [('持有人', 'holder'), ('份数', 'portions'), ('冰封', 'frozen')]),
        ('adventurer.prison_access.bars', 'bars', '牢门栅栏', 'individual', [('开合', 'opened')]),
        ('adventurer.elemental_sighting', 'elemental', '冰元素', 'subject', []),
        ('adventurer.floor_sighting', 'floor', '冰面', 'key', [('冰封', 'frozen')]),
    ):
        record = visible.get(key)
        if record:
            put(getattr(record, identity_key), kind, getattr(record, 'label', title),
                getattr(record, 'site', None), state=('frozen' if record.frozen else 'normal') if kind == 'floor' else 'unknown', facts=[(label, getattr(record, field, None)) for label, field in fact_keys],
                source=key, basis=getattr(record, 'observation', getattr(record, 'basis', None)))
    receipt = visible.get('adventurer.treasure_receipt')
    if receipt:
        put(receipt.item, 'treasure', receipt.label, evidence='last_acquired',
            source='treasure_receipt', basis=getattr(receipt, 'acquisition', None))
    chandelier = visible.get('adventurer.chandelier_sighting')
    if chandelier:
        put('observation:chandelier', 'chandelier', '吊灯', facts=[('线索', chandelier.notice), ('安装处已观察', chandelier.mount_observed)],
            source='chandelier_sighting', basis=getattr(chandelier, 'observation', None))
    line = visible.get('adventurer.prison_access.line')
    if line:
        guardian = line.guardian
        put(guardian.name, 'person', guardian.name, guardian.site if guardian.present else None,
            facts=[('在场', guardian.present)], source='prison_line', basis=getattr(guardian, 'observation', None))
    return list(result.values())
