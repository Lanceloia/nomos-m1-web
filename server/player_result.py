"""Display-only action evidence from the adventurer's authorized views."""
if __package__:
    from .projection import ICE_MOVEMENTS, MOVEMENTS, movement_attempt
else:
    from projection import ICE_MOVEMENTS, MOVEMENTS, movement_attempt

# Small public scalar allowlist: no world snapshot, raw refs or composite records.
SCALARS = (
    ('location', 'adventurer.site'), ('life', 'adventurer.vital.life'),
    ('endurance', 'adventurer.vital.endurance'), ('everflameCharges', 'adventurer.known_everflame_charges'),
    ('carriedReservoirCharges', 'adventurer.known_reservoir_charges'),
    ('coldCondition', 'adventurer.cold_state'), ('gold', 'adventurer.gold'),
    ('chandelierClue', 'adventurer.chandelier_sighting.notice'),
    ('ritualSigns', 'adventurer.ritual_notice'),
)


def changed(before, after):
    rows = []
    for field, key in SCALARS:
        old, new = before.get(key), after.get(key)
        if old == new or type(new) not in (str, int, bool):
            continue
        row = {'field': field, 'after': new}
        if type(old) in (str, int, bool):
            row['before'] = old
        rows.append(row)
    return rows


def player_result(offer, before, instant, after, published):
    if not published:
        return None
    payload = dict(offer.payload)
    crossing = next((c for c in before.get('adventurer.known_crossings', ())
                     if c.key == payload.get('crossing')), None) if offer.entry in ICE_MOVEMENTS else None
    target = (crossing.intended if crossing else payload.get('destination')) if offer.entry in MOVEMENTS else None
    landing = instant.get('adventurer.site')
    result = {'changes': changed(before, instant), 'laterChanges': changed(instant, after)}
    if offer.entry == 'move_adventurer':
        attempt = movement_attempt(instant)
        prior = movement_attempt(before)
        if (attempt and (prior is None or attempt.action != prior.action)
                and attempt.start == before.get('adventurer.site')
                and attempt.destination == target and attempt.landing == landing):
            result['movementAttempt'] = {name: getattr(attempt, name)
                for name in ('start', 'destination', 'landing', 'outcome')}
            result.update(landing=attempt.landing, target=attempt.destination)
    elif offer.entry in MOVEMENTS and type(landing) is str:
        result['landing'] = landing
        if type(target) is str:
            result['target'] = target
        if crossing and getattr(crossing, 'collision', None) == landing and crossing.intended != landing:
            result['collision'] = True
    for kind, prefix in (('balance', 'adventurer.last_cross_'), ('cold', 'adventurer.last_cold_')):
        # Ref identity is evidence only. It is never transported to the browser.
        reference = instant.get(prefix + 'ref')
        roll = instant.get(prefix + 'roll')
        if reference is not None and reference != before.get(prefix + 'ref') and type(roll) is int:
            result.setdefault('rolls', []).append({'kind': kind, 'value': roll})
        later_ref = after.get(prefix + 'ref')
        later_roll = after.get(prefix + 'roll')
        if later_ref is not None and later_ref != reference and type(later_roll) is int:
            result.setdefault('laterRolls', []).append({'kind': kind, 'value': later_roll})
    return result
