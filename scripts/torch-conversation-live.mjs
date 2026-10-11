// Short real-session witness; target eligibility comes only from current public offers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const root = process.env.M1_WEB_URL ?? 'http://127.0.0.1:5173';
const output = process.env.M1_EVIDENCE ?? '/tmp/m1-torch-conversation-live.json';
async function call(path, body, expected = 200) {
  const response = await fetch(root + path, body ? { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
const health = await call('/api/health');
assert.equal(health.status, 'ready');
assert.equal(health.compileCount, 1);
let current = await call('/api/sessions', { requestId: randomUUID() }, 201);
const opening = current;
const steps = [];
async function choose(offer) {
  assert.ok(offer, 'Required current offer is missing');
  const body = { requestId: randomUUID(), revision: current.revision, index: offer.index };
  const previous = current;
  current = await call(`/api/sessions/${current.sessionId}/actions`, body);
  if (current.frame.feedback.status !== 'published') {
    await writeFile(output, JSON.stringify({ health, opening, steps, attempted: offer, refused: current }, null, 2));
  }
  assert.equal(current.frame.feedback.status, 'published');
  const repeated = await call(`/api/sessions/${current.sessionId}/actions`, body);
  assert.deepEqual(repeated, current, 'Duplicate request must not publish another action');
  await call(`/api/sessions/${current.sessionId}/actions`,
    { ...body, requestId: randomUUID(), revision: previous.revision }, 409);
  assert.deepEqual(await call(`/api/sessions/${current.sessionId}`), current);
  steps.push({ offer, response: current });
  console.log(`${offer.entry}: published at ${current.frame.time}`);
}
for (const destination of ['ritual_passage_entry', 'ritual_threshold', 'ritual_ring']) {
  await choose(current.frame.offers.find(row => row.entry === 'cross_ice_adventurer'
    && row.destination === destination) ?? current.frame.offers.find(row =>
    row.entry === 'move_adventurer' && row.destination === destination));
  assert.equal(current.frame.scene.playerSite, destination);
}
const frozen = current;
assert.ok(current.frame.information.visibleEntities.some(row => row.label.startsWith('博科尔德')));
assert.ok(!current.frame.offers.some(row => row.entry === 'offer_torch_adventurer'),
  'Frozen resident and unsupported Bokolds must not produce a conversation offer');
// Acquiring detail, thawing, and addressing the resident remain distinct real Actions.
const intervention = current.frame.offers.find(row => row.entry === 'thaw_ritual_resident');
if (intervention) await choose(intervention);
else {
  const resident = current.frame.information.visibleEntities.find(row => row.label.includes('仪式')
    && !row.label.startsWith('博科尔德'));
  assert.ok(resident, 'Current public ritual resident is required');
  await choose(current.frame.offers.find(row => row.entry === 'observe_resident_adventurer'
    && row.targetIds?.includes(resident.id)));
  await choose(current.frame.offers.find(row => row.entry === 'thaw_person_adventurer'
    && row.targetIds?.includes(resident.id)));
}
const thawed = current;
const conversation = current.frame.offers.find(row => row.entry === 'offer_torch_adventurer');
assert.ok(conversation, 'Awake colocated bound resident must get the real conversation option');
await choose(conversation);
const final = current;
const second = await call('/api/sessions', { requestId: randomUUID() }, 201);
assert.notEqual(second.sessionId, opening.sessionId);
assert.deepEqual(second.frame, opening.frame, 'New session must have independent opening state');
assert.deepEqual(await call(`/api/sessions/${current.sessionId}`), current);
// The observation branch costs time, so it must not postpone the valid rescue witness.
current = second;
for (const destination of ['ritual_passage_entry', 'ritual_threshold', 'ritual_ring']) {
  await choose(current.frame.offers.find(row => row.entry === 'cross_ice_adventurer'
    && row.destination === destination) ?? current.frame.offers.find(row =>
    row.entry === 'move_adventurer' && row.destination === destination));
}
const bokold = current.frame.information.visibleEntities.find(row => row.label.startsWith('博科尔德'));
await choose(current.frame.offers.find(row => row.entry === 'observe_resident_adventurer'
  && row.targetIds?.includes(bokold.id)));
assert.ok(!current.frame.offers.some(row => row.entry === 'thaw_person_adventurer'
  && row.targetIds?.includes(bokold.id)));
assert.equal(current.frame.information.ritual.phase, 'completed');
assert.ok(!current.frame.offers.some(row => row.entry === 'thaw_ritual_resident'));
assert.deepEqual(await call(`/api/sessions/${final.sessionId}`), final);
assert.equal((await call('/api/health')).compileCount, 1);
await writeFile(output, JSON.stringify({ health, opening, frozen, thawed, steps, final,
  second, observedBokold: current, proof: { frozenAndUnsupportedOffersAbsent: true, realConversationPublished: true,
    observedBokoldHasNoGenericThaw: true,
    heardCompletionHasNoQuickThaw: true,
    duplicateStable: true, staleRejected: true, independentSessions: true, compileCount: 1 } }, null, 2));
console.log(JSON.stringify({ output, actions: steps.length, published: true }));
