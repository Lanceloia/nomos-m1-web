import type { Discovery, EscortReplyObservation, Frame, Offer, Observation, RecordedAt } from './types';

export type Selection = { kind: 'site'; id: string } | { kind: 'object'; id: string } | { kind: 'surface'; id: string } | { kind: 'feature'; id: string } | { kind: 'all' } | { kind: 'observations' };
export interface Place { id: string; label: string; x: number; y: number }
export interface TableFeature { id: string; label: string; note: string; icon: 'floor' | 'voices'; x: number; y: number }

const FEATURE_ENTRIES: Record<string, string[]> = {
  floor: ['observe_floor_adventurer', 'thaw_floor_adventurer'],
  voices: ['offer_escort_adventurer'],
};

// These coordinates are a presentation layout, not distances or world geometry.
const PLACES: Record<string, [string, number, number]> = {
  ballroom_entrance: ['舞厅入口', 75, 77],
  ballroom_chandelier_reach: ['吊灯边缘', 50, 47],
  ballroom_chandelier_far_wall: ['吊灯尽头墙', 23, 30],
  ballroom_opposite_wall: ['舞厅远墙', 16, 46],
  ballroom_bar_side_wall: ['冰吧旁墙', 32, 78],
  ballroom_icebar_door: ['冰吧门', 12, 78],
  halls_ballroom_door: ['大厅入口', 78, 25],
  ritual_passage_entry: ['仪式通道', 90, 47],
  ritual_threshold: ['仪式门槛', 60, 50],
  ritual_ring: ['仪式圈', 35, 35],
  treasure_approach: ['宝箱通道', 90, 72],
  bridge_palace_landing: ['宫殿桥头', 70, 70],
  bridge_midspan: ['深渊窄桥', 48, 48],
  palace_exit: ['外岸', 25, 25],
};

export function siteName(id: string, frame?: Frame): string {
  const label = PLACES[id]?.[0] ?? frame?.scene?.siteLabels[id];
  return label && label !== id ? text(label) : PLACES[id]?.[0] ?? '未知地点';
}
export function currentSite(frame: Frame): string { return frame.scene?.playerSite ?? frame.fields.locationId ?? frame.fields.location; }
export function isBallroom(frame: Frame): boolean { return currentSite(frame).startsWith('ballroom_'); }

export function places(frame: Frame): Place[] {
  const here = currentSite(frame);
  const ids = [...new Set([here, ...(frame.scene?.knownSites ?? []), ...frame.offers.flatMap(o => o.destination ? [o.destination] : [])])];
  const immediate = new Set(frame.offers.flatMap(o => o.destination ? [o.destination] : []));
  const visible = ids.filter(id => id === here || immediate.has(id) || isBallroom(frame) && id.startsWith('ballroom_'));
  return visible.map((id, i) => {
    const known = PLACES[id];
    return { id, label: siteName(id, frame), x: known?.[1] ?? 20 + i % 4 * 20, y: known?.[2] ?? 25 + Math.floor(i / 4) * 25 };
  });
}

export function routeKindName(kind: string): string {
  return ({ ice: '冰面路线', walk: '普通通路', bridge: '桥段' } as Record<string, string>)[kind] ?? text(kind);
}

export function adjacentSites(frame: Frame) {
  const routes = (frame.scene?.routes ?? []).filter(route => route.start === currentSite(frame));
  const destinations = new Set([...routes.map(route => route.end), ...frame.offers.flatMap(offer => offer.destination ? [offer.destination] : [])]);
  return [...destinations].map(id => ({
    id, label: siteName(id, frame),
    kinds: [...new Set(routes.filter(route => route.end === id).map(route => route.kind))],
    offers: frame.offers.filter(offer => offer.destination === id),
  })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN') || a.id.localeCompare(b.id));
}

export interface RouteReadbackChange {
  kind: 'added' | 'changed' | 'removed';
  label: string;
  beforeKinds: string[];
  afterKinds: string[];
}

// These are differences between public records, not a verdict about passage or cause.
export function routeReadbackChanges(before: Frame | null, after: Frame): RouteReadbackChange[] {
  if (!before?.scene || !after.scene) return [];
  const group = (frame: Frame) => {
    const result = new Map<string, { start: string; end: string; kinds: Set<string> }>();
    for (const route of frame.scene!.routes) {
      const key = JSON.stringify([route.start, route.end]);
      const row = result.get(key) ?? { start: route.start, end: route.end, kinds: new Set<string>() };
      row.kinds.add(route.kind);
      result.set(key, row);
    }
    return result;
  };
  const previous = group(before); const current = group(after);
  const changes: RouteReadbackChange[] = [];
  for (const [key, row] of current) {
    const old = previous.get(key);
    const beforeKinds = [...(old?.kinds ?? [])].sort(); const afterKinds = [...row.kinds].sort();
    if (old && beforeKinds.length === afterKinds.length && beforeKinds.every((kind, i) => kind === afterKinds[i])) continue;
    changes.push({ kind: old ? 'changed' : 'added', label: `${siteName(row.start, after)} → ${siteName(row.end, after)}`, beforeKinds, afterKinds });
  }
  for (const [key, row] of previous) {
    if (!current.has(key)) changes.push({ kind: 'removed', label: `${siteName(row.start, before)} → ${siteName(row.end, before)}`, beforeKinds: [...row.kinds].sort(), afterKinds: [] });
  }
  return changes;
}

export function sessionRouteChanges(before: { sessionId: string; frame: Frame } | null, after: { sessionId: string; frame: Frame }): RouteReadbackChange[] {
  return before?.sessionId === after.sessionId ? routeReadbackChanges(before.frame, after.frame) : [];
}

export function movementDescription(offer: Offer): string | null {
  if (/^Careful bridge crossing \(no balance roll; same cost as risky crossing\) toward /.test(offer.label)) return '小心过桥：免平衡检定，耗费与冒险过桥相同。桥段冰封时需要先处理地面。';
  if (/^Risky bridge crossing \(d20 \+ balance bonus >= 12; failure kills; no cost saving\) toward /.test(offer.label)) return '冒险过桥：d20 + 平衡加值需达到 12，失败致命。耗费与小心过桥相同。';
  if (offer.movementKind === 'ice' || /^(Attempt crossing toward |Cross ice toward )/.test(offer.label)) return '穿越冰面，可能滑到其他落点。';
  if (offer.movementKind === 'walk' || /^Attempt direct passage \(ice may block\) to /.test(offer.label)) return '沿通路行走。冰封的地面可能挡住去路。';
  return null;
}

export function contextOffers(frame: Frame, selection: Selection): Offer[] {
  if (selection.kind === 'all') return frame.offers;
  if (selection.kind === 'observations') return observationOffers(frame);
  if (selection.kind === 'object' || selection.kind === 'surface') {
    const torch = availableSurface(frame).some(item => item.id === selection.id && item.kind === 'everflame');
    return frame.offers.filter(o => o.targetIds?.includes(selection.id) || torch
      && (/^thaw_/.test(o.entry ?? '') || ['reload_everflame_adventurer', 'load_elemental_torch_adventurer'].includes(o.entry ?? '')));
  }
  if (selection.kind === 'feature') return frame.offers.filter(o => FEATURE_ENTRIES[selection.id]?.includes(o.entry ?? ''));
  return frame.offers.filter(o => o.destination === selection.id || selection.id === currentSite(frame) && (!o.destination || /^carry_/.test(o.entry ?? '')));
}

export function observationOffers(frame: Frame): Offer[] {
  return frame.offers.filter(o => /^(observe_|inspect_)/.test(o.entry ?? ''));
}

// An affordance exposes the existing public action, not an unseen entity or its state.
export function tableFeatures(frame: Frame): TableFeature[] {
  const entries = new Set(frame.offers.map(o => o.entry));
  const result: TableFeature[] = [];
  if (entries.has('observe_floor_adventurer') || entries.has('thaw_floor_adventurer')) {
    const floor = memoriesAtSite(frame, currentSite(frame)).find(o => o.kind === 'floor');
    result.push({ id: 'floor', label: '脚下地面', icon: 'floor', x: 30, y: 78, note: floor ? `上次检查：${floor.state === 'frozen' ? '有冰' : floor.state === 'normal' ? '无冰' : '未知'}` : '尚未细查' });
  }
  if (entries.has('offer_escort_adventurer')) result.push({ id: 'voices', label: '护送邀请', icon: 'voices', x: 26, y: 54, note: frame.information.escortResponse.label });
  return result;
}

export function needsConfirmation(offer: Offer): boolean {
  return Boolean(publicCost(offer) || offer.destination || offer.targetIds?.length || offer.forecasts?.length) || ['leave_palace_adventurer', 'carry_from_ritual_adventurer'].includes(offer.entry ?? '');
}

export function memoriesAtSite(frame: Frame, site: string): Observation[] {
  return frame.observations.filter(o => o.site === site);
}

export function recordedAt(stamp: RecordedAt | null): string {
  return stamp ? `时刻 ${stamp.time}` : '尚未细看';
}

function actionPurpose(offer: Offer, frame: Frame): string {
  if (offer.entry === 'leave_palace_adventurer') return '离开冰宫，结束这次旅程并查看结算。';
  if (offer.entry === 'detach_reservoir_adventurer') return '把吊灯的储能器带在身上，之后可用它给永焰补能。';
  if (offer.entry === 'reload_everflame_adventurer') return '把所带储能器中的充能转入永焰。';
  if (offer.entry === 'thaw_floor_adventurer') return '用永焰融去可达冰面，再查看地面和可走的路线。';
  if (/^thaw_(person|ritual_resident|queen|fox)/.test(offer.entry ?? '')) return '用永焰尝试解冻眼前目标，之后再查看他的状况与去向。';
  if (offer.entry === 'observe_routes_adventurer') return '了解附近有哪些通路，再选择前进方向。';
  if (offer.entry === 'observe_floor_adventurer') return '看看脚下是否结冰，再决定直接通行、穿冰或先解冻。';
  if (offer.entry === 'observe_climbs_adventurer') return '检查眼前是否有可利用的攀爬路线。';
  if (offer.entry === 'observe_foxes_adventurer') return '寻找附近冰狐的线索，看看是否有新的探索机会。';
  if (offer.entry === 'observe_resident_adventurer') return '了解这位居民的状况，再决定是否提供帮助。';
  if (offer.entry === 'carry_from_ritual_adventurer') return ['completed', 'disrupted'].includes(frame.information.ritual.phase)
    ? '把居民带向仪式门槛，之后查看他的状况。'
    : '尝试把居民带离仪式圈，借此打断仪式。';
  if (offer.entry === 'offer_torch_adventurer') return '向对方提议借助永焰离开，并指向仪式门槛。';
  if (offer.entry === 'inspect_patient_adventurer') return '寻找上次见到的人，查看他的状况。';
  if (offer.entry === 'care_person_adventurer') return '尝试照护这位已观察的人。';
  if (/^carry_/.test(offer.entry ?? '')) return '尝试搬运这位居民，到达后再查看他的状况。';
  if (offer.entry === 'offer_escort_adventurer') return '呼喊居民，邀请他们一起离开。';
  const movement = movementDescription(offer);
  if (movement) return movement;
  if (offer.entry === 'cross_ice_adventurer' || offer.movementKind === 'ice') return '尝试穿越冰面；可能停在其他落点，以公开结算为准。';
  if (offer.entry === 'move_adventurer') return '尝试沿通路前行，留意冰封的地面。';
  if (offer.destination) return `尝试前往${siteName(offer.destination, frame)}。`;
  if (/^observe_|^inspect_/.test(offer.entry ?? '')) return '花一点时间仔细查看。';
  return publicCost(offer) ?? '采取这项行动。';
}

export function historicalTargetWarning(offer: Offer, frame: Frame): string | null {
  const deadRecords = frame.observations.filter(o => offer.targetIds?.includes(o.id) && (text(o.state) === '死亡' || o.facts.some(f => ['生命', 'Life', 'life'].includes(f.label) && text(f.value) === '死亡')));
  return deadRecords.length ? `${deadRecords.map(o => `${targetNames({ ...offer, targetIds: [o.id] }, frame)[0]}的上次观察记录为死亡（${recordedAt(o.detailRecordedAt ?? o.recordedAt)}）`).join('；')}；如需了解现况，请在附近重新观察。` : null;
}

export function actionNote(offer: Offer, frame: Frame, includeHistory = true): string {
  return `${includeHistory ? historicalTargetWarning(offer, frame) ?? '' : ''}${passageWarning(offer, frame) ?? ''}${actionPurpose(offer, frame)}`;
}

export function passageWarning(offer: Offer, frame: Frame): string | null {
  if (offer.entry !== 'move_adventurer') return null;
  const warning = offer.passageWarning;
  const floor = warning?.floorState === 'frozen' ? '你上次检查到这里有冰，直接通行可能受阻。'
    : warning?.floorState === 'clear' ? '你上次检查到这里无冰，但不保证这条通路现在可通过。'
    : '这里的地面情况尚不清楚，直接通行结果仍不确定。';
  const blocked = warning?.lastAttemptBlocked ? '上次从这里向同一目的地的直接尝试受阻；具体原因未知。再次尝试仍会按真实行动结算。' : '';
  const alternatives = frame.offers.filter(row => warning?.crossingIndexes.includes(row.index)
    && row.entry === 'cross_ice_adventurer' && row.destination === offer.destination);
  return `${blocked}${floor}${alternatives.length ? '同一目的地另有「尝试穿越冰面」选项；穿冰也不保证抵达。' : ''}`;
}

export function forecastName(label: string): string {
  if (label.startsWith('My protection if')) return '成功抵达后的保护';
  return text(label);
}

export function actionValueNote(offer: Offer): string | null {
  return offer.forecasts?.some(row => row.label === '行动值消耗'
    && typeof row.value === 'number' && Number.isInteger(row.value) && row.value >= 0)
    ? '行动值用于计算下一次行动机会；世界推进后的实际耗时显示在行动回执中。'
    : null;
}

export function availableSurface(frame: Frame) {
  return frame.information.visibility === 'provided' ? frame.information.visibleEntities.filter(item => item.site === currentSite(frame)) : [];
}

export function currentMapEntities(frame: Frame) {
  const supplied = [...availableSurface(frame), ...frame.information.nearbyEntities];
  return [...new Map(supplied.reverse().map(item => [item.id, item])).values()];
}

export function targetNames(offer: Offer, frame: Frame): string[] {
  return (offer.targetIds ?? []).map(id => {
    const item = currentMapEntities(frame).find(o => o.id === id) ?? frame.observations.find(o => o.id === id);
    return item ? publicLabel(item.label) : '目标尚无公开名称';
  });
}

export function publishedResult(frame: Frame) {
  return frame.feedback?.status === 'published' ? frame.feedback.result : null;
}

export function observationReadback(observation: Observation, frame: Frame): string {
  const detail = observation.detailRecordedAt;
  const name = publicLabel(observation.label);
  if (observation.kind === 'wall' && observation.evidence === 'checked_target')
    return `${name}：已完成检查，具体墙况尚未记录`;
  if (!detail || detail.time !== observation.recordedAt.time || detail.revision !== observation.recordedAt.revision)
    return `${name}${observation.site ? ` · ${siteName(observation.site, frame)}` : ''}（${detail ? `所见记录更新；详情沿用${recordedAt(detail)}的观察` : '尚未细查'}）`;
  const facts = observation.kind === 'floor'
    ? observation.state === 'frozen' ? '有冰' : observation.state === 'normal' ? '无冰' : '情况未明'
    : observation.facts.map(fact => `${text(fact.label)} ${text(fact.value)}`).join('，')
      || observationDetailNote(observation) || text(observation.state);
  return `${name}：${facts}`;
}

export function receiptDiscoveries(frame: Frame): string[] {
  const result = publishedResult(frame);
  if (!result) return [];
  return [
    ...result.discoveries.map(item => ({ item, when: '本次' })),
    ...result.laterDiscoveries.map(item => ({ item, when: '随后' })),
  ].sort((a, b) => {
    const priority = (item: Discovery) => item.kind === 'ritual' || item.kind === 'escort_reply' ? 0 : item.kind === 'movement' ? 1
      : item.observation.detailRecordedAt?.revision === item.observation.recordedAt.revision ? 2 : 3;
    return priority(a.item) - priority(b.item);
  }).map(({ item, when }) => {
    if (item.kind === 'ritual') return `${when}听见：${text(item.label)}`;
    if (item.kind === 'escort_reply') return `${when}实际听到${escortReplyReadback(item.reply, frame)}`;
    if (item.kind === 'movement') return `${when}看见${publicLabel(item.movement.label)}：${siteName(item.movement.start, frame)} → ${siteName(item.movement.end, frame)}`;
    return `${when}记录 · ${observationReadback(item.observation, frame)}`;
  });
}

export function escortReplyReadback(reply: EscortReplyObservation, frame: Frame): string {
  const status = { ready_now: '当时表示已准备动身', not_ready_now: '当时表示尚未准备动身', unable_now: '当时表示无法动身' };
  return `${publicLabel(reply.label)}：${status[reply.status]}，目的地为${siteName(reply.destination, frame)}`;
}

export function hasPublicVitalLoss(frame: Frame): boolean {
  const result = publishedResult(frame);
  if (!result) return false;
  return [...result.changes, ...result.laterChanges].some(change => {
    if (!['life', 'endurance'].includes(change.field)) return false;
    if (typeof change.before === 'number' && typeof change.after === 'number') return change.after < change.before;
    const before = String(change.before).toLowerCase(), after = String(change.after).toLowerCase();
    return change.field === 'life' && (before === 'alive' && ['dead', 'incapacitated'].includes(after)
      || before === 'incapacitated' && after === 'dead');
  });
}

const ACTIONS: Record<string, string> = {
  cross_ice_adventurer: '尝试穿越冰面', move_adventurer: '尝试直接通行',
  observe_floor_adventurer: '检查脚下冰面', observe_routes_adventurer: '寻找附近通路',
  observe_chandelier_adventurer: '观察吊灯并呼喊', detach_reservoir_adventurer: '取下吊灯储能器',
  reload_everflame_adventurer: '给永焰补充能量', thaw_floor_adventurer: '解冻可达冰面',
  offer_escort_adventurer: '邀请居民同行', wait_adventurer: '留在原地等待',
  observe_climbs_adventurer: '检查可攀爬的表面', observe_elemental_adventurer: '寻找附近冰元素',
  observe_foxes_adventurer: '寻找附近冰狐', observe_resident_adventurer: '观察居民',
  thaw_person_adventurer: '尝试解冻居民', thaw_ritual_resident: '尝试解冻仪式居民',
  leave_palace_adventurer: '离开宫殿', bridge_slow_adventurer: '小心过桥', bridge_rush_adventurer: '冒险过桥',
  carry_from_ritual_adventurer: '尝试搬离仪式，带向门槛', offer_torch_adventurer: '提出永焰并提及门槛',
  carry_move_adventurer: '尝试搬运已观察的目标通行', carry_cross_ice_adventurer: '尝试搬运已观察的目标穿越冰面',
  carry_bridge_slow_adventurer: '尝试搬运已观察的目标小心过桥', carry_pass_door_adventurer: '尝试搬运已观察的目标穿过门口',
  inspect_patient_adventurer: '尝试查看上次见到的人', strike_person_adventurer: '攻击已观察的目标',
  care_person_adventurer: '尝试照护已观察的目标', observe_hall_adventurer: '寻找大厅里的人',
  observe_wall_adventurer: '观察可达冰墙', open_wall_adventurer: '消耗永焰打开冰墙',
  open_plain_wall_adventurer: '消耗永焰打开冰墙', move_wall_adventurer: '尝试穿过冰墙通道',
  observe_chest_adventurer: '查看宝箱', open_chest_adventurer: '打开宝箱', take_gold_adventurer: '取出宝箱金币',
  take_magic_item_adventurer: '取出魔法物品', climb_skyhook_adventurer: '使用天钩攀爬',
  observe_fox_adventurer: '观察已知冰狐', thaw_fox_adventurer: '尝试解冻已观察的冰狐',
  request_tame_arctic_fox_one: '尝试接近已观察的独行冰狐', request_tame_arctic_fox_two: '尝试接近已观察的独行冰狐',
  request_tame_arctic_fox_three: '尝试接近已观察的独行冰狐', request_tame_arctic_fox_four: '尝试接近已观察的独行冰狐',
  observe_tower_adventurer: '观察塔底的人', observe_queen_adventurer: '观察塔顶冰封的读书者',
  thaw_queen_adventurer: '尝试解冻已观察的女王', observe_resident_queen_adventurer: '观察已知居民',
  observe_resident_tower_bear_adventurer: '观察已知居民', observe_resident_bar_bear_adventurer: '观察已知居民',
  observe_resident_prison_guard_adventurer: '观察已知居民', observe_resident_prison_voice_adventurer: '观察已知居民',
  observe_resident_fox_adventurer: '观察已知居民', observe_prison_voices_adventurer: '观察附近监牢居民',
  observe_prison_people_adventurer: '寻找这里的监牢居民', observe_prison_bars_adventurer: '查看牢房铁栅',
  set_prison_bars_adventurer: '打开或关闭已观察的铁栅', pass_prison_bars_adventurer: '尝试穿过已观察的开放铁栅',
  observe_prison_line_adventurer: '观察监牢看守线', pass_prison_line_adventurer: '尝试穿过上次观察畅通的看守线',
  receive_charge_adventurer: '接收对方提供的充能', load_charge_adventurer: '把接收的充能装入永焰',
  thaw_door_adventurer: '解冻冰封马厩门', open_door_adventurer: '打开已解冻的马厩门',
  close_door_adventurer: '关闭马厩门', pass_door_adventurer: '尝试穿过马厩门口',
  observe_bar_adventurer: '察看冰吧', invite_guest_adventurer: '请求邀请客人喝一杯',
  request_pour_adventurer: '请求双方允许倒一份饮品', pour_drink_adventurer: '倒入一份获准的饮品',
  observe_drink_adventurer: '查看所持容器', thaw_drink_adventurer: '解冻已查看的容器',
  show_magic_adventurer: '自愿展示魔法原物供研究', withdraw_magic_adventurer: '撤回魔法物品展示',
  report_alpha_adventurer: '报告在宫殿外看到女王存活', accept_alpha_adventurer: '接受已听到的护送提议（尚未交付物品）',
  observe_balloon_power_adventurer: '查看球囊动力舱', extract_balloon_power_adventurer: '取出球囊动力（将无法飞行）',
  load_balloon_power_adventurer: '把携带的球囊动力装入永焰', balloon_push_adventurer: '推动空球囊',
  balloon_push_ice_adventurer: '推动空球囊穿越冰面', balloon_push_bridge_adventurer: '沿桥慢推空球囊',
  balloon_push_door_adventurer: '推动空球囊穿过开放门口', look_tower_top_adventurer: '察看塔顶',
  explain_balloon_adventurer: '解释球囊下行旅程', ask_alpha_adventurer: '询问带女王离开宫殿的事',
  pickup_elemental_charge_adventurer: '拾取元素充能', load_elemental_torch_adventurer: '把元素充能装入永焰',
  load_elemental_firelock_adventurer: '把元素充能装入火器', fireball_adventurer: '发射火球',
  load_firelock_adventurer: '把一份永焰充能装入火器', drop_magic_adventurer: '放下魔法物品',
  pickup_magic_adventurer: '拾起已放下的魔法物品', inspect_brands_adventurer: '查看魔法物品上的标记',
};
export const actionName = (o: Offer): string => {
  const wall = /^(Observe |Spend one charge to open |Pass through )(Release ice wall|Treasure ice wall)(.*)$/.exec(o.label);
  if (wall) {
    const name = wall[2] === 'Release ice wall' ? '释放冰墙' : '宝箱冰墙';
    const verb = wall[1] === 'Observe ' ? '观察' : wall[1] === 'Pass through ' ? '尝试穿过' : '消耗 1 点永焰打开';
    return `${verb}${name}${wall[3].startsWith(' to release ') ? `（尝试释放：${text(wall[3].slice(12))}）` : wall[3] ? ` · ${text(wall[3])}` : ''}`;
  }
  if (o.entry === 'observe_resident_adventurer' && o.label === 'Observe nearby person') return '观察附近人物';
  if (['balloon_control_adventurer', 'balloon_flight_adventurer', 'transfer_balloon_power_adventurer'].includes(o.entry ?? '')) return text(o.label);
  if (o.entry === 'ask_prison_adventurer') return o.label.startsWith('Ask for a charge:') ? '询问能否提供充能' : o.label.startsWith('Ask about yourself:') ? '询问对方的情况' : text(o.label);
  if (/^brand_(person|elemental)(_[a-z_]+)?_adventurer$/.test(o.entry ?? '')) return '用魔法物品触碰已观察的目标';
  if (/^locate_branded_(person|elemental)(_[a-z_]+)?_adventurer$/.test(o.entry ?? '')) return '用魔法物品寻找已标记的目标';
  if (/^focus_(person|queen|fox|tower_bear|bar_bear|prison_guard|prison_voice|elemental)_adventurer$/.test(o.entry ?? '')) return '将魔法物品聚焦于已观察的目标';
  return ACTIONS[o.entry ?? ''] ?? text(o.label);
};

export const CHANDELIER_NOTICES: Record<string, string> = {
  'Two people answer beneath the chandelier. A faint pulse at its center matches the Everflame; it may hold charge.': '吊灯下有两人回应。中心微光与永焰呼应，可能储存着能量。',
  'Two people answer beneath the chandelier. No matching pulse is visible.': '吊灯下有两人回应。没有看见与永焰呼应的微光。',
  'One person answers beneath the chandelier. A faint pulse at its center matches the Everflame.': '吊灯下有一人回应。中心微光与永焰呼应。',
  'One person answers beneath the chandelier. No matching pulse is visible.': '吊灯下有一人回应。没有看见与永焰呼应的微光。',
  'No one answers your call. A faint pulse at the chandelier center matches the Everflame.': '没有人回应你的呼喊。吊灯中心的微光与永焰呼应。',
  'No one answers your call, and no matching pulse is visible.': '没有人回应你的呼喊，也没有看见与永焰呼应的微光。',
};

const TEXT: Record<string, string> = {
  '这里只确认眼前存在和粗略位置；详细状态仍需观察。': '靠近后仔细观察，可以了解更多。',
  '尚未发出护送邀请；人物自行移动不表示回应。': '你还没有发出离开的邀请。',
  '当前表面仅确认同区存在，详细状态未知。': '靠近后仔细观察，可以了解更多。',
  'Release ice wall': '释放冰墙', 'Treasure ice wall': '宝箱冰墙', Everflame: '永焰',
  'Action resolved.': '行动完成。', 'Observe nearby person': '观察附近人物',
  'At the foot of the tower': '塔下', 'Tower wall landing': '塔墙平台', 'Top of the tower': '塔顶',
  'Inside the tower chest': '塔下宝箱内部', 'Inside the carried reward box': '报酬锁盒内部',
  preparing: '准备中', gathering: '聚集中', critical: '接近完成', erupted: '已完成', disrupted: '已中断', completed: '已完成',
  'Protection at the known target area now': '已知目标区域目前的保护记录',
  'Protection there after spending one charge, using known coverage': '消耗 1 点后该区域的保护（依据已知覆盖）',
  'Board the balloon basket': '登上球囊吊篮', 'Leave the balloon basket': '离开球囊吊篮',
  'Untie the balloon (does not start flight)': '解开球囊系绳（不启动飞行）',
  'Deflate the empty balloon (does not move it)': '给空球囊放气（不移动）',
  'Inflate the empty balloon (does not start flight)': '给空球囊充气（不启动飞行）',
  'Fly the balloon to the upper stop': '驾驶球囊前往上层停靠点', 'Fly the balloon to the lower stop': '驾驶球囊前往下层停靠点',
  'Reload the balloon with the carried power': '把携带的动力装回球囊',
  'Withdraw balloon power into the same empty carrier': '把球囊动力收回同一空载具',
  unknown: '未知', normal: '正常', frozen: '冰封', mobile: '可行动', immune: '不受宫殿寒冷影响', alive: '存活', dead: '死亡',
  Alive: '存活', Dead: '死亡', Frozen: '冰封', Normal: '正常', true: '是', false: '否', True: '是', False: '否',
  'Able to move': '可行动', 'Within the Everflame\'s reach': '受永焰保护',
  'Exposed to the cold': '暴露于寒冷', 'No charge to spend': '没有充能',
  'Unaffected by palace cold': '不受宫殿寒冷影响', incapacitated: '无法行动',
  'The ritual is still gathering': '曾察觉仪式仍在进行',
  'The ritual is close to completion': '曾察觉仪式接近完成',
  'The ritual has been disrupted here': '曾察觉仪式已中断',
  'The ritual has completed here': '曾察觉仪式已完成',
  'Unknown from my available knowledge; not a safety verdict': '保护情况未知',
  ...CHANDELIER_NOTICES,
  'First person in the hall': '大厅居民一', 'Second person in the hall': '大厅居民二',
  'Third person in the hall': '大厅居民三', 'Fourth person in the hall': '大厅居民四', 'Fifth person in the hall': '大厅居民五',
  'First resident by the chandelier': '吊灯旁居民一', 'Second resident by the chandelier': '吊灯旁居民二',
  'Resident at the ritual': '仪式处居民', 'Resident trapped in ice': '冰中受困居民',
  'Outside shore beyond the bridge': '外岸', 'Halls beside the ballroom': '大厅入口',
  'Halls beside the bridge stair': '桥梯旁大厅', 'Halls wall (collision point)': '大厅墙边（碰撞落点）',
  'Palace bridgehead above the abyss': '深渊上的宫殿桥头', 'Narrow bridge above the abyss': '深渊窄桥',
  'Ballroom ice-bar door': '舞厅冰吧门', 'Ice bar': '冰吧', 'Ritual lower stair': '仪式下层阶梯',
  'Lower passage': '下层通道', 'Lower passage wall (collision point)': '下层通道墙边（碰撞落点）',
  'Before the frozen stable door': '冰封马厩门前', 'Beyond the frozen stable door': '冰封马厩门内',
  'Stable wall after a slide': '滑行后的马厩墙边', 'Outside the prison guard line': '监牢看守线外',
  'Prison holding area': '监牢关押区', 'Deeper in the prison': '监牢深处', 'Inside the barred cell': '铁栅牢房内',
  'Ballroom entrance': '舞厅入口', 'Ritual passage': '仪式通道', 'Ritual threshold': '仪式门槛',
  'Ritual circle': '仪式圈', 'Beneath the chandelier': '吊灯下',
  'Ballroom far wall (collision point)': '舞厅远墙（碰撞落点）',
  'Wall beyond the chandelier (collision point)': '吊灯尽头墙（碰撞落点）',
  'Ice-bar-side wall (collision point)': '冰吧旁墙（碰撞落点）',
  'Ritual passage wall (collision point)': '仪式通道墙边（碰撞落点）',
  'Treasure corridor': '宝箱通道', 'Release side of the ice wall': '冰墙释放侧',
  'Beyond the treasure wall': '宝箱墙后', 'Inside the ice wall': '冰墙内', 'Abyss below the palace bridge': '宫殿桥下深渊',
};
const RAW_REFERENCE = /\b[\w-]*_[\w_-]+\b|\bseen-\d+\b|\b(?:ref|owner|occurrence)\s*[=:<(]|\b[0-9a-f]{24,}\b/i;

export function publicLabel(label: string): string {
  const raw = label.trim();
  if (RAW_REFERENCE.test(raw)) return '未知';
  return Object.hasOwn(TEXT, raw) ? TEXT[raw] : raw;
}

export const text = (value: unknown): string => {
  if (value == null) return '未知';
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '未知';
  const raw = String(value).trim();
  if (TEXT[raw]) return TEXT[raw];
  if (/^unknown$/i.test(raw)) return '未知';
  if (/^(preparing|gathering|critical|erupted|disrupted|completed)(\s*[→·]\s*(preparing|gathering|critical|erupted|disrupted|completed))*$/.test(raw)) return raw.replace(/preparing|gathering|critical|erupted|disrupted|completed/g, phase => TEXT[phase]);
  if (raw.startsWith('Unknown')) return '尚不清楚';
  if (RAW_REFERENCE.test(raw)) return '未知';
  return raw;
};

export function publicCost(offer: Offer): string | null {
  if (/^Spend one charge to (thaw|open)\b/.test(offer.label)) return '消耗 1 点永焰';
  if (offer.label === 'Load one reservoir charge into the Everflame') return '转入 1 点储能器充能';
  return null;
}

export function publicTowerDialogue(frame: Frame): Observation[] {
  return frame.observations.filter(item => item.kind === 'dialogue' && item.evidence === 'heard_offer');
}

export function observationDetailNote(item: Observation): string | null {
  if (item.kind === 'wall' && item.evidence === 'checked_target')
    return '检查已经完成；这条记录只确认检查过该目标，具体墙况尚未记录。';
  if (item.facts.length || text(item.state) !== '未知') return null;
  return text(item.label) === '永焰' || item.kind === 'everflame'
    ? '这条永焰存在记录没有详细状态；充能见上方本人状态。'
    : '这条存在记录没有详细状态。';
}

export function feedbackTitle(frame: Frame): string {
  const feedback = frame.feedback;
  if (!feedback && frame.ending) return text(frame.ending.title);
  if (!feedback) return '永焰已点燃。你的旅程从舞厅开始。';
  if (feedback.status === 'rejected') return feedback.refusal.code === 'UNPUBLISHED_RESULT'
    ? '提交结果待核对' : '行动未发生';
  const result = publishedResult(frame);
  if (result?.movementAttempt?.outcome === 'blocked') return `通行尝试受阻，仍在${siteName(result.movementAttempt.landing, frame)}`;
  if (result?.landing) return result.collision ? `碰撞后停在${siteName(result.landing, frame)}` : result.target && result.landing !== result.target ? `未达目标，停在${siteName(result.landing, frame)}` : `抵达${siteName(result.landing, frame)}`;
  const actualText = feedback.text?.trim().replace(/\s+/g, ' ');
  const translated = actualText && PUBLIC_FEEDBACK_TEXT[actualText];
  if (translated) return `${translated.split(/[。！？]/)[0]}。`;
  return `${actionName({ index: 0, entry: feedback.entry, label: feedback.actionLabel })} · 已结算`;
}

export const CHANGE_NAMES: Record<string, string> = {
  everflameCharges: '永焰', carriedReservoirCharges: '储能器', endurance: '耐力', life: '生命',
  gold: '金币', coldCondition: '御寒', location: '位置', ritualSigns: '仪式迹象', chandelierClue: '吊灯线索',
};

// Match the actual authored public text, never choose a result message from an action ID.
export const PUBLIC_FEEDBACK_TEXT: Record<string, string> = {
  'You spent one charge thawing the inspected reachable floor. This action does not certify distant ground or prevent later freezing.': '你消耗了 1 点充能，融开了眼前的冰面。',
  'You spent one charge thawing the nearby stable door. Opening it and passing through remain separate actions.': '你消耗了 1 点充能，解冻了附近的马厩门。打开它和穿过门口仍是另外两项行动。',
  'You opened the nearby stable door in this action. Passing through is separate; later changes can still affect the doorway.': '你打开了附近的马厩门。',
  'You closed the nearby stable door in this action. This does not report what happened to people on the other side.': '你关上了附近的马厩门。',
  'You carefully crossed this bridge segment without a balance roll. Time still passes; cold can still affect people outside the light.': '你小心地走过这段桥，没有进行平衡掷骰。时间仍会流逝，光照以外的人仍可能受到寒冷影响。',
  'Your risky bridge attempt resolved. Below are your actual landing place, balance roll and life. This choice costs as much as careful crossing.': '过桥尝试结束了。查看落点、平衡骰和生命状况。',
  'You detached and took the reservoir. Its charge is now carried separately; taking it does not yet refill the Everflame.': '你取下并拿走了储能器。需要时，可以用它为永焰补能。',
  'You transferred one charge from the carried reservoir into the Everflame. The remaining charges below are your records of this transfer.': '你从储能器向永焰转入了 1 点充能。',
  'You left from the outside shore. Your journey is over; this action does not certify what happened to people you cannot see.': '你从外岸离开了，旅程结束。',
  'You carried the frozen resident away from the ritual and interrupted it. Carrying is not thawing or rescuing; check the local record below and observe the resident nearby.': '你把冰封居民搬离仪式，并中断了仪式。接下来查看他的状况，寻找离开的路。',
  'You called an invitation to leave. No acceptance is implied; residents decide for themselves. Observe them again when you meet.': '你喊出了离开的邀请。邀请本身不表示对方答应；实际所听答复与移动另行记录。',
  'The location below is your actual landing, not a promise of reaching the selected destination. A wall collision point means you stopped short; inspect the floor or find a recovery route. A retained balance roll is not a new roll on every movement.': '你停了下来。查看落点和脚下地面，再决定往哪里走。',
  'You offered the carried Everflame and named the threshold. This utterance is not a handover or a promise of acceptance; the resident decides what to do.': '你向对方提议借助永焰离开，并指向门槛。',
  'The conversation could not start. Check that you still carry the Everflame and that the resident is nearby, alive and able to hear you. No handover took place.': '这次谈话未开始。请确认你仍携带永焰，对方就在附近且能听见你说话。本次没有转交永焰。',
  'You waited. Check the control time and your current condition below; this does not report what happened to people elsewhere.': '你等待了片刻。',
  'You observed the nearby resident. Their life, condition and location below record this encounter, not a remote update.': '你仔细查看了附近居民的状况。',
  'You looked for routes from here. Check the current choices below; knowing a passage does not guarantee that it is now passable.': '你查看了附近的通路。',
  'You looked for people in this hall. Check the current choices; finding someone does not establish their private wishes or promise help.': '你在大厅里寻找其他人。',
  'You inspected the reachable floor. The ice observation below describes this encounter; a later change can make a passage unsafe again.': '你仔细检查了眼前的地面。',
  'You inspected the reachable ice wall. Check the choices below; opening it spends one charge, while passing through is a separate action.': '你检查了可达冰墙。查看当前选项；打开它消耗 1 点充能，穿过它是另一项行动。',
  'You spent one charge opening the ice wall. Check the remaining Everflame charge and current light coverage; opening a wall is not a rescue.': '你消耗了 1 点充能打开冰墙。留意永焰余量和光照范围。',
  'You spent one charge opening the ice wall. Check the remaining light before deciding whether to continue or replenish it.': '你消耗了 1 点充能打开冰墙。先查看剩余光照，再决定继续还是补充能量。',
  'You asked your question. Only replies recorded as actually heard below establish that you received an answer; asking alone does not promise one.': '你提出了问题，留意对方的回答。',
  'You spent one charge thawing the person. This is not yet a rescue; invite them and observe them again when you meet on the way out. Protection forecasts use your available knowledge; unknown does not mean safe or unsafe.': '你消耗了 1 点充能解冻对方。可以邀请他离开，再留意沿途的情况。',
  'You spent one charge thawing the person at the ritual and interrupted the chant. They still have to leave by their own actions; meet and observe them again.': '你消耗了 1 点充能解冻仪式处的人。接下来留意对方的行动与去向。',
  'This crossing did not happen. Careful crossing still cannot pass a frozen bridge segment. Inspect reachable ground and your condition; these are possible limits, not a report of a hidden cause.': '暂时无法过桥。检查脚下地面和自身状况，或寻找其他路线。',
  'This attempt could not start. Check reachable ground and your condition. Refusal is not a failed balance roll or a fall.': '暂时无法行动。检查脚下地面和自身状况。',
  'This inspection did not happen. The menu uses a past sighting; it does not prove that the person is still here or reachable. Check your current nearby observation choices or continue along a known route. No new observation was acquired.': '暂时无法查看这位居民。可以观察附近的人，或继续寻找他。',
  'This thaw did not happen. Check your charge and seek a fresh nearby observation before trying again; the person may no longer be reachable or eligible. These are possible limits, not a report of their hidden current state.': '暂时无法解冻。检查永焰余量，并在靠近对方时重新观察。',
  'This direct passage attempt did not happen. Ice, a blocked stair or your current condition can prevent it; inspect the reachable floor and check other choices. This is a list of possible limits, not a report of a hidden cause.': '暂时无法从这里通过。检查脚下地面，或寻找其他通路。',
  'This crossing could not start. Check your current position, condition and reachable crossing choices. Refusal is not a failed balance roll or a collision.': '暂时无法开始穿越。检查脚下地面和自身状况，或换一条路线。',
  'This thaw did not happen. Check your current charge and observe the person again when actually nearby; a past sighting does not establish current eligibility.': '暂时无法解冻。检查永焰余量，并在靠近对方时重新观察。',
  'The carry could not start. This intervention is for the frozen resident in an ongoing ritual. Check your nearby observation and the ritual signs before trying again.': '搬离行动未开始。这项干预用于仍在进行的仪式中的冰封居民。再试之前，请检查附近的观察记录与仪式迹象。',
  'The care could not start. Observe the person nearby again; care requires an incapacitated person who is not frozen. Check your own ability to act too.': '照护行动未开始。请靠近对方重新观察；照护需要对方失去行动能力且没有冰封。也请检查自己是否还能行动。',
};

export function feedbackText(frame: Frame): string | null {
  const attempt = publishedResult(frame)?.movementAttempt;
  if (attempt?.outcome === 'blocked') return '你确实尝试了通行，但没有通过，仍停在出发处。这不是行动拒绝；行动已发布，时间与消耗以本次及随后回执为准。受阻的具体原因尚不清楚。';
  const raw = frame.feedback?.text?.trim();
  if (!raw) return null;
  return PUBLIC_FEEDBACK_TEXT[raw.replace(/\s+/g, ' ')] ?? text(raw);
}

export function emptyDiscoveryNote(frame: Frame): string {
  return frame.feedback?.entry === 'observe_routes_adventurer'
    ? '本次没有新增人物／物件详情记录；通路等其他读回见地图与相关记录。'
    : '本次没有新增人物／物件、仪式或移动观察记录；其他读回见地图与相关记录。';
}

export function journeyGuidance(frame: Frame) {
  const phase = frame.information.ritual.phase;
  const carry = frame.offers.some(o => o.entry === 'carry_from_ritual_adventurer');
  const thaw = frame.offers.some(o => o.entry === 'thaw_ritual_resident');
  if (frame.ending) return { title: '旅程结束', objective: frame.ending.title, note: '回看这一路的见闻。' };
  if (frame.offers.some(o => o.entry === 'leave_palace_adventurer')) return { title: '已抵达离宫处', objective: '选择离宫 · 完成本次旅程', note: '仍可继续行动；选择离宫后会结算这一路的成果。' };
  if (phase === 'completed') return { title: '你曾察觉仪式完成', objective: '帮助居民 · 寻找离开路线 · 抵达外岸', note: '继续照看附近居民，寻找出宫的路。' };
  if (phase === 'disrupted') return { title: '你曾察觉仪式中断', objective: '帮助居民 · 寻找离开路线 · 抵达外岸', note: '接下来照看居民，邀请他们一起离开。' };
  const attempt = carry ? '可以尝试把居民带离仪式圈。' : thaw ? '可以尝试解冻仪式处的居民。' : '沿附近通路前行，寻找打断仪式的机会。';
  return { title: phase === 'critical' ? '你曾察觉仪式接近完成' : phase === 'preparing' ? '你曾察觉仪式准备中' : phase === 'gathering' ? '你曾察觉仪式正在进行' : '还没有听到仪式的动静', objective: '中断仪式 · 帮助居民 · 抵达外岸', note: `${phase === 'critical' ? '时间紧迫，继续观察也会耗去行动时间。' : ''}${attempt}` };
}

export function timingGuidance(frame: Frame) {
  return frame.ending
    ? { title: '旅程已结束', notice: '回看结局与这一路的见闻。', detail: '旅程记录留在这里。' }
    : { title: '寒冷与行动', notice: frame.information.timingNotice, detail: '永焰充能有限；消耗可能缩小保护范围，解冻后仍可能再次冰封。' };
}

export function locationNote(frame: Frame): string {
  if (frame.ending) return '旅程已结束；这里保留的是结束时的地点与已知记录。';
  if (frame.offers.some(o => o.entry === 'leave_palace_adventurer')) return '你已抵达可以离宫的地方。选择「离开宫殿」完成旅程，或继续探索。';
  const here = currentSite(frame);
  if (here.startsWith('ritual_')) {
    const purpose = here === 'ritual_ring' ? '你在仪式圈。' : here === 'ritual_threshold' ? '你在仪式门槛。' : '你在仪式通道区域。';
    const ended = ['completed', 'disrupted'].includes(frame.information.ritual.phase);
    return `${purpose}${ended ? '接下来照看居民，寻找离开的路。' : frame.offers.some(o => o.entry === 'carry_from_ritual_adventurer') ? '可以尝试把居民带向门槛，打断仪式。' : '看看附近的居民与通路。'}`;
  }
  if (isBallroom(frame)) return `你在${siteName(here, frame)}。选择前往的方向，或看看附近有什么。`;
  const destinations = [...new Set(frame.offers.flatMap(o => o.destination ? [siteName(o.destination, frame)] : []))];
  return destinations.length ? `从这里可以尝试前往${destinations.slice(0, 2).join('、')}${destinations.length > 2 ? '等地点' : ''}。` : `你在${siteName(here, frame)}。看看附近有什么。`;
}

export function recoveryOffers(frame: Frame): Offer[] {
  const blocked = publishedResult(frame)?.movementAttempt?.outcome === 'blocked';
  if (frame.feedback?.status !== 'rejected' && !blocked) return [];
  const movement = /^(move_|cross_|bridge_|carry_)/.test(frame.feedback?.entry ?? '');
  const entries = movement ? ['observe_floor_adventurer', 'observe_routes_adventurer', ...(/^carry_/.test(frame.feedback?.entry ?? '') ? ['observe_resident_adventurer'] : [])] : ['observe_resident_adventurer', 'observe_hall_adventurer', 'observe_routes_adventurer'];
  const attempt = publishedResult(frame)?.movementAttempt;
  const direct = attempt && frame.offers.find(o => o.entry === 'move_adventurer' && o.destination === attempt.destination);
  return frame.offers.filter(o => entries.includes(o.entry ?? '') || (blocked && o.entry === 'cross_ice_adventurer'
    && o.destination === attempt?.destination && direct?.passageWarning?.crossingIndexes.includes(o.index)));
}

export function recoveryNote(frame: Frame): string | null {
  if (publishedResult(frame)?.movementAttempt?.outcome === 'blocked') return `尝试已经发生但未通过。可以检查地面、查看其他通路${recoveryOffers(frame).some(row => row.entry === 'cross_ice_adventurer') ? '或选择同路的穿冰选项' : ''}；这些都不保证成功。公开地面条件未变时，人格引导不会重复同一次受阻尝试。`;
  if (frame.feedback?.status !== 'rejected') return null;
  if (frame.feedback.refusal.code === 'C0_BINDING_REJECTED') {
    return '提交的目标或请求绑定未通过校验。请先同步当前行动列表，再选择行动；代行已停止。';
  }
  if (frame.feedback.refusal.code === 'UNPUBLISHED_RESULT') {
    return '这次提交未取得发布结果，原因还不清楚。请同步结果并查看拒绝记录；代行已停止。';
  }
  const choices = recoveryOffers(frame);
  return `世界未接纳这次尝试，具体原因还不清楚。检查自身状况和永焰余量${choices.length ? `，或${[...new Set(choices.map(actionName))].join('、')}` : '，也可以寻找其他通路'}；局面未变时，人格引导会避开同一次失败尝试。`;
}

export function refusalStatus(frame: Frame): string | null {
  if (frame.feedback?.status !== 'rejected') return null;
  return frame.feedback.refusal.code === 'UNPUBLISHED_RESULT'
    ? '发布结果未知 · 请同步当前状态后核对'
    : '行动未开始 · 未执行 · 未消耗局内时间与资源';
}

export function offerGroups(frame: Frame, offers: Offer[] = frame.offers): { id: string; label: string; offers: Offer[] }[] {
  const recovery = new Set(recoveryOffers(frame));
  const ritualOpen = currentSite(frame).startsWith('ritual_') && !['completed', 'disrupted'].includes(frame.information.ritual.phase);
  const definitions = [
    ['recovery', '重新寻找机会'], ['ritual', '应对仪式'], ['people', '居民观察与互动'],
    ['routes', '通行与离开'], ['resources', '永焰与物资'], ['observe', '环境与其他观察'], ['other', '其他尝试'], ['wait', '等待'],
  ];
  const grouped = new Map<string, Offer[]>();
  for (const offer of offers) {
    const entry = offer.entry ?? '';
    const id = recovery.has(offer) ? 'recovery'
      : ritualOpen && ['carry_from_ritual_adventurer', 'thaw_ritual_resident'].includes(entry) ? 'ritual'
      : /^(observe_resident|inspect_patient|thaw_person|thaw_ritual|thaw_queen|care_person|offer_torch|offer_escort|carry_|observe_hall)/.test(entry) ? 'people'
      : offer.destination || entry === 'leave_palace_adventurer' ? 'routes'
      : /^(reload_|detach_|load_|pickup_|take_|thaw_floor|open_wall|open_plain_wall)/.test(entry) ? 'resources'
      : /^(observe_|inspect_|look_)/.test(entry) ? 'observe'
      : entry === 'wait_adventurer' ? 'wait' : 'other';
    grouped.set(id, [...(grouped.get(id) ?? []), offer]);
  }
  return definitions.flatMap(([id, label]) => grouped.has(id) ? [{ id, label, offers: grouped.get(id)! }] : []);
}
