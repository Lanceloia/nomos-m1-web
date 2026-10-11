import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { entityPresences, latestObservations } from './presence';
import { geographicEntityClusters, geographicLinks, geographicMarkers, geographicView, geographicViewport } from './geography';
import { GeographicMap } from './GeographicMap';
import { availableSurface, publicLabel, targetNames } from './tabletop';
import { memory, publicFrame, surface } from './presence.fixtures';

let CurrentSurface: typeof import('./App').CurrentSurface;
let CurrentEntityDetails: typeof import('./App').CurrentEntityDetails;
beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: undefined });
  ({ CurrentSurface, CurrentEntityDetails } = await import('./App'));
});
afterAll(() => vi.unstubAllGlobals());

describe('public entity presence geography', () => {
  it('maps same-site people and objects plus supplied adjacent elementals, but keeps the scene same-site only', () => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('person', 'person', 'ballroom_entrance', 'First person in the hall'), surface('item', 'everflame', 'ballroom_entrance', '作者命名的永焰')];
    frame.information.nearbyEntities = [surface('nearby', 'elemental', 'ritual_threshold', '未辨认的元素 2')];
    const snapshot = structuredClone(frame);
    expect(entityPresences(frame).map(item => item.id).sort()).toEqual(['item', 'nearby', 'person']);
    expect(geographicView(frame).places.map(item => item.id)).toContain('ritual_threshold');
    expect(geographicLinks(frame, geographicMarkers(frame))).toEqual([]);
    const scene = renderToStaticMarkup(createElement(CurrentSurface, { frame, onSelect: () => {} }));
    expect(scene).toContain('大厅居民一'); expect(scene).toContain('作者命名的永焰');
    expect(scene).not.toContain('未辨认的元素 2'); expect(scene).not.toContain('First person in the hall');
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, onSelect: () => {}, onSelectEntity: () => {} }));
    expect(html).toContain('未辨认的元素 2'); expect(html).toContain('相邻可见 · 时刻 12');
    expect(html).toContain('lucide-sparkles'); expect(html).toContain('元素 · 威胁未知');
    expect(html).not.toMatch(/敌人|敌对|友善|安全无害|faction/);
    expect(html).not.toContain('data-geographic-region="prison"');
    expect(frame).toEqual(snapshot);
  });

  it('excludes off-site visible rows from the main scene rather than making them reachable', () => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('off-site', 'person', 'tower_top')];
    expect(availableSurface(frame)).toEqual([]);
    expect(entityPresences(frame)).toEqual([]);
  });

  it('preserves nearby evidence independently of unavailable same-site perception', () => {
    const frame = publicFrame(); frame.information.visibility = 'unavailable';
    frame.information.visibleEntities = [surface('hidden-by-status', 'person', 'ballroom_entrance')];
    frame.information.nearbyEntities = [surface('supplied-nearby', 'person', 'halls_ballroom_door')];
    expect(entityPresences(frame).map(item => item.id)).toEqual(['supplied-nearby']);
  });

  it('uses the latest observed site, never stale movement, and distinguishes memory from current presence', () => {
    const frame = publicFrame();
    frame.observations = [memory('remembered', 'elemental', 'tower_top'), memory('remembered', 'elemental', 'ritual_ring', 2)];
    frame.information.movements = [{ id: 'old-movement', subjectId: 'remembered', label: '过去的移动', start: 'tower_top', end: 'prison_deep', recordedAt: { time: 2, revision: 1 } }];
    const record = entityPresences(frame)[0];
    expect(record).toMatchObject({ site: 'ritual_ring', presence: 'memory', recordedAt: { time: 4, revision: 2 } });
    expect(latestObservations(frame)).toEqual([frame.observations[1]]);
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact: true, onSelect: () => {}, onSelectEntity: () => {} }));
    expect(html).toContain('geographic-entity-marker memory');
    expect(html).toContain('上次所见 · 时刻 4');
    expect(html).not.toContain('data-geographic-region="prison"');
    expect(html).not.toContain('data-geographic-region="tower-top"');
  });

  it('does not relocate a person when the player moves and does not retain an obsolete site after an unknown-site observation', () => {
    const frame = publicFrame(); frame.observations = [memory('remembered', 'person', 'ritual_ring')];
    const before = geographicEntityClusters(frame);
    frame.scene!.playerSite = 'ballroom_chandelier_reach';
    expect(geographicEntityClusters(frame)).toEqual(before);
    frame.observations.push(memory('remembered', 'person', null, 2));
    expect(entityPresences(frame)).toEqual([]);
  });

  it('prefers current evidence over historical state and avoids duplicate last-seen pins', () => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('known', 'person', 'ballroom_entrance', '当前作者名称')];
    frame.observations = [{ ...memory('known', 'person', 'tower_top'), label: '旧名称', state: 'dead', facts: [{ label: '生命', value: 'Dead' }] }];
    expect(entityPresences(frame)).toHaveLength(1);
    expect(entityPresences(frame)[0]).toMatchObject({ label: '当前作者名称', presence: 'current', site: 'ballroom_entrance' });
    const details = renderToStaticMarkup(createElement(CurrentEntityDetails, { frame, item: frame.information.visibleEntities[0] }));
    expect(details).toContain('靠近后仔细观察'); expect(details).not.toContain('死亡');
    expect(targetNames({ index: 1, label: '行动', targetIds: ['known'] }, frame)).toEqual(['当前作者名称']);
  });

  it('keeps public memories at supplied unillustrated places in the list without inventing coordinates', () => {
    const frame = publicFrame(); frame.observations = [memory('object', 'chest', 'authored-new-place')];
    frame.scene!.siteLabels['authored-new-place'] = '公开的新地点';
    expect(geographicEntityClusters(frame)).toEqual([]);
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, onSelect: () => {}, onSelectEntity: () => {} }));
    expect(html).toContain('上次观察的名称'); expect(html).toContain('公开的新地点');
    expect(html).not.toContain('data-entity-cluster=');
  });

  it('keeps semantic cluster offsets and both map canvases fixed through reordering and membership changes', () => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('a', 'person', 'ballroom_entrance'), surface('b', 'person', 'ballroom_entrance'), surface('c', 'reservoir', 'ballroom_entrance')];
    frame.observations = [memory('memory', 'person', 'ballroom_entrance')];
    const before = geographicEntityClusters(frame);
    const reordered = { ...frame, information: { ...frame.information, visibleEntities: [...frame.information.visibleEntities].reverse() } };
    expect(geographicEntityClusters(reordered)).toEqual(before);
    frame.information.visibleEntities.push(surface('d', 'person', 'ballroom_entrance'));
    for (const old of before) {
      expect(geographicEntityClusters(frame).find(row => row.key === old.key)).toMatchObject({ x: old.x, y: old.y });
    }
    expect(before.find(row => row.presence === 'memory')!.y).not.toBe(before.find(row => row.presence === 'current')!.y);
    expect(geographicViewport()).toEqual({ x: 0, y: 0, width: 900, height: 1280 });
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact, onSelect: () => {}, onSelectEntity: () => {} }));
      expect(html).toContain('viewBox="0 0 900 1280"');
      expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    }
  });

  it('deduplicates overlapping public current lists and keeps labels author-supplied without raw references', () => {
    const frame = publicFrame(); const item = surface('same', 'person', 'ballroom_entrance', '匿名旅人');
    frame.information.visibleEntities = [item]; frame.information.nearbyEntities = [item];
    expect(entityPresences(frame)).toHaveLength(1);
    expect(publicLabel('First person in the hall')).toBe('大厅居民一');
    expect(publicLabel('Unknown owner=secret')).toBe('未知');
    expect(publicLabel('private_actor_ref')).toBe('未知');
  });

  it.each([
    ['First resident by the chandelier', '吊灯旁居民一'],
    ['Second resident by the chandelier', '吊灯旁居民二'],
    ['Resident at the ritual', '仪式处居民'],
  ])('uses the exact known display translation for %s in current and memory map labels', (original, translated) => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('current', 'person', 'ballroom_entrance', original)];
    frame.observations = [{ ...memory('remembered', 'person', 'ritual_ring'), label: original }];
    expect(publicLabel(original)).toBe(translated);
    expect(entityPresences(frame).map(item => item.label)).toEqual([translated, translated]);
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, onSelect: () => {}, onSelectEntity: () => {} }));
    expect(html).toContain(translated); expect(html).not.toContain(original);
  });

  it('preserves arbitrary authored labels without substring matching or bypassing unsafe-reference stripping', () => {
    for (const label of ['作者命名的居民', 'Unknown traveler', 'First resident by the chandelier · 新名字', 'first resident by the chandelier', 'constructor']) {
      expect(publicLabel(label)).toBe(label);
    }
    expect(publicLabel('Resident at the ritual owner=secret')).toBe('未知');
    expect(publicLabel('First resident by the chandelier private_actor_ref')).toBe('未知');
  });
});
