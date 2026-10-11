import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { publicFrame } from './presence.fixtures';
import { actionNote, feedbackText, feedbackTitle, passageWarning, recoveryOffers, receiptDiscoveries } from './tabletop';
import type { EscortReplyObservation, Frame, Offer } from './types';

let UI: typeof import('./App');
beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: undefined });
  UI = await import('./App');
});
afterAll(() => vi.unstubAllGlobals());

function blockedFrame(): Frame {
  const frame = publicFrame();
  frame.feedback = { status: 'published', entry: 'move_adventurer', actionLabel: 'Move', text: 'Action published.', result: {
    target: 'ballroom_chandelier_reach', landing: 'ballroom_entrance',
    movementAttempt: { start: 'ballroom_entrance', destination: 'ballroom_chandelier_reach', landing: 'ballroom_entrance', outcome: 'blocked' },
    elapsed: { action: 0, subsequent: 100 }, changes: [{ field: 'endurance', before: 3, after: 2 }],
    laterChanges: [], discoveries: [], laterDiscoveries: [],
  } };
  return frame;
}

const direct: Offer = { index: 1, entry: 'move_adventurer', label: 'Walk', destination: 'b', movementKind: 'walk',
  passageWarning: { floorState: 'unknown', lastAttemptBlocked: true, crossingIndexes: [2, 3] } };

describe('published blocked attempt readback', () => {
  it('shows actual attempt, staying and actual elapsed/costs, never refusal or arrival', () => {
    const frame = blockedFrame();
    expect(feedbackTitle(frame)).toContain('通行尝试受阻，仍在');
    expect(feedbackText(frame)).toContain('行动已发布');
    expect(feedbackText(frame)).toContain('具体原因尚不清楚');
    const html = renderToStaticMarkup(createElement(UI.ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('随后世界推进 100');
    expect(html).toContain('本次提交至返回共推进 100');
    expect(html).toContain('耐力'); expect(html).toContain('3'); expect(html).toContain('2');
    expect(html).not.toMatch(/未执行|未消耗局内|行动未发生|抵达|冰导致|楼梯导致|actor_motion|occurrence/);
    expect(renderToStaticMarkup(createElement(UI.ReceiptSummary, { frame }))).toContain('通行尝试受阻');
  });

  it('does not report an absent or retained attempt as a new blocked attempt', () => {
    const frame = publicFrame();
    frame.feedback = { status: 'published', entry: 'wait_adventurer', actionLabel: 'Wait', text: 'You waited.' };
    expect(feedbackTitle(frame)).not.toContain('受阻');
    frame.feedback = { status: 'rejected', entry: 'move_adventurer', actionLabel: 'Move', text: 'No publication',
      refusal: { code: 'K0_NOT_ADMITTED' }, result: blockedFrame().feedback!.result };
    expect(feedbackTitle(frame)).toBe('行动未发生');
    expect(feedbackText(frame)).not.toContain('行动已发布');
  });
});

describe('public-only passage warnings', () => {
  it('keeps unknown uncertain and generic blocks cause-free, with only matching offered alternatives', () => {
    const frame = publicFrame();
    frame.offers = [direct, { index: 2, entry: 'cross_ice_adventurer', label: 'Cross', destination: 'b' },
      { index: 3, entry: 'cross_ice_adventurer', label: 'Other crossing', destination: 'c' }];
    const note = actionNote(direct, frame);
    expect(note).toContain('上次从这里向同一目的地的直接尝试受阻');
    expect(note).toContain('地面情况尚不清楚'); expect(note).toContain('另有「尝试穿越冰面」');
    expect(note).toContain('不保证抵达'); expect(note).not.toMatch(/因为冰|必定|保证成功/);
    frame.offers = [direct];
    expect(passageWarning(direct, frame)).not.toContain('另有');
    expect(passageWarning({ ...direct, passageWarning: undefined }, frame)).toContain('仍不确定');
  });

  it.each(['frozen', 'clear'] as const)('makes %s an observation, not a passage guarantee', floorState => {
    const frame = publicFrame();
    const note = passageWarning({ ...direct, passageWarning: { floorState, lastAttemptBlocked: false, crossingIndexes: [] } }, frame);
    expect(note).toContain('上次检查'); expect(note).not.toContain('受阻的原因');
    expect(note).toContain(floorState === 'frozen' ? '可能受阻' : '不保证');
  });

  it('keeps alternative recovery choices and every action confirmation', () => {
    const frame = blockedFrame();
    const destination = frame.feedback!.result!.movementAttempt!.destination;
    frame.offers = [{ ...direct, destination }, { index: 2, entry: 'cross_ice_adventurer', label: 'Cross', destination },
      { index: 3, entry: 'cross_ice_adventurer', label: 'Elsewhere', destination: 'c' },
      { index: 4, entry: 'observe_floor_adventurer', label: 'Floor' }];
    expect(recoveryOffers(frame).map(row => row.index)).toEqual([2, 4]);
    const choices = renderToStaticMarkup(createElement(UI.ActionChoices, { frame, offers: frame.offers,
      blocked: false, selectedIndex: null, onAct: vi.fn(), onPreview: vi.fn() }));
    expect(choices).toContain('上次同路受阻 · 再试仍会消耗行动');
    expect(choices).toContain('data-offer-index="2"');
    for (const offer of [...frame.offers, { index: 9, label: 'Wait', entry: 'wait_adventurer' }]) {
      expect(UI.requiresActionConfirmation(offer, offer.index)).toBe(true);
    }
  });
});

function invitation(): Frame {
  const frame = publicFrame();
  frame.feedback = { status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite', text:
    'You called an invitation to leave. No acceptance is implied; residents decide for themselves. Observe them again when you meet.',
    result: { changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [] } };
  return frame;
}

function reply(status: EscortReplyObservation['status'] = 'ready_now'): EscortReplyObservation {
  return { id: 'reply-1', subjectId: 'seen-1', label: '附近居民', site: 'ballroom_entrance',
    destination: 'palace_exit', status, recordedAt: { time: 100, revision: 1 } };
}

describe('actual heard escort reply, not invitation or movement', () => {
  it.each([
    ['ready_now', '当时表示已准备动身'], ['not_ready_now', '当时表示尚未准备动身'], ['unable_now', '当时表示无法动身'],
  ] as const)('renders the actual heard %s status without follow/safety guarantees', (status, wording) => {
    const frame = invitation(), actual = reply(status);
    frame.information.escortReplies = [actual];
    frame.feedback!.result!.laterDiscoveries = [{ kind: 'escort_reply', reply: actual }];
    const html = renderToStaticMarkup(createElement(UI.ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('本次实际听到的答复'); expect(html).toContain(wording);
    expect(html).toContain('不保证跟随、抵达或安全');
    expect(html).toContain('暂未看见新的动身迹象');
    expect(html).not.toMatch(/是否愿意同行，尚未听到答复|当前没有取得明确答复|已经跟随|已经安全|答应护送|已获救。/);
    expect(receiptDiscoveries(frame)[0]).toContain('随后实际听到附近居民');
    expect(renderToStaticMarkup(createElement(UI.ReceiptSummary, { frame }))).toContain(wording);
  });

  it('keeps old actual replies in history without presenting them as this invitation reply', () => {
    const frame = invitation(); frame.information.escortReplies = [reply()];
    const current = renderToStaticMarkup(createElement(UI.EscortResponse, { frame, invitation: true }));
    expect(current).toContain('本次尚未实际听到新的答复'); expect(current).not.toContain('当时表示');
    const history = renderToStaticMarkup(createElement(UI.EscortResponse, { frame }));
    expect(history).toContain('此前实际听到'); expect(history).toContain('当时表示已准备动身');
    expect(receiptDiscoveries(frame)).toEqual([]);
  });

  it('does not infer a reply from movement, a player invitation, readiness details or rejected feedback', () => {
    const frame = invitation();
    frame.feedback!.result!.laterDiscoveries = [{ kind: 'movement', movement: {
      id: 'motion-1', subjectId: 'seen-1', label: '附近居民', start: 'ballroom_entrance', end: 'ritual_ring',
      recordedAt: { time: 100, revision: 1 },
    } }];
    const html = renderToStaticMarkup(createElement(UI.EscortResponse, { frame, invitation: true }));
    expect(html).toContain('本次尚未实际听到新的答复'); expect(html).not.toContain('当时表示');
    expect(html).toContain('移动本身不证明答应同行');
    frame.feedback = { ...frame.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } };
    expect(renderToStaticMarkup(createElement(UI.EscortResponse, { frame, invitation: true }))).toBe('');
  });

  it('shows a heard reply acquired while waiting as an actual discovery without manufacturing an invitation', () => {
    const frame = publicFrame();
    frame.feedback = { status: 'published', entry: 'wait_adventurer', actionLabel: 'Wait', text: 'You waited.', result: {
      changes: [], laterChanges: [], discoveries: [{ kind: 'escort_reply', reply: reply('unable_now') }], laterDiscoveries: [],
    } };
    const html = renderToStaticMarkup(createElement(UI.ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('实际听到附近居民'); expect(html).toContain('当时表示无法动身');
    expect(html).not.toContain('你喊出邀请');
  });
});
