import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Frame } from './types';
import { geographicLinks, geographicMarkers, geographicView, geographicViewport } from './geography';
import { GeographicMap } from './GeographicMap';
import { memory, publicFrame } from './presence.fixtures';

const frame: Frame = { ...publicFrame(), scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance', 'ritual_ring'], routes: [], siteLabels: { tower_top: 'Secret tower', custom_place: 'Unillustrated place' } } };
const callbacks = { onSelect: () => {}, onSelectEntity: () => {} };

describe('geographic presentation knowledge boundary', () => {
  it('reveals only architectural regions of supplied known places', () => {
    const view = geographicView(frame);
    expect(view.regions.sort()).toEqual(['ballroom', 'ritual']);
    expect(view.places.map(place => place.id)).toEqual(['ballroom_entrance', 'ritual_ring']);
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact, ...callbacks }));
      expect(html).toContain('palace-geographic-v3.png');
      expect(html).toContain('data-geographic-region="ballroom"');
      expect(html).not.toContain('data-geographic-region="tower-top"');
      expect(html).not.toContain('Secret tower'); expect(html).not.toContain('data-edge-start');
    }
  });
  it('does not manufacture coordinates for a new authored place or interpret floor records as entity sightings', () => {
    const changed: Frame = { ...frame, scene: { ...frame.scene!, knownSites: ['ballroom_entrance', 'custom_place'] }, observations: [memory('floor-record', 'floor', 'tower_top')] };
    const view = geographicView(changed);
    expect(view.regions).toEqual(['ballroom']); expect(view.unillustrated.map(p => p.id)).toEqual(['custom_place']);
    expect(view.places.some(p => p.id === 'tower_top')).toBe(false);
  });
  it('includes a current offered destination without creating a route or reverse permission', () => {
    const changed = { ...frame, offers: [{ index: 82, destination: 'halls_ballroom_door', label: 'Try passage' }] };
    expect(geographicView(changed).regions).toContain('halls');
    expect(changed.offers[0].index).toBe(82); expect(changed.scene!.routes).toEqual([]);
  });
  it('keeps compact markers identified but detailed names outside the small map', () => {
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact: true, ...callbacks }));
    expect(html).toContain('aria-label="舞厅入口"'); expect(html).toContain('aria-current="location"');
    expect(html).not.toContain('geographic-name'); expect(html).toContain('舞厅入口 · 你在这里');
  });
  it('keeps every known individual site in both maps and one expanded caption', () => {
    const changed = { ...frame, scene: { ...frame.scene!, knownSites: ['ballroom_entrance', 'ballroom_chandelier_reach', 'ritual_ring', 'ritual_threshold'] } };
    const compact = renderToStaticMarkup(createElement(GeographicMap, { frame: changed, compact: true, ...callbacks }));
    expect(compact.match(/data-map-site=/g)).toHaveLength(4);
    expect(compact).toContain('data-map-site="ritual_ring"');
    expect(compact).toContain('data-map-site="ritual_threshold"');
    expect(compact).toContain('data-map-site="ballroom_chandelier_reach"');
    const expanded = renderToStaticMarkup(createElement(GeographicMap, { frame: changed, selectedId: 'ritual_threshold', ...callbacks }));
    expect(expanded.match(/data-map-site=/g)).toHaveLength(4);
    expect(expanded.match(/class="geographic-name"/g)).toHaveLength(1);
    expect(expanded.indexOf('地图上的已知地点')).toBeLessThan(expanded.indexOf('geographic-boundary'));
    expect(expanded).toContain('aria-pressed="true">仪式门槛');
    expect(expanded).not.toContain('Secret tower');
  });
  it('draws only recorded directed routes, not a reverse route or offered-only connection', () => {
    const changed = { ...frame, scene: { ...frame.scene!, routes: [{ start: 'ballroom_entrance', end: 'ritual_ring', kind: 'ice' }] },
      offers: [{ index: 82, destination: 'halls_ballroom_door', label: 'Try passage' }] };
    const links = geographicLinks(changed, geographicMarkers(changed));
    expect(links).toHaveLength(1);
    expect(links[0].forward).toBe(true); expect(links[0].backward).toBe(false);
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame: changed, ...callbacks }));
    expect(html).toContain('data-map-directions="forward"');
    expect(html).toContain('data-map-arrow="forward"');
    expect(html).not.toContain('data-map-arrow="backward"');
    expect(html).not.toContain('data-map-connection="ballroom_entrance:halls_ballroom_door"');
  });
  it('combines real two-way routes and retains individual intra-room paths in both maps', () => {
    const changed = { ...frame, scene: { ...frame.scene!, knownSites: ['ballroom_entrance', 'ritual_ring', 'ritual_threshold'], routes: [
      { start: 'ballroom_entrance', end: 'ritual_threshold', kind: 'ice' },
      { start: 'ritual_threshold', end: 'ballroom_entrance', kind: 'ice' },
      { start: 'ritual_threshold', end: 'ritual_ring', kind: 'walk' },
    ] } };
    const places = geographicView(changed).places;
    const links = geographicLinks(changed, places);
    expect(links).toHaveLength(2); expect(links[0].forward && links[0].backward).toBe(true);
    expect(links[0].routes).toEqual(changed.scene.routes.slice(0, 2).map(({ start, end }) => ({ start, end })));
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(GeographicMap, { frame: changed, compact, ...callbacks }));
      expect(html).toContain('data-map-directions="both"');
      expect(html).toContain('data-map-connection="ritual_ring:ritual_threshold"');
      expect(html.match(/data-map-arrow=/g)).toHaveLength(1);
    }
  });
  it('does not draw coordinates or connections for an unillustrated authored place', () => {
    const changed = { ...frame, scene: { ...frame.scene!, routes: [{ start: 'ballroom_entrance', end: 'custom_place', kind: 'walk' }] } };
    expect(geographicLinks(changed, geographicMarkers(changed))).toEqual([]);
  });
  it('uses one arrow for a recorded reverse-only route and no arrows for reciprocal routes', () => {
    const changed = { ...frame, scene: { ...frame.scene!, routes: [{ start: 'ritual_ring', end: 'ballroom_entrance', kind: 'walk' }] } };
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame: changed, ...callbacks }));
    expect(html).toContain('data-map-directions="backward"');
    expect(html.match(/data-map-arrow=/g)).toHaveLength(1);
    expect(html).toContain('data-map-arrow="backward"');
  });
  it('keeps the whole coordinate canvas fixed while revealing only known architecture', () => {
    const box = geographicViewport();
    expect(box).toEqual({ x: 0, y: 0, width: 900, height: 1280 });
    for (const place of geographicView(frame).places) {
      expect(place.x).toBeGreaterThan(box.x); expect(place.x).toBeLessThan(box.x + box.width);
      expect(place.y).toBeGreaterThan(box.y); expect(place.y).toBeLessThan(box.y + box.height);
    }
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact, ...callbacks }));
      expect(html).toContain('viewBox="0 0 900 1280"');
      expect(html).not.toContain('data-geographic-region="tower-top"');
    }
  });

  it('moves the individual current pin while keeping all coordinates and routes fixed within a room', () => {
    const start = { ...frame, scene: { ...frame.scene!, knownSites: ['ballroom_entrance', 'ritual_ring', 'ritual_threshold'],
      playerSite: 'ritual_threshold', routes: [{ start: 'ballroom_entrance', end: 'ritual_threshold', kind: 'walk' }] } };
    const moved = { ...start, scene: { ...start.scene, playerSite: 'ritual_ring' } };
    const before = geographicMarkers(start), after = geographicMarkers(moved);
    expect(after).toEqual(before);
    for (const compact of [false, true]) {
      for (const current of [start, moved]) {
        const markup = renderToStaticMarkup(createElement(GeographicMap, { frame: current, compact, ...callbacks }));
        const active = current.scene.playerSite;
        const other = active === 'ritual_ring' ? 'ritual_threshold' : 'ritual_ring';
        expect(markup).toMatch(new RegExp(`data-map-site="${active}"[^>]*aria-current="location"`));
        expect(markup).not.toMatch(new RegExp(`data-map-site="${other}"[^>]*aria-current="location"`));
        expect(markup.match(/data-map-site="[^"]+"[^>]*aria-current="location"/g)).toHaveLength(1);
        expect(markup).toContain('viewBox="0 0 900 1280"');
        expect(markup).toContain('href="/assets/palace-geographic-v3.png"');
      }
    }
    expect(before.find(place => place.id === 'ritual_ring')).toMatchObject({ x: 470, y: 755 });
    expect(before.find(place => place.id === 'ritual_threshold')).toMatchObject({ x: 545, y: 745 });
  });

  it('adds known regions without reframing old anchors and keeps unexplored regions absent', () => {
    const known = { ...frame, scene: { ...frame.scene!, knownSites: [...frame.scene!.knownSites, 'tower_top'] } };
    const anchors = geographicMarkers(frame);
    const added = geographicMarkers(known);
    for (const place of anchors) expect(added.find(row => row.id === place.id)).toEqual(place);
    for (const compact of [false, true]) {
      const markup = renderToStaticMarkup(createElement(GeographicMap, { frame: known, compact, ...callbacks }));
      expect(markup).toContain('viewBox="0 0 900 1280"');
      expect(markup).toContain('data-geographic-region="tower-top"');
      expect(markup).not.toContain('data-geographic-region="prison"');
    }
  });

  it('changes the current-region highlight without repositioning either map geometry on cross-region movement', () => {
    const moved = { ...frame, scene: { ...frame.scene!, playerSite: 'ritual_ring' } };
    for (const compact of [false, true]) {
      expect(geographicMarkers(moved)).toEqual(geographicMarkers(frame));
      const markup = renderToStaticMarkup(createElement(GeographicMap, { frame: moved, compact, ...callbacks }));
      expect(markup).toMatch(/data-map-site="ritual_ring"[^>]*aria-current="location"/);
      expect(markup).not.toMatch(/data-map-site="ballroom_entrance"[^>]*aria-current="location"/);
    }
  });
});
