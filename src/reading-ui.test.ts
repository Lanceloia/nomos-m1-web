import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { publicFrame } from './presence.fixtures';

let PlayerReadings: typeof import('./App').PlayerReadings;
let ResourceReadbacks: typeof import('./App').ResourceReadbacks;
let InventoryReadbacks: typeof import('./App').InventoryReadbacks;
let PlayerAvailability: typeof import('./App').PlayerAvailability;
beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: undefined });
  ({ PlayerReadings, ResourceReadbacks, InventoryReadbacks, PlayerAvailability } = await import('./App'));
});

describe('own lifecycle availability HUD', () => {
  it.each([
    ['dead', 'mobile', '已死亡 · 旅程结束'],
    ['incapacitated', 'mobile', '无法行动，需照护'],
    ['alive', 'frozen', '冰封，无法行动'],
  ] as const)('shows %s/%s without actionable movement despite a mobile localized condition or true protection', (lifeState, coldState, label) => {
    const frame = publicFrame(); frame.fields.lifeState = lifeState; frame.fields.coldState = coldState;
    frame.fields.life = 'Alive'; frame.fields.coldCondition = 'Able to move';
    frame.fields.protection = [{ siteId: 'ballroom_entrance', site: 'Ballroom entrance', now: "Within the Everflame's reach", afterSpendOne: 'Unknown' }];
    const html = renderToStaticMarkup(createElement(PlayerAvailability, { frame }));
    expect(html).toContain(label); expect(html).toContain('受永焰保护');
    expect(html).not.toMatch(/可行动|移动|无敌|不会死亡/);
  });
  it.each(['mobile', 'immune'] as const)('keeps the alive/%s HUD actionable and shows actual known movement speed', coldState => {
    const frame = publicFrame(); frame.fields.lifeState = 'alive'; frame.fields.coldState = coldState;
    frame.fields.movementSpeed = 5; frame.fields.maxMovementSpeed = 5;
    frame.fields.protection = [{ siteId: 'ballroom_entrance', site: 'Ballroom entrance', now: "Within the Everflame's reach", afterSpendOne: 'Unknown' }];
    const html = renderToStaticMarkup(createElement(PlayerAvailability, { frame }));
    expect(html).toContain('可行动 · 移动 5 / 5'); expect(html).toContain('受永焰保护');
    expect(html).not.toMatch(/已死亡|无法行动|旅程结束/);
  });
  it('does not infer ability to act from localized text when raw own state is unknown', () => {
    const frame = publicFrame(); frame.fields.coldCondition = 'Able to move';
    const html = renderToStaticMarkup(createElement(PlayerAvailability, { frame }));
    expect(html).toContain('行动状态未知'); expect(html).not.toMatch(/可行动|移动/);
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('authored player reading presentation', () => {
  it('renders required detail rows in one closed, labeled expandable pane without deriving world facts', () => {
    const frame = publicFrame();
    frame.fields.details = [{ label: '作者提供的记录', value: '尚未确认' }, { label: '本人获知的情况', value: '一条长记录'.repeat(60) }];
    const snapshot = structuredClone(frame);
    const html = renderToStaticMarkup(createElement(PlayerReadings, { frame }));
    expect(html).toContain('aria-label="本人详细记录"');
    expect(html).toContain('<summary>详细记录 · 2</summary>');
    expect(html).toContain('<dt>作者提供的记录</dt><dd>尚未确认</dd>');
    expect(html).toContain('一条长记录'.repeat(60));
    expect(html).not.toContain('open='); expect(html).not.toContain('<button');
    expect(frame).toEqual(snapshot);
  });
  it('omits an empty pane and suppresses opaque references rather than dumping fields', () => {
    const frame = publicFrame();
    expect(PlayerReadings({ frame })).toBeNull();
    frame.fields.details = [{ label: 'private_actor_ref', value: 'owner=secret' }];
    const html = renderToStaticMarkup(createElement(PlayerReadings, { frame }));
    expect(html).toContain('<dt>未知</dt><dd>未知</dd>');
    expect(html).not.toMatch(/private_actor_ref|owner=secret/);
  });
  it.each([0, 7])('shows known gold %s without changing scores or inventing carrying claims', gold => {
    const frame = publicFrame(); frame.fields.gold = gold;
    const html = renderToStaticMarkup(createElement(InventoryReadbacks, { frame }));
    expect(html).toContain(`data-testid="gold-value">${gold}`); expect(html).toContain('金币');
    expect(html).toContain('<summary>'); expect(html).not.toContain('open=');
    expect(renderToStaticMarkup(createElement(ResourceReadbacks, { frame }))).not.toContain('gold-value');
    expect(html).not.toContain('得分'); expect(html).not.toContain('当前持有');
  });
  it.each([undefined, null])('does not show unknown gold %s as zero', gold => {
    const frame = publicFrame(); frame.fields.gold = gold;
    expect(InventoryReadbacks({ frame })).toBeNull();
  });
});
