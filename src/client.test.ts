import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntentPolicyRunner, SessionClient } from './client';
import { contextOffers, sessionRouteChanges, targetNames } from './tabletop';
import { selectedSiteOffers, spatialGraph } from './spatial';
import type { IntentPolicy, PolicyStartSettings, SessionResponse } from './types';
import { emptyPlayReport } from './playReport.fixtures';

const response: SessionResponse = { sessionId: 'test-session', revision: 0, frame: {
  time: 0, ending: null, offers: [], observations: [],
  fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: 'Ballroom entrance', everflameCharges: 5, carriedReservoirCharges: null, coldCondition: 'Able to move', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
  information: {
    visibleEntities: [], nearbyEntities: [], movements: [], visibility: 'not_provided', visibilityNotice: '当前在场尚未确认。',
    ritual: { phase: 'unknown', label: '尚未察觉仪式现况', evidence: 'unknown', recordedAt: null },
    escortResponse: { status: 'not_observed', label: '尚未取得护送邀请的回应观察。' },
    timingNotice: '观察和其他行动都会推进寒冷与仪式；停下来思考不会推进世界。',
  },
}, entries: [], playReport: emptyPlayReport() };
const startSettings: PolicyStartSettings = { maxActions: 64, stopOnUnexpected: true };
const policyResponse = (status: IntentPolicy['status'] = 'running', revision = 0, policyRevision = 1): SessionResponse => ({
  ...response, revision, policyRevision,
  intentOffers: [{ id: 'cautious_investigator', label: '谨慎调查者', description: '先弄清所见，再审慎行动。', maxActions: 24 }],
  policy: { id: status === 'idle' ? null : 'provided-policy/9', intentId: status === 'idle' ? null : 'cautious_investigator', status, label: status === 'idle' ? null : '谨慎调查者', reason: status === 'stopped' ? '公开停止原因' : null, executed: revision, limit: 64, stopOnUnexpected: true, plan: null, steps: [], stopDetail: status === 'stopped' ? { code: 'cancelled', choices: [] } : null },
});
const ok = (value = response) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('session transport', () => {
  it.each(['K0_NOT_ADMITTED', 'C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'] as const)('parses the required rejected code %s without deriving a private cause', async code => {
    const supplied: SessionResponse = { ...response, frame: { ...response.frame, feedback: {
      status: 'rejected', refusal: { code }, actionLabel: 'Attempt', text: '公开检查建议。',
    } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(supplied)));
    expect((await new SessionClient().start()).frame.feedback).toEqual(supplied.frame.feedback);
  });
  it.each([undefined, null, {}, { code: 'private_guard' }, { code: 'K0_NOT_ADMITTED', exception: 'private-source' }])('rejects missing or unrecognized refusal %j instead of a legacy fallback', async refusal => {
    const payload = { ...response, frame: { ...response.frame, feedback: {
      status: 'rejected', refusal, actionLabel: 'Attempt', text: '公开检查建议。',
    } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
    await expect(new SessionClient().start()).rejects.toThrow('反馈回执格式无效，请同步会话。');
  });
  it('requires published feedback to omit refusal', async () => {
    const payload = { ...response, frame: { ...response.frame, feedback: {
      status: 'published', refusal: { code: 'K0_NOT_ADMITTED' }, actionLabel: 'Attempt', text: 'Published',
    } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
    await expect(new SessionClient().start()).rejects.toThrow('反馈回执格式无效');
  });
  it('keeps an invalid action readback uncertain until explicit refresh, without replaying it', async () => {
    const malformed = { ...response, revision: 1, frame: { ...response.frame, feedback: { status: 'rejected', actionLabel: 'Attempt', text: 'Unknown' } } };
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response(JSON.stringify(malformed), { status: 200 }))
      .mockResolvedValueOnce(ok({ ...response, revision: 1 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.choose(9)).rejects.toThrow('反馈回执格式无效');
    await expect(client.choose(9)).rejects.toThrow('请先同步'); expect(fetcher).toHaveBeenCalledTimes(2);
    await client.refresh(); expect(fetcher.mock.calls[2][1].method).toBe('GET');
  });
  it.each([
    ['dead', 'mobile'], ['incapacitated', 'frozen'], ['alive', 'immune'], [null, null],
  ] as const)('parses required own states %s/%s independently of localized display fields', async (lifeState, coldState) => {
    const supplied: SessionResponse = { ...response, frame: { ...response.frame, fields: { ...response.frame.fields,
      lifeState, coldState, life: 'Alive', coldCondition: 'Able to move',
    } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(supplied)));
    const received = await new SessionClient().start();
    expect(received.frame.fields).toMatchObject({ lifeState, coldState, life: 'Alive', coldCondition: 'Able to move' });
    expect(Object.hasOwn(received.frame.fields, 'lifeState')).toBe(true);
    expect(Object.hasOwn(received.frame.fields, 'coldState')).toBe(true);
  });
  it('starts once even when mounting code requests it twice', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok()); vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient();
    const first = client.start(); const second = client.start();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('submits actual index with revision and unique request identity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ ...response, revision: 1 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start(); await client.choose(27);
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.index).toBe(27); expect(body.revision).toBe(0); expect(typeof body.requestId).toBe('string');
  });
  it('blocks overlapping submissions and uncertain replay until a read succeeds', async () => {
    let reject!: (e: Error) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockImplementationOnce(() => new Promise((_, no) => { reject = no; })).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const first = client.choose(1);
    await expect(client.choose(1)).rejects.toThrow('同步');
    reject(new Error('network lost')); await expect(first).rejects.toThrow('network lost');
    await expect(client.choose(1)).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.refresh(); await client.choose(1);
    expect(fetcher.mock.calls[2][0]).toBe('/api/sessions/test-session');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('restores a local handle by reading, not replaying any action', async () => {
    const storage = { getItem: () => JSON.stringify({ id: 'existing', revision: 3 }), setItem: vi.fn() } as unknown as Storage;
    const fetcher = vi.fn().mockResolvedValue(ok()); vi.stubGlobal('fetch', fetcher);
    await new SessionClient(storage).start();
    expect(fetcher.mock.calls[0][0]).toBe('/api/sessions/existing');
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
  });
  it('does not lose a published result when local storage is unavailable', async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ok()));
    await expect(new SessionClient(storage).start()).resolves.toMatchObject({ sessionId: 'test-session' });
  });
  it('allows an explicit new session after an expired local handle', async () => {
    const storage = { getItem: () => JSON.stringify({ id: 'expired', revision: 3 }), setItem: vi.fn() } as unknown as Storage;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unknown session' }), { status: 404 })).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(storage);
    await expect(client.start()).rejects.toThrow('unknown session');
    await expect(client.newSession()).resolves.toMatchObject({ sessionId: 'test-session' });
    expect(fetcher.mock.calls[1][0]).toBe('/api/sessions');
  });
  it('blocks restart and new-session creation while an action is in flight', async () => {
    let complete!: (result: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const action = client.choose(27);
    await expect(client.restart()).rejects.toThrow('同步');
    await expect(client.newSession()).rejects.toThrow('等待');
    expect(fetcher).toHaveBeenCalledTimes(2);
    complete(ok({ ...response, revision: 1 })); await action;
  });
  it('blocks action and duplicate restart until the first restart completes', async () => {
    let complete!: (result: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const restart = client.restart();
    await expect(client.choose(27)).rejects.toThrow('同步');
    await expect(client.restart()).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(2);
    complete(ok({ ...response, revision: 1 })); await restart;
    expect(fetcher.mock.calls[1][0]).toBe('/api/sessions/test-session/restart');
  });
  it('does not replay an uncertain action through restart, and uses refreshed revision', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockRejectedValueOnce(new Error('lost receipt'))
      .mockResolvedValueOnce(ok({ ...response, revision: 4 })).mockResolvedValueOnce(ok({ ...response, revision: 5 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.choose(27)).rejects.toThrow('lost receipt');
    await expect(client.restart()).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.refresh(); await client.choose(31);
    expect(fetcher.mock.calls[2][1].method).toBe('GET');
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ index: 31, revision: 4 });
    expect(fetcher.mock.calls.filter(call => call[0] === '/api/sessions')).toHaveLength(1);
  });
  it('reuses an explicitly created replacement session rather than opening it again', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ ...response, sessionId: 'replacement' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const replacement = await client.newSession();
    expect(await client.start()).toBe(replacement);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('submits an anonymous nearby-person offer through the existing paid action index, not a new observation request', async () => {
    const offer = { index: 811, entry: 'observe_resident_adventurer', label: 'Observe nearby person', targetIds: ['seen-123'] };
    const nearby: SessionResponse = { ...response, frame: { ...response.frame, offers: [offer], information: { ...response.frame.information, visibility: 'provided', nearbyEntities: [{
      id: 'seen-123', kind: 'person', label: '未辨认姓名的个体 3', site: 'ballroom_entrance', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current',
    }] } } };
    const fetcher = vi.fn().mockResolvedValueOnce(ok(nearby)).mockResolvedValueOnce(ok({ ...nearby, revision: 1 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); const initial = await client.start();
    const associated = contextOffers(initial.frame, { kind: 'surface', id: 'seen-123' });
    expect(associated).toHaveLength(1); expect(associated[0].index).toBe(811);
    expect(targetNames(associated[0], initial.frame)).toEqual(['未辨认姓名的个体 3']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.choose(associated[0].index);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[1][0]).toBe('/api/sessions/test-session/actions');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ index: 811, revision: 0 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty('targetIds');
  });
  it('derives route record differences only from returned frames without requesting more world information', async () => {
    const initial: SessionResponse = { ...response, frame: { ...response.frame, scene: { playerSite: 'ritual_threshold', knownSites: ['ritual_threshold'], siteLabels: { ritual_lower_stair: 'Ritual lower stair' }, routes: [] } } };
    const next: SessionResponse = { ...initial, revision: 1, frame: { ...initial.frame, scene: { ...initial.frame.scene!, routes: [{ start: 'ritual_threshold', end: 'ritual_lower_stair', kind: 'ice' }] } } };
    const fetcher = vi.fn().mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok(next)); vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); const before = await client.start(); const after = await client.choose(409);
    expect(sessionRouteChanges(before, after)).toEqual([{ kind: 'added', label: '仪式门槛 → 仪式下层阶梯', beforeKinds: [], afterKinds: ['ice'] }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sessionRouteChanges({ ...before, sessionId: 'older-session' }, after)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps briefing and preparing public and selects a distant direction without requests before submitting the original first-step index', async () => {
    const initial: SessionResponse = { ...response, frame: { ...response.frame, briefing: '作者的任务原文',
      information: { ...response.frame.information, ritual: { phase: 'preparing', label: '准备中', evidence: 'local_record', recordedAt: { time: 0, revision: 0 } } },
      scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance', 'ritual_threshold', 'ritual_ring'], siteLabels: {}, routes: [
        { start: 'ballroom_entrance', end: 'ritual_threshold', kind: 'ice' }, { start: 'ritual_threshold', end: 'ritual_ring', kind: 'walk' },
      ] }, offers: [{ index: 84, entry: 'cross_ice_adventurer', label: 'Attempt crossing toward the threshold', destination: 'ritual_threshold', movementKind: 'ice' }],
    } };
    const fetcher = vi.fn().mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok({ ...initial, revision: 1 })); vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); const readback = await client.start();
    expect(readback.frame.briefing).toBe('作者的任务原文'); expect(readback.frame.information.ritual.phase).toBe('preparing');
    spatialGraph(readback.frame); const selection = selectedSiteOffers(readback.frame, 'ritual_ring');
    expect(selection.firstStep).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1); expect(readback.frame.observations).toEqual([]);
    await client.choose(selection.offers[0].index);
    expect(fetcher).toHaveBeenCalledTimes(2); const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.index).toBe(84); expect(body.revision).toBe(0); expect(Object.keys(body).sort()).toEqual(['index', 'requestId', 'revision']);
  });
});

describe('intent policy transport and pump', () => {
  it.each([1, 64, 128])('sends the approved maximum %s and unchecked unexpected-stop setting unchanged', async maxActions => {
    const settings = { maxActions, stopOnUnexpected: false };
    const readback = policyResponse();
    readback.policy = { ...readback.policy!, limit: maxActions, stopOnUnexpected: false };
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle'))).mockResolvedValueOnce(ok(readback));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const result = await client.startPolicy('cautious_investigator', settings);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      intentId: 'cautious_investigator', ...settings, revision: 0, policyRevision: 1, requestId: expect.any(String),
    });
    expect(result.policy!.limit).toBe(maxActions);
    expect(result.policy!.stopOnUnexpected).toBe(false);
  });

  it.each([0, -1, 129, 1.5, NaN, Infinity])('rejects invalid maximum %s without any authorization request', async maxActions => {
    const fetcher = vi.fn().mockResolvedValue(ok(policyResponse('idle')));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.startPolicy('cautious_investigator', { maxActions, stopOnUnexpected: true })).rejects.toThrow('1 到 128');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves restored authorization settings and only steps the existing policy on explicit resume', async () => {
    const restored = policyResponse('running', 5, 9);
    restored.policy = { ...restored.policy!, limit: 13, stopOnUnexpected: false };
    const stopped = { ...restored, policyRevision: 10, policy: { ...restored.policy!, status: 'stopped' as const } };
    const fetcher = vi.fn().mockResolvedValueOnce(ok(restored)).mockResolvedValueOnce(ok(stopped));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient();
    const runner = new IntentPolicyRunner(client, () => {}, async () => {});
    runner.observe(await client.start());
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await runner.run();
    expect(fetcher.mock.calls[1][0]).toBe('/api/sessions/test-session/policy/step');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      policyId: 'provided-policy/9', revision: 5, policyRevision: 9, requestId: expect.any(String),
    });
    expect(restored.policy.limit).toBe(13);
    expect(restored.policy.stopOnUnexpected).toBe(false);
  });

  it('starts the stopped policy intent again with the current inputs only on explicit continuation', async () => {
    const stopped = policyResponse('stopped', 2, 7);
    const transport = { startPolicy: vi.fn().mockResolvedValue(stopped), stepPolicy: vi.fn(), cancelPolicy: vi.fn() };
    const runner = new IntentPolicyRunner(transport, () => {}, async () => {});
    runner.observe(stopped);
    await Promise.resolve();
    expect(transport.startPolicy).not.toHaveBeenCalled();
    await expect(runner.run()).rejects.toThrow('没有可继续');
    const settings = { maxActions: 9, stopOnUnexpected: false };
    await runner.run({ intentId: stopped.policy!.intentId!, ...settings });
    expect(transport.startPolicy).toHaveBeenCalledWith('cautious_investigator', settings);
    expect(transport.stepPolicy).not.toHaveBeenCalled();
    expect(transport.cancelPolicy).not.toHaveBeenCalled();
  });

  it('passes through the same public ledger on persona changes, cancel and refresh, then the reset report on restart', async () => {
    const ledger = emptyPlayReport();
    ledger.scores = { common: 2, cautious_investigator: 1, helpful_rescuer: 0, decisive_explorer: 0, cost: 1 };
    ledger.efficiency = { cautious_investigator: 2, helpful_rescuer: 1, decisive_explorer: 1 };
    ledger.metrics = { ...ledger.metrics, publishedActions: 1, manualActions: 1, elapsed: 7 };
    ledger.actions = [{ number: 1, entry: 'observe_resident_adventurer', label: '已完成的公开行动', mode: 'manual', personality: null,
      timeBefore: 0, timeAfter: 7, achievements: [], scoreDelta: { ...ledger.scores } }];
    const snapshot = structuredClone(ledger);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ ...policyResponse('idle', 1, 0), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('running', 1, 1), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('stopped', 1, 2), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('running', 1, 3), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('stopped', 1, 4), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('stopped', 1, 4), playReport: ledger }))
      .mockResolvedValueOnce(ok({ ...policyResponse('idle', 0, 5), playReport: emptyPlayReport() }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient();
    expect((await client.start()).playReport).toEqual(snapshot);
    expect((await client.startPolicy('cautious_investigator', startSettings)).playReport).toEqual(snapshot);
    expect((await client.cancelPolicy('provided-policy/9')).playReport).toEqual(snapshot);
    expect((await client.startPolicy('helpful_rescuer', startSettings)).playReport).toEqual(snapshot);
    expect((await client.cancelPolicy('provided-policy/9')).playReport).toEqual(snapshot);
    expect((await client.refresh()).playReport).toEqual(snapshot);
    expect((await client.restart()).playReport).toEqual(emptyPlayReport());
    expect(ledger).toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it.each([undefined, null, -1, 0.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects missing or invalid policy generation %s for all policy writes without substituting zero', async generation => {
    const malformed = { ...policyResponse('idle'), policyRevision: generation };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(malformed), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.startPolicy('cautious_investigator', startSettings)).rejects.toThrow('同步');
    await expect(client.stepPolicy('provided-policy/9')).rejects.toThrow('同步');
    await expect(client.cancelPolicy('provided-policy/9')).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires a read before policy writes from an old persisted handle, even if it contains a cached generation', async () => {
    const setItem = vi.fn();
    const storage = { getItem: () => JSON.stringify({ id: 'existing', revision: 0, policyRevision: 900 }), setItem } as unknown as Storage;
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 8))).mockResolvedValueOnce(ok(policyResponse('running', 0, 9)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(storage);
    await expect(client.startPolicy('cautious_investigator', startSettings)).rejects.toThrow('同步');
    expect(fetcher).not.toHaveBeenCalled();
    await client.start(); await client.startPolicy('cautious_investigator', startSettings);
    expect(fetcher.mock.calls[0][0]).toBe('/api/sessions/existing');
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ revision: 0, policyRevision: 8 });
    expect(JSON.parse(setItem.mock.calls[0][1])).not.toHaveProperty('policyRevision');
  });

  it('updates the policy generation after every response including manual action, reset, replacement and refresh', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok(policyResponse('idle', 0, 4)))
      .mockResolvedValueOnce(ok(policyResponse('idle', 1, 8)))
      .mockResolvedValueOnce(ok(policyResponse('running', 1, 9)))
      .mockResolvedValueOnce(ok(policyResponse('stopped', 1, 10)))
      .mockResolvedValueOnce(ok(policyResponse('idle', 2, 11)))
      .mockResolvedValueOnce(ok(policyResponse('running', 2, 12)))
      .mockResolvedValueOnce(ok(policyResponse('stopped', 2, 13)))
      .mockResolvedValueOnce(ok({ ...policyResponse('idle', 0, 20), sessionId: 'replacement' }))
      .mockResolvedValueOnce(ok({ ...policyResponse('running', 0, 21), sessionId: 'replacement' }))
      .mockResolvedValueOnce(ok({ ...policyResponse('running', 0, 40), sessionId: 'replacement' }))
      .mockResolvedValueOnce(ok({ ...policyResponse('stopped', 0, 41), sessionId: 'replacement' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start(); await client.choose(17);
    await client.startPolicy('cautious_investigator', startSettings); await client.cancelPolicy('provided-policy/9');
    await client.restart(); await client.startPolicy('cautious_investigator', startSettings); await client.cancelPolicy('provided-policy/9');
    await client.newSession(); await client.startPolicy('cautious_investigator', startSettings); await client.refresh(); await client.stepPolicy('provided-policy/9');
    const bodies = fetcher.mock.calls.filter(call => /\/policy\//.test(call[0])).map(call => JSON.parse(call[1].body));
    expect(bodies.map(body => body.policyRevision)).toEqual([8, 9, 11, 12, 20, 40]);
    expect(bodies.map(body => body.revision)).toEqual([1, 1, 2, 2, 0, 0]);
  });

  it('advances expected control generations across start and cancel while the world revision stays unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 0)))
      .mockResolvedValueOnce(ok(policyResponse('running', 0, 1)))
      .mockResolvedValueOnce(ok(policyResponse('stopped', 0, 2)))
      .mockResolvedValueOnce(ok(policyResponse('running', 0, 3)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await client.startPolicy('cautious_investigator', startSettings); await client.cancelPolicy('provided-policy/9'); await client.startPolicy('cautious_investigator', startSettings);
    const bodies = fetcher.mock.calls.slice(1).map(call => JSON.parse(call[1].body));
    expect(bodies.map(body => body.revision)).toEqual([0, 0, 0]);
    expect(bodies.map(body => body.policyRevision)).toEqual([0, 1, 2]);
  });

  it('does not retry a stale-generation rejection and requires synchronization for the next approval', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 0)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stale policyRevision' }), { status: 409 }))
      .mockResolvedValueOnce(ok(policyResponse('stopped', 0, 2)))
      .mockResolvedValueOnce(ok(policyResponse('running', 0, 3)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.startPolicy('cautious_investigator', startSettings)).rejects.toThrow('stale policyRevision');
    await expect(client.startPolicy('cautious_investigator', startSettings)).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.refresh(); await client.startPolicy('cautious_investigator', startSettings);
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ revision: 0, policyRevision: 2 });
  });

  it('clears a previous generation when a later response omits it, but still permits legacy manual actions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 7))).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start(); await client.refresh();
    await expect(client.startPolicy('cautious_investigator', startSettings)).rejects.toThrow('同步');
    await client.choose(17);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe('/api/sessions/test-session/actions');
  });

  it('sends only supplied identities with distinct request IDs and the latest world and policy revisions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 17))).mockResolvedValueOnce(ok(policyResponse('running', 0, 18)))
      .mockResolvedValueOnce(ok(policyResponse('running', 4, 19))).mockResolvedValueOnce(ok(policyResponse('stopped', 4, 20)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await client.startPolicy('cautious_investigator', startSettings); await client.stepPolicy('provided-policy/9'); await client.cancelPolicy('provided-policy/9');
    const calls = fetcher.mock.calls.slice(1);
    expect(calls.map(call => call[0])).toEqual(['/api/sessions/test-session/policy/start', '/api/sessions/test-session/policy/step', '/api/sessions/test-session/policy/cancel']);
    const bodies = calls.map(call => JSON.parse(call[1].body));
    expect(bodies[0]).toEqual({ intentId: 'cautious_investigator', ...startSettings, revision: 0, policyRevision: 17, requestId: expect.any(String) });
    expect(bodies[1]).toEqual({ policyId: 'provided-policy/9', revision: 0, policyRevision: 18, requestId: expect.any(String) });
    expect(bodies[2]).toEqual({ policyId: 'provided-policy/9', revision: 4, policyRevision: 19, requestId: expect.any(String) });
    expect(new Set(bodies.map(body => body.requestId)).size).toBe(3);
  });

  it.each(['start', 'step', 'cancel'] as const)('keeps %s uncertainty guarded until explicit synchronization', async operation => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse())).mockRejectedValueOnce(new Error('lost receipt'))
      .mockResolvedValueOnce(ok(policyResponse('running', 8, 31))).mockResolvedValueOnce(ok(policyResponse('stopped', 8, 32)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const request = () => operation === 'start' ? client.startPolicy('cautious_investigator', startSettings) : operation === 'step' ? client.stepPolicy('provided-policy/9') : client.cancelPolicy('provided-policy/9');
    await expect(request()).rejects.toThrow('lost receipt');
    await expect(client.stepPolicy('provided-policy/9')).rejects.toThrow('同步');
    await expect(client.cancelPolicy('provided-policy/9')).rejects.toThrow('同步');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.refresh(); await client.cancelPolicy('provided-policy/9');
    expect(JSON.parse(fetcher.mock.calls[3][1].body).revision).toBe(8);
    expect(JSON.parse(fetcher.mock.calls[3][1].body).policyRevision).toBe(31);
  });

  it('blocks native actions, restart and replacement sessions while a readback policy runs', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(policyResponse())); vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    await expect(client.choose(17)).rejects.toThrow('停止');
    await expect(client.restart()).rejects.toThrow('停止');
    await expect(client.newSession()).rejects.toThrow('停止');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping writes and a stale synchronization during an in-flight step', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse())).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const step = client.stepPolicy('provided-policy/9');
    await expect(client.refresh()).rejects.toThrow('等待');
    await expect(client.stepPolicy('provided-policy/9')).rejects.toThrow('同步');
    await expect(client.cancelPolicy('provided-policy/9')).rejects.toThrow('同步');
    finish(ok(policyResponse('stopped', 1))); await step;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('publishes and yields every response before the next server-selected step', async () => {
    const order: string[] = [];
    const transport = {
      startPolicy: vi.fn(async () => { order.push('start'); return policyResponse(); }),
      stepPolicy: vi.fn(async () => { order.push('step'); return policyResponse('stopped', 1); }),
      cancelPolicy: vi.fn(),
    };
    const runner = new IntentPolicyRunner(transport, next => order.push(`render:${next.revision}`), async () => { order.push('yield'); });
    await runner.run({ intentId: 'cautious_investigator', ...startSettings });
    expect(order).toEqual(['start', 'render:0', 'yield', 'step', 'render:1', 'yield']);
    expect(transport.startPolicy).toHaveBeenCalledWith('cautious_investigator', startSettings);
    expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
    expect(transport.stepPolicy).toHaveBeenCalledWith('provided-policy/9');
    expect(transport.cancelPolicy).not.toHaveBeenCalled();
  });

  it('stops locally immediately, waits for an in-flight step, and cancels with its committed revision', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse('idle', 0, 0))).mockResolvedValueOnce(ok(policyResponse()))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(ok(policyResponse('stopped', 1, 3)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); await client.start();
    const published: number[] = [];
    const runner = new IntentPolicyRunner(client, next => published.push(next.revision), async () => {});
    const pump = runner.run({ intentId: 'cautious_investigator', ...startSettings });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const cancel = runner.cancel(); const duplicate = runner.cancel();
    expect(fetcher).toHaveBeenCalledTimes(3);
    finish(ok(policyResponse('running', 1, 2)));
    await Promise.all([pump, cancel, duplicate]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][0]).toBe('/api/sessions/test-session/policy/cancel');
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({ policyId: 'provided-policy/9', revision: 1, policyRevision: 2 });
    expect(published).toEqual([0, 1, 1]);
  });

  it('cancels approval in flight without ever issuing a world step', async () => {
    let finish!: (result: SessionResponse) => void;
    const transport = {
      startPolicy: vi.fn(() => new Promise<SessionResponse>(resolve => { finish = resolve; })),
      stepPolicy: vi.fn(), cancelPolicy: vi.fn().mockResolvedValue(policyResponse('stopped')),
    };
    const runner = new IntentPolicyRunner(transport, () => {}, async () => {});
    const pump = runner.run({ intentId: 'cautious_investigator', ...startSettings }); const cancel = runner.cancel();
    finish(policyResponse()); await Promise.all([pump, cancel]);
    expect(transport.stepPolicy).not.toHaveBeenCalled();
    expect(transport.cancelPolicy).toHaveBeenCalledTimes(1);
    expect(transport.cancelPolicy).toHaveBeenCalledWith('provided-policy/9');
  });

  it('does not pump a restored or synchronized running policy until explicitly resumed', async () => {
    const transport = { startPolicy: vi.fn(), stepPolicy: vi.fn().mockResolvedValue(policyResponse('stopped', 1)), cancelPolicy: vi.fn() };
    const runner = new IntentPolicyRunner(transport, () => {}, async () => {});
    runner.observe(policyResponse()); await Promise.resolve();
    runner.observe(policyResponse('running', 2)); await Promise.resolve();
    expect(transport.stepPolicy).not.toHaveBeenCalled();
    await runner.run();
    expect(transport.startPolicy).not.toHaveBeenCalled();
    expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
    expect(transport.stepPolicy).toHaveBeenCalledWith('provided-policy/9');
  });

  it('never retries a failed step or continues on synchronization, even when cancel is pending', async () => {
    let fail!: (error: Error) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(ok(policyResponse())).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValueOnce(ok(policyResponse('running', 2))).mockResolvedValueOnce(ok(policyResponse('stopped', 2)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient(); const restored = await client.start();
    const runner = new IntentPolicyRunner(client, () => {}, async () => {}); runner.observe(restored);
    const pump = runner.run(); const pumpFailure = expect(pump).rejects.toThrow('lost step');
    const cancel = runner.cancel(); const cancelFailure = expect(cancel).rejects.toThrow('同步');
    fail(new Error('lost step')); await Promise.all([pumpFailure, cancelFailure]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    runner.observe(await client.refresh()); await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(3);
    await runner.cancel(); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][0]).toBe('/api/sessions/test-session/policy/cancel');
  });

  it('checks the local stop flag again after the browser task yield', async () => {
    let release!: () => void;
    const transport = { startPolicy: vi.fn().mockResolvedValue(policyResponse()), stepPolicy: vi.fn(), cancelPolicy: vi.fn().mockResolvedValue(policyResponse('stopped')) };
    const runner = new IntentPolicyRunner(transport, () => {}, () => new Promise(resolve => { release = resolve; }));
    const pump = runner.run({ intentId: 'cautious_investigator', ...startSettings });
    await vi.waitFor(() => expect(release).toBeDefined());
    const cancel = runner.cancel(); release(); await Promise.all([pump, cancel]);
    expect(transport.stepPolicy).not.toHaveBeenCalled();
  });

  it('leaves a reading window and releases it immediately on stop without another step', async () => {
    vi.useFakeTimers();
    try {
      const transport = { startPolicy: vi.fn(), stepPolicy: vi.fn().mockResolvedValue(policyResponse('running', 1)), cancelPolicy: vi.fn().mockResolvedValue(policyResponse('stopped', 1)) };
      const runner = new IntentPolicyRunner(transport, () => {});
      runner.observe(policyResponse());
      const pump = runner.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
      await Promise.all([runner.cancel(), pump]);
      expect(transport.cancelPolicy).toHaveBeenCalledTimes(1);
      expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('starts the next step only after its reading window and skips any pause at a terminal stop', async () => {
    vi.useFakeTimers();
    try {
      const transport = { startPolicy: vi.fn(), stepPolicy: vi.fn().mockResolvedValueOnce(policyResponse('running', 1)).mockResolvedValueOnce(policyResponse('stopped', 2)), cancelPolicy: vi.fn() };
      const runner = new IntentPolicyRunner(transport, () => {});
      runner.observe(policyResponse());
      const pump = runner.run();
      await vi.advanceTimersByTimeAsync(499);
      expect(transport.stepPolicy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await pump;
      expect(transport.stepPolicy).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
