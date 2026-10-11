import type { Frame, Observation, Offer, SessionResponse } from './types';
import { availableSurface, currentSite, siteName, text } from './tabletop';

export interface SpatialEdge { start: string; end: string; kinds: string[]; offeredOnly: boolean }
export interface SpatialNode { id: string; label: string; region: string }
export interface SpatialRegion { id: string; label: string; sites: SpatialNode[] }

export function siteRegion(id: string): { id: string; label: string } {
  const groups: [RegExp, string, string][] = [
    [/^ballroom_/, 'ballroom', '舞厅'], [/^ritual_/, 'ritual', '仪式处'],
    [/^halls_/, 'halls', '大厅'], [/^(lower_|lower_corridor)/, 'lower', '下廊'],
    [/^(tower_|alpha_box_)/, 'tower', '塔楼'], [/^(prison_|captive_)/, 'prison', '监牢'],
    [/^stables?_/, 'stables', '马厩'], [/^(bridge_|palace_exit$|abyss_)/, 'bridge', '桥与外岸'],
    [/^(treasure_|release_|ice_wall)/, 'treasure', '宝箱通道'], [/^icebar_/, 'icebar', '冰吧'],
  ];
  const group = groups.find(([pattern]) => pattern.test(id));
  return group ? { id: group[1], label: group[2] } : { id: 'other', label: '其他已知地点' };
}

export function spatialGraph(frame: Frame) {
  const here = currentSite(frame);
  const routes = frame.scene?.routes ?? [];
  const ids = new Set([here, ...(frame.scene?.knownSites ?? []), ...routes.flatMap(r => [r.start, r.end]), ...frame.offers.flatMap(o => o.destination ? [o.destination] : [])]);
  const nodes: SpatialNode[] = [...ids].filter(Boolean).map(id => ({ id, label: siteName(id, frame), region: siteRegion(id).id })).sort((a, b) => a.id.localeCompare(b.id));
  const edges = new Map<string, SpatialEdge>();
  const add = (start: string, end: string, kind: string | null, offeredOnly: boolean) => {
    const key = JSON.stringify([start, end]);
    const row = edges.get(key) ?? { start, end, kinds: [], offeredOnly };
    if (kind && !row.kinds.includes(kind)) row.kinds.push(kind);
    row.offeredOnly = row.offeredOnly && offeredOnly;
    edges.set(key, row);
  };
  for (const r of routes) add(r.start, r.end, r.kind, false);
  for (const offer of frame.offers) if (offer.destination) add(here, offer.destination, offer.movementKind ?? null, true);
  const regions: SpatialRegion[] = [...new Set(nodes.map(n => n.region))].map(id => ({ id, label: siteRegion(nodes.find(n => n.region === id)!.id).label, sites: nodes.filter(n => n.region === id) }));
  const regionEdges = new Map<string, SpatialEdge>();
  for (const edge of edges.values()) {
    const start = siteRegion(edge.start).id; const end = siteRegion(edge.end).id;
    if (start === end) continue;
    const key = JSON.stringify([start, end]);
    const row = regionEdges.get(key) ?? { start, end, kinds: [], offeredOnly: edge.offeredOnly };
    row.kinds = [...new Set([...row.kinds, ...edge.kinds])]; row.offeredOnly &&= edge.offeredOnly;
    regionEdges.set(key, row);
  }
  return { here, nodes, edges: [...edges.values()], regions, regionEdges: [...regionEdges.values()] };
}

// Directed public records only. A returned path is a direction, not permission to pass.
export function knownPath(frame: Frame, target: string): string[] | null {
  const graph = spatialGraph(frame);
  if (!graph.nodes.some(n => n.id === target)) return null;
  const queue: string[][] = [[graph.here]]; const seen = new Set([graph.here]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const path = queue[cursor]; const last = path[path.length - 1];
    if (last === target) return path;
    for (const edge of graph.edges.filter(e => e.start === last)) {
      if (seen.has(edge.end)) continue;
      seen.add(edge.end); queue.push([...path, edge.end]);
    }
  }
  return null;
}

export function selectedSiteOffers(frame: Frame, id: string) {
  const direct = frame.offers.filter(o => o.destination === id);
  const path = knownPath(frame, id);
  return { path, firstStep: !direct.length && Boolean(path && path.length > 1), offers: direct.length ? direct : path && path.length > 1 ? frame.offers.filter(o => o.destination === path[1]) : [] };
}

export interface NextStep { title: string; next: string; detail: string; path: string[]; offers: Offer[] }

export function nextStep(frame: Frame): NextStep {
  const phase = frame.information.ritual.phase;
  const finished = phase === 'completed' || phase === 'disrupted';
  const routeLookup = frame.offers.filter(o => o.entry === 'observe_routes_adventurer');
  const empty = (title: string, next: string, detail: string, offers: Offer[] = []): NextStep => ({ title, next, detail, offers, path: [] });
  if (frame.ending) return empty('旅程已结束', frame.ending.title, '现在可以查看结局与保留记录，不再执行世界行动。');
  if (frame.feedback?.status === 'rejected') {
    const checks = frame.offers.filter(o => ['observe_floor_adventurer', 'observe_routes_adventurer'].includes(o.entry ?? ''));
    return empty('暂时无法行动', '看看脚下的地面，或寻找其他通路。', '原因还不清楚；检查也会耗去行动时间。', checks);
  }
  if (!finished) {
    const carry = frame.offers.filter(o => o.entry === 'carry_from_ritual_adventurer');
    const thaw = frame.offers.filter(o => o.entry === 'thaw_ritual_resident');
    if (carry.length || thaw.length) return empty('当前目标：中断仪式', carry.length ? '尝试把居民带离仪式圈，搬向门槛。' : '尝试解冻仪式处的居民。', '行动后照看居民，再寻找出宫的路。', [...carry, ...thaw]);
  } else {
    const leave = frame.offers.filter(o => o.entry === 'leave_palace_adventurer');
    if (leave.length) return empty('当前目标：离开宫殿', '外岸就在这里，可以结束旅程。', '也可以在离开前再看看附近。', leave);
  }
  const graph = spatialGraph(frame);
  const exit = graph.nodes.find(n => n.id === 'palace_exit');
  if (finished && routeLookup.length && !(frame.scene?.routes ?? []).some(r => r.start === graph.here)) {
    return empty('当前目标：探索出宫方向', graph.here === 'bridge_palace_landing' ? '你已到达宫殿桥头。查看眼前的桥路，寻找通向外岸的方向。' : graph.here === 'bridge_midspan' ? '你在桥面中段。查看前方桥路，寻找外岸的方向。' : '还不清楚这里通向哪里，先寻找附近通路。', '查路会耗去行动时间。', routeLookup);
  }
  const returnTowardHall = ['ritual', 'ballroom'].includes(siteRegion(graph.here).id);
  const frontier = finished ? graph.nodes.filter(n => n.id !== graph.here && n.region !== 'ritual' && !(frame.scene?.routes ?? []).some(r => r.start === n.id))
    .map(n => ({ id: n.id, path: knownPath(frame, n.id) })).filter(n => n.path && n.path.length > 1 && frame.offers.some(o => o.destination === n.path![1]))
    .sort((a, b) => a.path!.length - b.path!.length)[0]?.id : undefined;
  const targets = finished
    ? [exit?.id, ...['bridge_midspan', 'bridge_palace_landing'].filter(id => graph.nodes.some(n => n.id === id)), frame.briefing && returnTowardHall ? graph.nodes.find(n => n.id === 'halls_ballroom_door')?.id : undefined, routeLookup.length ? undefined : frontier]
    : ['ritual_ring', 'ritual_threshold', 'ritual_passage_entry'];
  for (const target of targets) {
    if (!target || target === graph.here) continue;
    const path = knownPath(frame, target);
    if (!path || path.length < 2) continue;
    const offers = frame.offers.filter(o => o.destination === path[1]);
    return {
      title: finished ? `仪式${phase === 'completed' ? '已有完成' : '已有中断'}记录 · 探索出宫方向` : phase === 'critical' ? '仪式接近完成 · 优先寻找中断机会' : '当前目标：优先探索仪式方向',
      next: `${offers.length ? '下一步：尝试前往' : '这个方向先经过'}${siteName(path[1], frame)}${finished ? target === exit?.id ? '，朝外岸探索。' : target === 'halls_ballroom_door' && frame.briefing && returnTowardHall ? '，返回大厅入口继续寻找出宫的路。' : '，探索还不熟悉的通路。' : '，朝仪式处前行。'}`,
      detail: `${finished ? '继续帮助居民，寻找出宫的路。' : '根据眼前可用的行动选择路线；观察也会耗去时间。'}${offers.length ? '' : '暂时没有前往的行动，可以先查看附近通路。'}`,
      path, offers: offers.length ? offers : routeLookup,
    };
  }
  const directions = frame.offers.filter(o => o.destination && o.destination !== graph.here);
  return empty(finished ? '当前目标：探索出宫方向' : '当前目标：寻找仪式方向', finished
    ? exit ? '还不清楚怎样从这里到达外岸，先找找附近通路。' : '出口的方向还不清楚，先探索附近通路。'
    : '还不清楚怎样前往仪式处，先找找附近通路。',
  finished ? '可以在途中照看居民。' : '观察和行动都会耗去时间。', routeLookup.length ? routeLookup : directions);
}

export function latestHistory(frame: Frame, id: string): Observation | undefined {
  return frame.observations.filter(o => o.id === id).sort((a, b) => (b.detailRecordedAt ?? b.recordedAt).revision - (a.detailRecordedAt ?? a.recordedAt).revision)[0];
}

export function newerMovement(frame: Frame, item: Observation) {
  const observed = item.detailRecordedAt ?? item.recordedAt;
  return frame.information.movements.filter(row => row.subjectId === item.id && row.recordedAt.revision > observed.revision).reverse()
    .sort((a, b) => b.recordedAt.revision - a.recordedAt.revision)[0];
}

export function recentThawDetailNote(frame: Frame, item: Observation, submitted?: Offer): string | null {
  if (!submitted?.targetIds?.includes(item.id) || frame.feedback?.status !== 'published' || frame.feedback.entry !== submitted.entry
    || !/^You spent one charge thawing the person(?:\.| at the ritual and interrupted the chant\.)/.test(frame.feedback.text)
    || (item.detailRecordedAt ?? item.recordedAt).time >= frame.time) return null;
  return '刚刚已解冻对方。下面保留的是较早的观察，可以再查看一次。';
}

export interface SurfaceChange { id: string; label: string; kind: 'appeared' | 'disappeared'; hasMovement: boolean }

export function surfaceReadbackChanges(before: SessionResponse | null, after: SessionResponse): SurfaceChange[] {
  if (!before || before.sessionId !== after.sessionId || before.frame.information.visibility !== 'provided' || after.frame.information.visibility !== 'provided') return [];
  const old = availableSurface(before.frame); const current = availableSurface(after.frame);
  const changes: SurfaceChange[] = [];
  for (const item of current) if (!old.some(o => o.id === item.id)) changes.push({ id: item.id, label: text(item.label), kind: 'appeared', hasMovement: false });
  for (const item of old) if (!current.some(o => o.id === item.id)) changes.push({ id: item.id, label: text(item.label), kind: 'disappeared', hasMovement: after.frame.information.movements.some(m => m.subjectId === item.id && !before.frame.information.movements.some(o => o.id === m.id)) });
  return changes;
}
