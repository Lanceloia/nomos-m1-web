import type { Frame } from './types';
import { currentSite, siteName } from './tabletop';
import { spatialGraph } from './spatial';
import { entityCategory, entityPresences, type EntityPresence } from './presence';

export type GeographicRegion = 'ballroom' | 'halls' | 'ritual' | 'treasure' | 'icebar' | 'lower' | 'stables' | 'prison' | 'tower-base' | 'tower-top' | 'bridge';
export interface GeographicPlace { id: string; label: string; x: number; y: number; region: GeographicRegion }

// Art coordinates follow the original cutaway, not physical distance or admission.
const LOCATIONS: Record<string, [number, number, GeographicRegion]> = {
  ballroom_entrance: [535, 610, 'ballroom'], ballroom_chandelier_reach: [380, 565, 'ballroom'],
  ballroom_chandelier_far_wall: [270, 470, 'ballroom'], ballroom_opposite_wall: [215, 540, 'ballroom'],
  ballroom_bar_side_wall: [350, 675, 'ballroom'], ballroom_icebar_door: [290, 655, 'ballroom'],
  halls_ballroom_door: [530, 475, 'halls'], halls_bridge_door: [355, 350, 'halls'], halls_collision_wall: [495, 275, 'halls'],
  icebar_entry: [175, 610, 'icebar'], ritual_passage_entry: [490, 685, 'ritual'],
  ritual_threshold: [545, 745, 'ritual'], ritual_ring: [470, 755, 'ritual'],
  ritual_side_wall: [590, 765, 'ritual'], ritual_collision_wall: [400, 810, 'ritual'], ritual_lower_door: [495, 850, 'ritual'],
  treasure_approach: [355, 725, 'treasure'], treasure_release: [310, 800, 'treasure'],
  treasure_ice: [285, 760, 'treasure'], treasure_side: [230, 755, 'treasure'], treasure_box_interior: [215, 710, 'treasure'],
  lower_corridor_entry: [485, 915, 'lower'], lower_corridor_wall: [570, 930, 'lower'], stables_approach: [415, 975, 'lower'],
  stables_entry: [445, 1040, 'stables'], stables_collision_wall: [550, 1090, 'stables'],
  prison_outer: [210, 1130, 'prison'], prison_holding: [170, 1175, 'prison'], prison_deep: [95, 1220, 'prison'], captive_cell: [245, 1230, 'prison'],
  tower_base: [750, 995, 'tower-base'], alpha_box_interior: [790, 1035, 'tower-base'], tower_top: [730, 400, 'tower-top'],
  bridge_palace_landing: [335, 335, 'bridge'], bridge_midspan: [225, 255, 'bridge'], palace_exit: [105, 160, 'bridge'], bridge_abyss: [145, 310, 'bridge'],
};

// Reveal only the architectural portion associated with supplied place knowledge.
export const REGION_OUTLINES: Record<GeographicRegion, string> = {
  ballroom: '165,475 425,385 682,585 470,700 175,555',
  halls: '255,365 473,210 680,342 540,487 430,390 355,438',
  ritual: '330,695 475,652 642,768 505,862 393,816',
  treasure: '165,725 325,669 389,749 312,836',
  icebar: '76,573 179,527 357,652 231,720 83,646',
  lower: '426,835 532,817 614,917 489,985 388,942',
  stables: '313,950 456,880 593,1010 481,1117 303,1048',
  prison: '32,1177 214,1044 357,1146 231,1275 54,1243',
  'tower-base': '558,970 742,847 896,963 780,1102 636,1081',
  'tower-top': '551,358 712,298 899,395 803,508 653,490',
  bridge: '78,136 184,151 394,331 300,389 92,207',
};

export function geographicView(frame: Frame) {
  const supplied = [...new Map([
    ...spatialGraph(frame).nodes,
    ...entityPresences(frame).map(item => ({ id: item.site, label: siteName(item.site, frame) })),
  ].map(place => [place.id, place])).values()];
  const places: GeographicPlace[] = supplied.flatMap(node => {
    const art = LOCATIONS[node.id];
    return art ? [{ id: node.id, label: siteName(node.id, frame), x: art[0], y: art[1], region: art[2] }] : [];
  });
  return { places, regions: [...new Set(places.map(place => place.region))],
    here: places.find(place => place.id === currentSite(frame)),
    unillustrated: supplied.filter(node => !LOCATIONS[node.id]),
  };
}

export function geographicLinks(frame: Frame, markers: GeographicPlace[]) {
  const byId = new Map(markers.map(place => [place.id, place]));
  const links = new Map<string, { start: GeographicPlace; end: GeographicPlace; forward: boolean; backward: boolean; routes: { start: string; end: string }[] }>();
  for (const route of frame.scene?.routes ?? []) {
    const a = byId.get(route.start), b = byId.get(route.end);
    if (!a || !b) continue;
    if (a.id === b.id) continue;
    const [start, end] = a.id < b.id ? [a, b] : [b, a];
    const key = JSON.stringify([start.id, end.id]);
    const link = links.get(key) ?? { start, end, forward: false, backward: false, routes: [] };
    if (a === start) link.forward = true; else link.backward = true;
    link.routes.push({ start: route.start, end: route.end });
    links.set(key, link);
  }
  return [...links.values()];
}

export function geographicMarkers(frame: Frame): GeographicPlace[] {
  return geographicView(frame).places;
}

export function geographicEntityClusters(frame: Frame) {
  const places = new Map(geographicView(frame).places.map(place => [place.id, place]));
  const clusters = new Map<string, { key: string; x: number; y: number; kind: string; presence: EntityPresence['presence']; entities: EntityPresence[] }>();
  for (const item of entityPresences(frame)) {
    const place = places.get(item.site);
    if (!place) continue;
    const category = entityCategory(item.kind);
    const key = JSON.stringify([item.site, item.presence, category]);
    // Fixed semantic slots keep clusters still when occupants or input order change.
    const cluster = clusters.get(key) ?? { key, x: Math.max(32, Math.min(868, place.x + (category === 'person' ? -72 : category === 'elemental' ? 0 : 72))),
      y: Math.max(32, Math.min(1248, place.y + (item.presence === 'current' ? -64 : 64))), kind: item.kind, presence: item.presence, entities: [] };
    cluster.entities.push(item);
    if (cluster.kind !== item.kind) cluster.kind = 'object';
    clusters.set(key, cluster);
  }
  return [...clusters.values()];
}

export function geographicViewport() {
  return { x: 0, y: 0, width: 900, height: 1280 };
}
