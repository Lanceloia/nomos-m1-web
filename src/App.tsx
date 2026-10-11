import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowRight, Check, ChevronRight, Clock3, Coins, Compass, Eye, Flame, Footprints,
  Flag, Heart, History, LampCeiling, Map, Package, RefreshCw, RotateCcw, Snowflake,
  Play, Sparkles, Square, UserRound, X, Zap,
} from 'lucide-react';
import { IntentPolicyRunner, SessionClient, validPolicySettings } from './client';
import { GeographicMap } from './GeographicMap';
import { EntityIcon } from './EntityIcon';
import { latestObservations } from './presence';
import { EndingNotice, EndingRules, EndingSummary } from './EndingSummary';
import { PlayReport } from './PlayReport';
import { guideLocation } from './guideLocation';
import { historicalTiming, thawAfterObservation } from './actionMemory';
import { currentPersonalityAdvice, guidanceIntent, personalityRecommendation } from './personalityGuidance';
import { latestHistory, newerMovement, nextStep, recentThawDetailNote, selectedSiteOffers, surfaceReadbackChanges, type SurfaceChange } from './spatial';
import type { Change, Discovery, Frame, IntentOffer, IntentPolicy, MovementObservation, Observation, Offer, PersonalityAdvice, PlayReport as Report, PolicyStartSettings, SessionResponse, SurfaceEntity } from './types';
import {
  actionName, CHANGE_NAMES, contextOffers, currentSite, feedbackTitle, feedbackText, isBallroom,
  actionNote, adjacentSites, availableSurface, currentMapEntities, forecastName, historicalTargetWarning, movementDescription, needsConfirmation, observationOffers, publicCost, publicLabel, publishedResult, recordedAt,
  actionValueNote, emptyDiscoveryNote, journeyGuidance, locationNote, offerGroups, recoveryNote, refusalStatus, siteName, tableFeatures, targetNames, text, timingGuidance, type Selection,
  hasPublicVitalLoss, observationDetailNote, observationReadback, publicTowerDialogue, receiptDiscoveries, escortReplyReadback, routeKindName, sessionRouteChanges, type RouteReadbackChange,
} from './tabletop';

const client = new SessionClient(window.sessionStorage);
type Panel = 'map' | 'memory' | 'history' | 'restart' | 'goals' | 'intents' | 'policy' | 'ending' | 'opening' | 'receipt' | null;

export function listenForEscape(target: EventTarget, dismiss: () => void) {
  const key = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    event.preventDefault();
    dismiss();
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}

export function manageSheetFocus(target: EventTarget, sheet: HTMLElement, initiator: HTMLElement | null) {
  const focusable = () => [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex="0"]')]
    .filter(node => node.getClientRects().length > 0);
  focusable()[0]?.focus();
  const key = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== 'Tab') return;
    const nodes = focusable();
    const first = nodes[0], last = nodes.at(-1);
    const active = sheet.ownerDocument.activeElement;
    if (keyboard.shiftKey && (active === first || !sheet.contains(active))) { keyboard.preventDefault(); last?.focus(); }
    else if (!keyboard.shiftKey && (active === last || !sheet.contains(active))) { keyboard.preventDefault(); first?.focus(); }
  };
  target.addEventListener('keydown', key);
  return () => {
    target.removeEventListener('keydown', key);
    if (initiator?.isConnected) initiator.focus();
  };
}

export function cancelActionConfirmation(close: () => void, initiator: HTMLButtonElement | null) {
  close();
  if (initiator?.isConnected && !initiator.disabled) initiator.focus();
}

function OfferIcon({ offer }: { offer: Offer }) {
  if (offer.destination) return <Footprints size={18} />;
  if (/observe|inspect/.test(offer.entry ?? '')) return <Eye size={18} />;
  if (/thaw|reload/.test(offer.entry ?? '')) return <Flame size={18} />;
  if (/wait/.test(offer.entry ?? '')) return <Clock3 size={18} />;
  if (/detach/.test(offer.entry ?? '')) return <Package size={18} />;
  return <UserRound size={18} />;
}

function Changes({ items, frame, complete = false }: { items: Change[]; frame: Frame; complete?: boolean }) {
  return <div className="changes">{items.filter(c => c.field !== 'location' && (complete || CHANGE_NAMES[c.field])).map(c =>
    <div key={c.field} className={`change ${['life', 'endurance'].includes(c.field) ? 'vital-change' : ''}`}>
      <span>{CHANGE_NAMES[c.field] ?? text(c.field)}</span>
      <strong>{text(c.before)}</strong><ArrowRight size={13} /><strong>{text(c.after)}</strong>
    </div>)}{items.filter(c => c.field === 'location').map(c => <div key={c.field} className="change">位置 <strong>{siteName(String(c.after), frame)}</strong></div>)}</div>;
}

export function MemoryDetails({ item, frame }: { item: Observation; frame: Frame }) {
  return <div className="memory-details">
    <strong className="history-time">上次观察（{recordedAt(item.detailRecordedAt ?? item.recordedAt)}）</strong>
    {observationDetailNote(item) && <p>{observationDetailNote(item)}</p>}
    {item.facts.map((fact, i) => <p key={i}>{text(fact.label)}：<strong>{text(fact.value)}</strong></p>)}
    <details className="record-details"><summary>记录来源 · 历史详情</summary>
      <p>记录地点：{item.site ? siteName(item.site, frame) : '未知地点'} · 记录状态：{text(item.state)}</p>
      <small>上次见到 · {recordedAt(item.recordedAt)}</small>
      <small>详细观察：{recordedAt(item.detailRecordedAt)}</small>
    </details>
  </div>;
}

export function HistoricalMemory({ frame, selectedId, onSelect, report }: { frame: Frame; selectedId?: string; onSelect: (id: string) => void; report?: Report }) {
  return <details className="historical-memory" aria-label="历史观察"><summary>历史观察 <small>{frame.observations.length} 条</small></summary>
    <div className="memory-list">{frame.observations.map(item => {
      const movement = newerMovement(frame, item);
      const thaw = thawAfterObservation(frame, report, item.id);
      return <button key={item.id} className={`memory-token ${selectedId === item.id ? 'active' : ''}`} onClick={() => onSelect(item.id)} data-object={item.id} aria-pressed={selectedId === item.id}>
        {item.kind === 'floor' ? <Snowflake size={18} /> : <EntityIcon kind={item.kind} size={18} />}<span><strong>{publicLabel(item.label)}</strong><small>{movement ? `后来见其移向${siteName(movement.end, frame)}` : thaw ? '你已解冻过对方 · 现况待再查看' : `上次所见：${text(item.state)}`}</small><small>{recordedAt(movement?.recordedAt ?? item.recordedAt)}</small><small>详情：{recordedAt(item.detailRecordedAt)}</small></span>
      </button>;
    })}</div>{!frame.observations.length && <p className="empty">还没有仔细观察过附近。</p>}
  </details>;
}

export function ResourceReadbacks({ frame }: { frame: Frame }) {
  return <>
    <div className="stat flame-stat"><Flame size={21} /><span>永焰 · 已知充能<strong data-testid="flame-value">{frame.fields.everflameCharges}<small> 点</small></strong></span><div className="charge-pips" data-testid="charge-pips" role="img" aria-label={`永焰已知充能 ${frame.fields.everflameCharges} 点`}>{Array.from({ length: Math.max(5, frame.fields.everflameCharges) }, (_, i) => <i key={i} data-filled={i < frame.fields.everflameCharges} className={i < frame.fields.everflameCharges ? 'lit' : ''} />)}</div></div>
    <div className="stat"><Package size={19} /><span>储能器 · 已知充能<strong data-testid="reservoir-value">{frame.fields.carriedReservoirCharges ?? '—'}<small>{frame.fields.carriedReservoirCharges == null ? ' 未知' : ' 点'}</small></strong></span></div>
  </>;
}

export function InventoryReadbacks({ frame }: { frame: Frame }) {
  if (frame.fields.gold == null) return null;
  return <details className="player-readings" aria-label="随身财物"><summary><Coins size={15} />随身财物</summary>
    <dl><div><dt>金币</dt><dd data-testid="gold-value">{frame.fields.gold}</dd></div></dl>
  </details>;
}

export function PlayerAvailability({ frame }: { frame: Frame }) {
  const { lifeState, coldState } = frame.fields;
  const canAct = lifeState === 'alive' && (coldState === 'mobile' || coldState === 'immune');
  const label = lifeState === 'dead' ? '已死亡 · 旅程结束' : lifeState === 'incapacitated' ? '无法行动，需照护'
    : coldState === 'frozen' ? '冰封，无法行动' : canAct ? '可行动' : '行动状态未知';
  const protection = frame.fields.protection.find(row => row.siteId === currentSite(frame));
  return <div className="cold-status"><Snowflake size={18} /><span>{text(protection?.now)}<small>{label}
    {canAct && <> · 移动 {frame.fields.movementSpeed} / {frame.fields.maxMovementSpeed ?? '？'}</>}
  </small></span></div>;
}

export function PlayerReadings({ frame }: { frame: Frame }) {
  if (!frame.fields.details.length) return null;
  return <details className="player-readings" aria-label="本人详细记录"><summary>详细记录 · {frame.fields.details.length}</summary>
    <dl>{frame.fields.details.map((row, index) => <div key={index}><dt>{publicLabel(row.label)}</dt><dd>{text(row.value)}</dd></div>)}</dl>
  </details>;
}

export function CurrentEntityDetails({ item, frame }: { item: SurfaceEntity; frame: Frame }) {
  const history = latestHistory(frame, item.id);
  return <section className="current-entity-details" aria-label="当前实体读回">
    <p>{item.site === currentSite(frame) ? '当前可见' : '相邻可见'} · {siteName(item.site, frame)}</p>
    <p>{item.kind === 'person' ? '人物' : item.kind === 'elemental' ? '元素' : '物件'} · {history?.detailRecordedAt ? '详细情况见下方的上次观察' : '靠近后仔细观察'}</p>
  </section>;
}

export function SurfaceHistory({ frame, id, submitted, report }: { frame: Frame; id: string; submitted?: Offer; report?: Report }) {
  const item = latestHistory(frame, id);
  const thaw = thawAfterObservation(frame, report, id);
  if (!item) return <p className="surface-history-empty">{thaw && `你已解冻过对方（该次行动结束于时刻 ${thaw.timeAfter}）。`}还没有仔细观察过这个目标。</p>;
  const note = thaw ? `你已解冻过对方（该次行动结束于时刻 ${thaw.timeAfter}）。当前御寒状况可以再查看；较早的观察保留在下方。` : recentThawDetailNote(frame, item, submitted);
  const movement = newerMovement(frame, item);
  const details = item.detailRecordedAt || item.evidence === 'checked_target' ? <MemoryDetails item={item} frame={frame} />
    : <p>只记下了它的存在，还没有取得详细观察。</p>;
  return <section className="surface-history" data-testid="surface-history" data-history-target={id} aria-label="当前目标的历史详情">
    {note && <p className="stale-thaw-note">{note}</p>}
    {movement && <div><strong>后来看见的移动</strong><MovementDetails item={movement} frame={frame} /></div>}
    {movement || note ? <details><summary>较早的详细观察</summary>{details}</details> : details}
  </section>;
}

export function SurfaceReadbackSummary({ changes }: { changes: SurfaceChange[] }) {
  if (!changes.length) return null;
  return <section className="surface-readback-summary" aria-label="可见名单变化"><strong>视野记录变化</strong><ul>{changes.map(change => <li key={`${change.kind}:${change.id}`}>
    {change.kind === 'appeared' ? `目前在此见到${change.label}` : `当前地点不再看见${change.label}；${change.hasMovement ? '有新的移动观察，见移动记录' : '去向未观察到'}`}
  </li>)}</ul></section>;
}

export function NextStepGuidance({ frame, blocked, onAct, compact = false }: { frame: Frame; blocked: boolean; onAct: (offer: Offer, initiator: HTMLButtonElement) => void; compact?: boolean }) {
  const guidance = nextStep(frame);
  return <section className="next-step-guidance" data-testid="next-step-guidance" aria-label="当前目标与下一步">
    <div data-testid="next-step"><strong>{guidance.title}</strong><p>{guidance.next}</p>{!compact && <small>{guidance.detail}</small>}</div>
    {!compact && guidance.offers.slice(0, 2).map(offer => <button key={offer.index} data-guidance-offer-index={offer.index} disabled={blocked} onClick={event => onAct(offer, event.currentTarget)}>
      <OfferIcon offer={offer} /><span>{actionName(offer)}{offer.destination ? ` → ${siteName(offer.destination, frame)}` : ''}{publicCost(offer) ? ` · ${publicCost(offer)}` : ''}</span><ChevronRight size={16} />
    </button>)}
    {!compact && guidance.path.length > 1 && <details><summary>已知路线方向</summary><p>{guidance.path.map(id => siteName(id, frame)).join(' → ')}</p></details>}
    {!compact && frame.briefing && <details className="journey-briefing"><summary>此行缘由</summary><p>{frame.briefing}</p></details>}
  </section>;
}

export function EscortResponse({ frame, invitation = false }: { frame: Frame; invitation?: boolean }) {
  const result = publishedResult(frame);
  if (invitation && frame.feedback?.status !== 'published') return null;
  const movements = invitation
    ? [...(result?.discoveries ?? []), ...(result?.laterDiscoveries ?? [])].flatMap(row => row.kind === 'movement' ? [row.movement] : [])
    : frame.information.movements.slice(-3);
  const replies = invitation
    ? [...(result?.discoveries ?? []), ...(result?.laterDiscoveries ?? [])].flatMap(row => row.kind === 'escort_reply' ? [row.reply] : [])
    : (frame.information.escortReplies ?? []).slice(-3);
  return <div className="escort-status" data-testid="escort-response"><strong>{invitation ? '护送邀请 · 本次所听与所见' : '附近人物 · 所听答复与移动记录'}</strong>
    <p>{replies.length ? invitation ? '本次实际听到的答复：' : '此前实际听到的答复：'
      : invitation ? '本次尚未实际听到新的答复。' : '尚无实际所听答复记录。'}</p>
    {!!replies.length && <ul>{replies.map(row => <li key={row.id}>{escortReplyReadback(row, frame)}（在{siteName(row.site, frame)}，{recordedAt(row.recordedAt)}）</li>)}</ul>}
    {!!replies.length && <small>答复只记录当时的准备状态；不保证跟随、抵达或安全。</small>}
    <p>{invitation ? movements.length ? '你喊出邀请，随后亲眼看见：' : '你喊出邀请，暂未看见新的动身迹象。'
      : '这里保留你曾亲眼看见的移动。'}</p>
    {!!movements.length && <ul>{movements.map(row => <li key={row.id}>{publicLabel(row.label)}：{siteName(row.start, frame)} → {siteName(row.end, frame)}（{recordedAt(row.recordedAt)}）</li>)}</ul>}
    <small>{frame.ending ? '旅程已结束，以下去向以最后所见为准。' : '可以继续行动，留意他们是否动身；想了解眼前居民，可以选择仔细观察。'}{invitation && !replies.length && '是否愿意同行，尚未听到答复。'}移动本身不证明答应同行或脱离危险。</small></div>;
}

export function AdventureStatus({ frame }: { frame: Frame }) {
  const guidance = journeyGuidance(frame);
  const phase = frame.information.ritual;
  const result = publishedResult(frame);
  const heardThisAction = !!phase.recordedAt && [...result?.discoveries ?? [], ...result?.laterDiscoveries ?? []]
    .some(row => row.kind === 'ritual' && row.phase === phase.phase);
  return <section className={`adventure-status ritual-${phase.phase}`} aria-label="冒险目标与仪式见闻">
    <strong>{guidance.objective}</strong>
    <p>{phase.phase === 'unknown' ? '每次行动都消耗时间；仪式不会等待你。先寻找仪式的线索。' : `${text(phase.label)} · ${guidance.note}`}</p>
    {phase.recordedAt && <small>{heardThisAction ? `本次行动中察觉 · 时刻 ${phase.recordedAt.time}；行动结束 ${frame.time}` : `上次察觉：时刻 ${phase.recordedAt.time}`}</small>}
  </section>;
}

export function PublicFirstStep({ offer, frame, reason, compact = false }: { offer: Offer; frame: Frame; reason: string; compact?: boolean }) {
  return <section className="next-step-guidance" data-testid="personality-guidance"><strong>当前建议 · {actionName(offer)}{offer.destination ? ` → ${siteName(offer.destination, frame)}` : ''}</strong>
    {!!offer.targetIds?.length && <p>目标：{targetNames(offer, frame).join('、')}</p>}{compact ? <details><summary>判断依据</summary><p>{reason}</p></details> : <p>{reason}</p>}
    {publicCost(offer) && <small>{publicCost(offer)}</small>}</section>;
}

export function LocalCommands({ frame, blocked, onAct, recommendedIndex }: { frame: Frame; blocked: boolean; recommendedIndex?: number; onAct: (offer: Offer, initiator: HTMLButtonElement) => void }) {
  if (frame.ending) return null;
  const entries = ['observe_routes_adventurer', 'observe_floor_adventurer', 'offer_escort_adventurer', 'leave_palace_adventurer'];
  return <div className="local-commands" aria-label="此处常用行动">{entries.flatMap(entry => {
    const matches = frame.offers.filter(offer => offer.entry === entry);
    return matches.length === 1 ? [matches[0]] : [];
  }).map(offer => <button key={offer.index} disabled={blocked} className={offer.index === recommendedIndex ? 'recommended-location' : undefined} data-local-offer-index={offer.index} onClick={event => onAct(offer, event.currentTarget)}><OfferIcon offer={offer} /><span>{actionName(offer)}</span></button>)}</div>;
}

export function StoppedPolicyNotice({ policy, onDetails, currentRevision }: { policy: IntentPolicy; currentRevision: number; onDetails: () => void }) {
  const last = policy.steps.at(-1);
  const handedOver = last && currentRevision > last.afterRevision;
  return <section className="stopped-policy-notice" data-policy-status="stopped" aria-label="最近代行停点"><p title={handedOver ? '上段代行记录保留在详情中' : policy.reason ?? ''}>{handedOver ? '你已接手 · 按当前建议或自行选择' : `上段停点：${policy.reason ?? '查看行动记录'}`}</p><button onClick={onDetails} aria-label="行动详情" title={policy.label ?? '代行记录'}><History size={15} /><span>{policy.executed}次 · 代行详情</span></button></section>;
}

export function CheckConclusion({ frame }: { frame: Frame }) {
  const entry = frame.feedback?.status === 'published' ? frame.feedback.entry : null;
  if (!['observe_climbs_adventurer', 'observe_routes_adventurer'].includes(entry ?? '')) return null;
  const routes = (frame.scene?.routes ?? []).filter(row => row.start === currentSite(frame) && (entry !== 'observe_climbs_adventurer' || row.kind === 'climb'));
  return <p className="check-conclusion">{routes.length
    ? `检查后的已知${entry === 'observe_climbs_adventurer' ? '攀爬' : ''}路线：${[...new Set(routes.map(row => siteName(row.end, frame)))].join('、')}。`
    : `检查后还没有取得从此处出发的${entry === 'observe_climbs_adventurer' ? '攀爬' : '通路'}记录。`}</p>;
}

function Discoveries({ items, frame }: { items: Discovery[]; frame: Frame }) {
  return <div className="discoveries">{items.map((item, i) => item.kind === 'ritual'
    ? <div className={`discovery ritual-${item.phase}`} key={`ritual:${i}`}><strong>阶段记录</strong><p>{text(item.label)}</p></div>
    : item.kind === 'movement' ? <article className="discovery" key={`${item.movement.id}:${i}`} data-movement-discovery={item.movement.id}><strong>移动观察 · {text(item.movement.label)}</strong><MovementDetails item={item.movement} frame={frame} /></article>
    : item.kind === 'escort_reply' ? <article className="discovery" key={`${item.reply.id}:${i}`} data-reply-discovery={item.reply.id}><strong>实际所听答复 · {publicLabel(item.reply.label)}</strong><p>{escortReplyReadback(item.reply, frame)}（在{siteName(item.reply.site, frame)}，{recordedAt(item.reply.recordedAt)}）</p><small>不保证跟随、抵达或安全。</small></article>
    : <article className="discovery" key={`${item.observation.id}:${i}`} data-discovery={item.observation.id}>
      <strong>{item.change === 'new' ? '新取得' : '更新记录'} · {text(item.observation.label)}</strong>
      <MemoryDetails item={item.observation} frame={frame} />
    </article>)}</div>;
}

function MovementDetails({ item, frame }: { item: MovementObservation; frame: Frame }) {
  return <div className="movement-details"><p>{siteName(item.start, frame)}<ArrowRight size={13} />{siteName(item.end, frame)}</p>
    <small>你曾看见这次移动 · {recordedAt(item.recordedAt)}</small>
  </div>;
}

export function CurrentSurface({ frame, selectedId, onSelect, recommendedId, report }: { frame: Frame; selectedId?: string; onSelect: (id: string) => void; recommendedId?: string; report?: Report }) {
  const entities = [...availableSurface(frame)].sort((a, b) => Number(b.kind === 'person') - Number(a.kind === 'person'));
  return <section className="visible-surface" aria-label="当前可见表面" data-testid="visible-surface">
    <header><strong>眼前人物与物件</strong><span>就在附近</span></header>
    <p>{text(frame.information.visibilityNotice)}</p>
    <div className="surface-list">{entities.map(item => {
      const history = latestHistory(frame, item.id);
      const detail = history?.detailRecordedAt;
      const movement = history && newerMovement(frame, history);
      const thaw = thawAfterObservation(frame, report, item.id);
      const known = movement ? `后来看见移动 · 时刻 ${movement.recordedAt.time}`
        : thaw ? '你已解冻过对方 · 现况待再查看' : detail && history ? `上次观察：${text(history.state)} · 时刻 ${detail.time}` : '详细状态未知';
      return <button className={`surface-token piece-${item.kind} ${selectedId === item.id ? 'active' : ''} ${recommendedId === item.id ? 'recommended-location' : ''}`} key={item.id} data-surface={item.id} aria-pressed={selectedId === item.id} title={`${publicLabel(item.label)} · ${siteName(item.site, frame)} · ${known}${['person', 'elemental'].includes(item.kind) ? ' · 威胁未知' : ''}`} onClick={() => onSelect(item.id)}>
      <span className="surface-piece"><EntityIcon kind={item.kind} size={28} /></span>
      <strong>{publicLabel(item.label)}</strong>
      {(detail || movement || thaw) && <small className="surface-known-detail">{known}</small>}
    </button>; })}</div>
  </section>;
}

export function sceneBackdrop(frame: Frame): string | null {
  const here = currentSite(frame);
  if (here.startsWith('ballroom_')) return '/assets/scene-ballroom-v3.png';
  if (here.startsWith('bridge_') || here === 'palace_exit') return '/assets/scene-bridge-v3.png';
  if (here.startsWith('halls_')) return '/assets/scene-corridor-v3.png';
  if (here.startsWith('ritual_')) return '/assets/scene-ritual-v3.png';
  if (here.startsWith('treasure_')) return '/assets/scene-treasure-v3.png';
  if (here.startsWith('icebar_')) return '/assets/scene-icebar-v3.png';
  if (here.startsWith('lower_') || here === 'stables_approach') return '/assets/scene-lower-v3.png';
  if (here.startsWith('stables_')) return '/assets/scene-stables-v3.png';
  if (here.startsWith('prison_') || here === 'captive_cell') return '/assets/scene-prison-v3.png';
  if (here === 'tower_base' || here === 'alpha_box_interior') return '/assets/scene-tower-base-v3.png';
  if (here === 'tower_top') return '/assets/scene-tower-top-v3.png';
  return null;
}

export function PlayerIdentity() {
  return <div className="player-identity" data-testid="scene-player" aria-label="你 · 携焰的旅人">
    <span className="identity-icon" aria-hidden="true"><UserRound size={24} /></span>
    <div><strong>你</strong><span>携焰的旅人</span></div>
  </div>;
}

export function SceneStage({ frame, selectedId, onSelect, recommendedId, report }: { frame: Frame; selectedId?: string; onSelect: (id: string) => void; recommendedId?: string; report?: Report }) {
  return <div className="scene-stage" data-testid="scene-stage">
    <CurrentSurface frame={frame} selectedId={selectedId} onSelect={onSelect} recommendedId={recommendedId} report={report} />
  </div>;
}

export function requiresActionConfirmation(_offer: Offer, _recommendedIndex?: number) {
  return true;
}

export function uniqueSelectionOffer(frame: Frame, selection: Selection): Offer | undefined {
  if (selection.kind !== 'surface' && selection.kind !== 'object' && selection.kind !== 'site') return;
  if (selection.kind === 'site' && selection.id === currentSite(frame)) return;
  const offers = selection.kind === 'site' ? selectedSiteOffers(frame, selection.id).offers : contextOffers(frame, selection);
  if (offers.length !== 1) return;
  const offer = offers[0];
  return selection.kind === 'site' || offer.targetIds?.length === 1 && offer.targetIds[0] === selection.id ? offer : undefined;
}

export function SiteActionGap({ frame, id, onAct }: { frame: Frame; id: string; onAct: (offer: Offer, initiator: HTMLButtonElement) => void }) {
  const check = frame.offers.find(offer => offer.entry === 'observe_routes_adventurer');
  return <div className="surface-action-gap"><p>{id === currentSite(frame) ? '当前没有与这个地点对应的行动。' : `地图记下了${siteName(id, frame)}，但当前还没有可选择的前往行动。`}</p>
    {check ? <><p>可以先在{siteName(currentSite(frame), frame)}检查通路，再查看新的走法。</p><button onClick={event => onAct(check, event.currentTarget)}><Eye size={16} />{actionName(check)}</button></>
      : <p>查看此处的其他行动，或从已知通路选择下一步。</p>}</div>;
}

export function QuickActions({ frame, blocked, onAct }: { frame: Frame; blocked: boolean; onAct: (offer: Offer, initiator: HTMLButtonElement) => void }) {
  if (frame.ending) return null;
  const offers = [...nextStep(frame).offers.slice(0, 2), ...observationOffers(frame)]
    .filter((offer, i, all) => all.findIndex(row => row.index === offer.index) === i).slice(0, 4);
  return <div className="quick-actions" aria-label="就近行动">{offers.map(offer => <button key={offer.index} data-offer={offer.entry} data-offer-index={offer.index} disabled={blocked} onClick={event => onAct(offer, event.currentTarget)}>
    <OfferIcon offer={offer} /><span>{actionName(offer)}<small>{[offer.destination ? siteName(offer.destination, frame) : null, publicCost(offer)].filter(Boolean).join(' · ')}</small></span>
    {needsConfirmation(offer) ? <ChevronRight size={16} /> : <ArrowRight size={16} />}
  </button>)}</div>;
}

export function SurfaceActionGap({ frame, id, onBrowse }: { frame: Frame; id: string; onBrowse: () => void }) {
  if (contextOffers(frame, { kind: 'surface', id }).length) return null;
  const hasObservations = observationOffers(frame).length > 0;
  return <div className="surface-action-gap"><p>暂时没有与这个目标互动的行动。</p>
    {hasObservations ? <><p>此处可尝试：{[...new Set(observationOffers(frame).map(actionName))].join('、')}。观察可能带来新的互动线索。</p><button onClick={onBrowse}><Eye size={16} />查看观察行动<ChevronRight size={14} /></button></> : <p>也可以继续探索其他地方。</p>}
  </div>;
}

export function MovementReadbacks({ frame }: { frame: Frame }) {
  return <section className="movement-readbacks" aria-label="已取得的移动观察"><h2>移动观察</h2>
    {frame.information.movements.length ? frame.information.movements.map(item => <article key={item.id} className="movement-record" data-movement={item.id}>
      <strong>{text(item.label)}</strong><MovementDetails item={item} frame={frame} />
    </article>) : <p>还没有看见人物移动。</p>}
  </section>;
}

export function AdjacentRouteList({ frame, selectedId, onSelect, recommendedSite }: { frame: Frame; selectedId?: string; onSelect: (id: string) => void; recommendedSite?: string }) {
  const sites = adjacentSites(frame);
  return <section className="adjacent-routes" aria-label="当前相邻路线与目的地">
    <header><h2>附近通路与目的地</h2></header>
    <div className="adjacent-route-list">{sites.map(site => <button key={site.id} className={`adjacent-route ${selectedId === site.id ? 'selected' : ''} ${recommendedSite === site.id ? 'recommended-location' : ''}`} data-site={site.id} aria-pressed={selectedId === site.id} onClick={() => onSelect(site.id)}>
      <Compass size={18} /><span><strong>{site.label}</strong><small>{site.kinds.length ? site.kinds.map(routeKindName).join('、') : '公开目的地尝试'}</small>
        <small>{frame.ending ? '结束时的已知记录' : site.offers.length ? [...new Set(site.offers.map(actionName))].join('、') : '仅有路线记录，暂无当前通行尝试'}</small></span><ChevronRight size={16} />
    </button>)}</div>
    {!sites.length && <p className="empty">还不清楚这里通向哪里，可以先寻找附近通路。</p>}
  </section>;
}

export function RouteReadbackSummary({ changes }: { changes: RouteReadbackChange[] }) {
  if (!changes.length) return null;
  return <section className="route-readback-summary" aria-label="公开路线记录变化"><strong>前后公开读回 · 路线记录变化</strong><ul>{changes.map((change, i) => <li key={i}>
    <span>{change.kind === 'added' ? '新增记录' : change.kind === 'changed' ? '类型记录变化' : '未再列出'}：{change.label}</span>
    <small>{change.kind === 'changed' ? `${change.beforeKinds.map(routeKindName).join('、')} → ${change.afterKinds.map(routeKindName).join('、')}` : (change.kind === 'added' ? change.afterKinds : change.beforeKinds).map(routeKindName).join('、')}</small>
  </li>)}</ul><p>旅途中记下的路线变化。</p></section>;
}

export function TargetHistoryWarning({ offer, frame }: { offer: Offer; frame: Frame }) {
  const warning = historicalTargetWarning(offer, frame);
  return warning ? <p className="target-history-warning" data-testid="target-history-warning">{warning}</p> : null;
}

export function TowerConversation({ frame, accepting = false }: { frame: Frame; accepting?: boolean }) {
  const dialogue = publicTowerDialogue(frame);
  if (!dialogue.length) return accepting ? <p>还没有听清这项提议的条件。</p> : null;
  return <section className="tower-conversation" aria-label="公开塔底对话"><strong>塔底对话 · 已听到的记录</strong>
    {dialogue.map(item => <article key={item.id}><strong>{text(item.label)}</strong><MemoryDetails item={item} frame={frame} /></article>)}
    <small>上次听到的提议；还有疑问时可以继续询问。</small>
  </section>;
}

export function DiscoverySummary({ items, frame }: { items: Discovery[]; frame: Frame }) {
  return <ul className="discovery-summary">{items.map((item, i) => <li key={i}>{item.kind === 'ritual' ? text(item.label)
    : item.kind === 'movement' ? `${text(item.movement.label)}：${siteName(item.movement.start, frame)} → ${siteName(item.movement.end, frame)}`
    : item.kind === 'escort_reply' ? `实际听到${escortReplyReadback(item.reply, frame)}；不保证跟随、抵达或安全。`
    : `${item.change === 'new' ? '新取得' : '更新记录'} · ${observationReadback(item.observation, frame)}`}</li>)}</ul>;
}

export function actionTimingNote(offer: Offer, report?: Report): string {
  return offer.entry === 'leave_palace_adventurer' ? '确认离宫后，本局结束。' : historicalTiming(offer, report)
    ?? '行动会推进世界。具体耗时尚无预告；完成后可在行动记录中比较实际耗时。';
}

export function LatestReceipt({ frame, error, onRead }: { frame: Frame; error: string | null; onRead: () => void }) {
  return <div className="latest-receipt" data-testid="latest-receipt">
    <div className="receipt-brief" aria-live="polite">{error ? '结果尚未同步' : <ReceiptSummary frame={frame} />}</div>
    <button className="receipt-open" onClick={onRead}><History size={17} />查看本次结果<ChevronRight size={16} /></button>
  </div>;
}

export function ActionChoices({ frame, offers, blocked, selectedIndex, onAct, onPreview, recommendedIndex }: { frame: Frame; offers: Offer[]; blocked: boolean; selectedIndex: number | null; onAct: (offer: Offer, initiator: HTMLButtonElement) => void; onPreview: (index: number) => void; recommendedIndex?: number }) {
  if (frame.ending) return <p className="empty">本局已结束，没有可执行的世界行动。</p>;
  const groups = offerGroups(frame, offers).map(group => ({...group,
    offers: [...group.offers].sort((a, b) => Number(b.index === recommendedIndex) - Number(a.index === recommendedIndex)),
  })).sort((a, b) => Number(b.offers.some(row => row.index === recommendedIndex)) - Number(a.offers.some(row => row.index === recommendedIndex)));
  return <div className="offer-list" aria-label="可选行动">{groups.map(group => <section className="action-group" key={group.id} data-action-group={group.id}>
    <h4>{group.label}<small>{group.offers.length}</small></h4>{group.offers.map(offer => <button key={offer.index} className={`offer ${selectedIndex === offer.index ? 'chosen' : ''} ${recommendedIndex === offer.index ? 'recommended' : ''}`} data-recommended={recommendedIndex === offer.index || undefined} data-offer={offer.entry} data-offer-index={offer.index} disabled={blocked} onMouseEnter={() => onPreview(offer.index)} onFocus={() => onPreview(offer.index)} onClick={event => onAct(offer, event.currentTarget)}>
      <span className="offer-icon">{recommendedIndex === offer.index ? <Sparkles size={18} /> : <OfferIcon offer={offer} />}</span><span><strong>{actionName(offer)}{recommendedIndex === offer.index && <b className="recommend-badge">推荐</b>}</strong><small>{[offer.destination ? siteName(offer.destination, frame) : null, targetNames(offer, frame).join('、'), publicCost(offer)].filter(Boolean).join(' · ') || (requiresActionConfirmation(offer, recommendedIndex) ? '查看行动目的与预告' : '直接执行 · 推进世界')}</small>{movementDescription(offer) && <small className="movement-purpose">{movementDescription(offer)}</small>}
      {offer.entry === 'move_adventurer' && <small className="target-history-warning">{offer.passageWarning?.lastAttemptBlocked
        ? '上次同路受阻 · 再试仍会消耗行动'
        : offer.passageWarning?.floorState === 'frozen' ? '上次检查有冰 · 直接通行可能受阻'
        : offer.passageWarning?.floorState === 'clear' ? '上次检查无冰 · 不保证通行' : '地面情况未知 · 通行结果不确定'}</small>}
      {historicalTargetWarning(offer, frame) && <small className="target-history-warning">上次观察记录为死亡，现况未知；确认前请核对历史记录。</small>}</span>{requiresActionConfirmation(offer, recommendedIndex) ? <ChevronRight size={15} /> : <ArrowRight size={15} />}
    </button>)}</section>)}</div>;
}

export function ActionRisk({ frame }: { frame: Frame }) {
  const timing = timingGuidance(frame);
  return <div className="risk-status"><strong>{timing.title}</strong><details className="record-details"><summary>{frame.ending ? '结束后的只读记录' : '每次观察与行动都会推进世界'}</summary><p>{timing.notice}</p><small>{timing.detail}</small></details></div>;
}

export function ActionPreview({ frame, offer, heading, feature }: { frame: Frame; offer?: Offer; heading: string; feature?: { label: string; note: string } }) {
  return <section className="hover-preview" aria-label={frame.ending ? '结束后的记录' : '行动预告'}>{frame.ending
    ? <><strong>旅程已结束</strong><p>{timingGuidance(frame).notice}</p></>
    : offer ? <><strong>{actionName(offer)}</strong><p>{actionNote(offer, frame)}</p>{offer.forecasts?.map((forecast, i) => <p key={i}>{forecastName(forecast.label)}：{text(forecast.value)}</p>)}{actionValueNote(offer) && <small>{actionValueNote(offer)}</small>}</>
    : <><strong>{feature?.label ?? heading}</strong><p>{feature?.note ?? '当前行动会推进寒冷与仪式。消耗永焰可能改变保护范围。'}</p></>}</section>;
}

export function JourneyObjective({ frame }: { frame: Frame }) {
  const guidance = journeyGuidance(frame);
  return <div className="quest"><span className="quest-mark"><Flame size={19} /></span><div><strong>{guidance.title}</strong><p>{guidance.objective}</p><small>{guidance.note}</small></div></div>;
}

export function AvailableResourceActions({ frame, onAct }: { frame: Frame; onAct?: (offer: Offer, initiator: HTMLButtonElement) => void }) {
  if (frame.ending || frame.feedback?.status !== 'published' || frame.feedback.entry !== 'observe_chandelier_adventurer') return null;
  const available = frame.offers.filter(offer => offer.entry === 'detach_reservoir_adventurer');
  if (!available.length) return null;
  return <section className="readback-summary" aria-label="当前可取用的资源"><strong>吊灯观察后，现在可选择</strong>{available.map(offer => onAct
    ? <button key={offer.index} onClick={event => onAct(offer, event.currentTarget)}><Flame size={16} />{actionName(offer)}<ChevronRight size={16} /></button>
    : <p key={offer.index}>{actionName(offer)}</p>)}<small>打开行动详情，确认后才执行。</small></section>;
}

export function WallCheckConclusion({ frame, onAct }: { frame: Frame; onAct?: (offer: Offer, initiator: HTMLButtonElement) => void }) {
  if (frame.feedback?.status !== 'published' || frame.feedback.entry !== 'observe_wall_adventurer') return null;
  const result = publishedResult(frame);
  const ids = new Set([...result?.discoveries ?? [], ...result?.laterDiscoveries ?? []].flatMap(item =>
    item.kind === 'observation' && item.observation.kind === 'wall' && item.observation.evidence === 'checked_target'
      ? [item.observation.id] : []));
  const offers = frame.offers.filter(offer => ['open_wall_adventurer', 'open_plain_wall_adventurer', 'move_wall_adventurer'].includes(offer.entry ?? '')
    && offer.targetIds?.some(id => ids.has(id)));
  if (!ids.size) return null;
  return <section className="readback-summary" aria-label="冰墙检查后可选行动"><strong>已经记下这面冰墙</strong>
    <p>{offers.length ? '现在可以选择：' : '当前没有与这面冰墙对应的开墙或穿行选项。'}</p>
    {offers.map(offer => onAct ? <button key={offer.index} onClick={event => onAct(offer, event.currentTarget)}>{actionName(offer)}<ChevronRight size={16} /></button>
      : <p key={offer.index}>{actionName(offer)}</p>)}
  </section>;
}

export function ActionOutcome({ frame, busy, error, onRefresh, onAct, routeChanges = [], surfaceChanges = [] }: { frame: Frame; busy: boolean; error: string | null; onRefresh: () => void; onAct?: (offer: Offer, initiator: HTMLButtonElement) => void; routeChanges?: RouteReadbackChange[]; surfaceChanges?: SurfaceChange[] }) {
  const result = publishedResult(frame);
  const authoredText = feedbackText(frame);
  const recovery = recoveryNote(frame);
  const rejected = frame.feedback?.status === 'rejected';
  const attemptedBlocked = result?.movementAttempt?.outcome === 'blocked';
  const invitation = frame.feedback?.entry === 'offer_escort_adventurer';
  const immediateDiscoveries = result?.discoveries.filter(item => !invitation || item.kind !== 'movement') ?? [];
  const subsequentDiscoveries = result?.laterDiscoveries.filter(item => !invitation || item.kind !== 'movement') ?? [];
  return <footer className={`outcome ${frame.feedback?.status === 'rejected' ? 'rejected' : ''}`} aria-live="polite" aria-atomic="true">
      <div className="outcome-symbol">{busy ? <RefreshCw size={21} className="spinning" /> : frame.feedback?.status === 'rejected' || error ? <X size={21} /> : frame.feedback ? <Check size={21} /> : <Flame size={21} />}</div>
      <div className="outcome-content"><span className="eyebrow">{busy ? '正在结算' : error ? '连接异常' : frame.ending ? '结束时的回执' : frame.feedback ? '刚刚发生' : '旅程开始'}</span><h2>{busy ? '世界正在回应你的行动…' : error ? '结果尚未同步，暂不继续行动' : frame.ending ? frame.ending.title : feedbackTitle(frame)}</h2>
        {error && <p role="alert">{error} <button onClick={onRefresh} disabled={busy}>同步结果</button></p>}
        {!busy && !error && <>
          {rejected && <p className="rejection-status">{refusalStatus(frame)}</p>}
          {frame.feedback?.status === 'rejected' && <small className="refusal-code">错误码: <code>{frame.feedback.refusal.code}</code></small>}
          {authoredText && (rejected || attemptedBlocked ? <p className="rejection-explanation" data-testid="authored-feedback">{authoredText}</p> : <details className="authored-feedback" data-testid="authored-feedback"><summary>{authoredText.split('。')[0]}{authoredText.includes('。') ? '。' : ''}</summary><p>{authoredText}</p></details>)}
          <TowerConversation frame={frame} accepting={['ask_alpha_adventurer', 'accept_alpha_adventurer'].includes(frame.feedback?.entry ?? '')} />
          <RouteReadbackSummary changes={routeChanges} />
          <CheckConclusion frame={frame} />
          <SurfaceReadbackSummary changes={surfaceChanges} />
          {(rejected || attemptedBlocked) && <p className="recovery-note">{recovery}</p>}
          {frame.feedback?.status === 'published' && frame.feedback.entry === 'offer_escort_adventurer' && <EscortResponse frame={frame} invitation />}
          <AvailableResourceActions frame={frame} onAct={onAct} />
          <WallCheckConclusion frame={frame} onAct={onAct} />
          {!frame.feedback && <p>{journeyGuidance(frame).note}</p>}
          {result && <>
            {result.elapsed && <p>本次提交至返回共推进 {result.elapsed.action + result.elapsed.subsequent} 局内时间单位（发布返回点 {result.elapsed.action}；随后世界推进 {result.elapsed.subsequent}）。</p>}
            {(result.changes.length > 0 || immediateDiscoveries.length > 0) && <section className="readback-summary" aria-label="本次读回摘要"><span className="eyebrow">本次变化</span><Changes items={result.changes} frame={frame} /><DiscoverySummary items={immediateDiscoveries} frame={frame} /></section>}
            {(result.laterChanges.length > 0 || subsequentDiscoveries.length > 0) && <section className="readback-summary" aria-label="随后读回摘要"><span className="eyebrow">随后变化</span><Changes items={result.laterChanges} frame={frame} /><DiscoverySummary items={subsequentDiscoveries} frame={frame} /></section>}
            {!result.discoveries.length && !result.laterDiscoveries.length && <p>{emptyDiscoveryNote(frame)}</p>}
            <details className="outcome-evidence"><summary>完整证据与掷骰记录</summary>
              {result.target && <p>尝试目的地：{siteName(result.target, frame)}</p>}{result.landing && <p>实际落点：{siteName(result.landing, frame)}</p>}{result.collision != null && <p>碰撞记录：{text(result.collision)}</p>}
              <span className="eyebrow">本次变化</span><Changes items={result.changes} frame={frame} complete /><Discoveries items={result.discoveries} frame={frame} />
              {result.rolls?.map((roll, i) => <p key={i}><Zap size={14} />本次{roll.kind === 'balance' ? '平衡骰' : roll.kind === 'cold' ? '严寒骰' : text(roll.kind)}<strong>{roll.value}</strong></p>)}
              <div className="subsequent"><span className="eyebrow">随后变化</span><Changes items={result.laterChanges} frame={frame} complete /><Discoveries items={result.laterDiscoveries} frame={frame} />
                {result.laterRolls?.map((roll, i) => <p key={i}><Zap size={14} />随后{roll.kind === 'balance' ? '平衡骰' : roll.kind === 'cold' ? '严寒骰' : text(roll.kind)}<strong>{roll.value}</strong></p>)}
              </div>
            </details>
          </>}
        </>}
      </div>
    </footer>;
}

export function ReceiptSummary({ frame }: { frame: Frame }) {
  const result = publishedResult(frame);
  const rejected = frame.feedback?.status === 'rejected';
  const discoveries = receiptDiscoveries(frame);
  return <><strong>{frame.ending ? frame.ending.title : feedbackTitle(frame)}</strong>{rejected && <small>{refusalStatus(frame)}</small>}{result && <small>{[...result.changes.map(change => ({ change, when: '本次' })), ...result.laterChanges.map(change => ({ change, when: '随后' }))]
    .filter(({ change }) => ['everflameCharges', 'endurance', 'life'].includes(change.field))
    .map(({ change, when }) => `${when}${CHANGE_NAMES[change.field]} ${text(change.before)} → ${text(change.after)}`).join('；')}</small>}
    {result?.elapsed && <small>本次提交至返回共推进 {result.elapsed.action + result.elapsed.subsequent} 局内时间单位</small>}
    {hasPublicVitalLoss(frame) && <small className="receipt-loss">受损来源待查 · 展开查看本次与随后变化</small>}
    {result && frame.feedback?.entry === 'offer_escort_adventurer' && ![...result.discoveries, ...result.laterDiscoveries].some(row => row.kind === 'movement')
      && <small className="receipt-escort">邀请已经喊出；本次暂未看见新的动身迹象。</small>}
    <CheckConclusion frame={frame} />
    {discoveries.length > 0 && <small className="receipt-discoveries" data-testid="receipt-discoveries">{discoveries.slice(0, 2).join('；')}{discoveries.length > 2 ? `；另有 ${discoveries.length - 2} 条见闻，展开查看` : ''}</small>}
  </>;
}

export function policySettingsReadback(previous: SessionResponse | null, next: SessionResponse): PolicyStartSettings | null {
  if (next.policy && next.policy.status !== 'idle'
    && (previous?.sessionId !== next.sessionId || previous.policy?.id !== next.policy.id)) {
    return { maxActions: next.policy.limit, stopOnUnexpected: next.policy.stopOnUnexpected };
  }
  return null;
}

export function automationStop(frame: Frame): 'ending' | 'death' | 'incapacitated' | 'frozen' | null {
  if (frame.ending) return 'ending';
  if (frame.fields.lifeState === 'dead') return 'death';
  if (frame.fields.lifeState === 'incapacitated') return 'incapacitated';
  return frame.fields.coldState === 'frozen' ? 'frozen' : null;
}

export function PersonalityChoices({ offers, selectedId, settings, disabled, onSelect, onSettings, onApprove }: {
  offers: IntentOffer[]; selectedId: string | null; disabled: boolean;
  settings: PolicyStartSettings; onSettings: (settings: PolicyStartSettings) => void;
  onSelect: (id: string) => void; onApprove: (id: string) => void;
}) {
  const selected = offers.find(offer => offer.id === selectedId);
  return <section className="intent-choices" aria-label="人格倾向">
    <div className="policy-launch">
      <strong>{selected?.label ?? '选择一种倾向'} · 最多 {Number.isNaN(settings.maxActions) ? '？' : settings.maxActions} 次</strong>
      <button className="execute" disabled={disabled || !selected || !validPolicySettings(settings)} onClick={() => { if (selected && validPolicySettings(settings)) onApprove(selected.id); }}>
        按此倾向行动<Play size={18} />
      </button>
    </div>
    <fieldset disabled={disabled}><legend>这次以什么性格行动？</legend>
      {offers.map(offer => <label className="intent-choice" key={offer.id}>
        <input type="radio" name="intent" value={offer.id} checked={selectedId === offer.id} onChange={() => onSelect(offer.id)} />
        <span><strong>{offer.label}</strong><span>{offer.description}</span></span>
      </label>)}
    </fieldset>
    <fieldset className="policy-settings" disabled={disabled}>
      <label className="policy-limit">行动上限<input type="number" name="maxActions" min={1} max={128} step={1} required value={Number.isNaN(settings.maxActions) ? '' : settings.maxActions} onChange={event => onSettings({ ...settings, maxActions: event.currentTarget.valueAsNumber })} /></label>
      <label className="policy-unexpected"><input type="checkbox" name="stopOnUnexpected" checked={settings.stopOnUnexpected} onChange={event => onSettings({ ...settings, stopOnUnexpected: event.currentTarget.checked })} />遇到意外时停止</label>
    </fieldset>
    {!offers.length && <p className="empty">当前没有可用的人格倾向。</p>}
    {!!offers.length && <p className="selection-note">行动会推进局内时间。每步重新判断，结果会停留片刻供你阅读。点击停止即可接手；已经开始的行动先结算完。</p>}
    {!!offers.length && <details className="policy-scope"><summary>代行范围与停止条件</summary><p>按作者评价与人格偏好行动：可观察、沿已知通路行进、取用资源、帮助已知受困者、搬离眼前仪式祭品、邀请身边居民或离宫。优先保留 2 点充能，并寻找其他可行行动。默认遇到意外时停下；关闭后继续重规划，但死亡、失能或冰封仍会停止。无法保证成功。</p></details>}
  </section>;
}

interface PolicyControlProps {
  policy: IntentPolicy; pumping: boolean; cancelling: boolean; disabled: boolean;
  canContinue: boolean;
  onResume: () => void; onCancel: () => void;
}

function PolicyCommands({ policy, pumping, cancelling, disabled, canContinue, onResume, onCancel, onDetails }: PolicyControlProps & { onDetails?: () => void }) {
  return <div className="policy-commands">
    {policy.status === 'stopped' && canContinue && <button disabled={disabled || pumping || cancelling} onClick={onResume}><Play size={16} />继续「{policy.label ?? '原人格'}」代行</button>}
    {policy.status === 'running' && <>
      {!pumping && !cancelling && <button disabled={disabled} onClick={onResume}><Play size={16} />继续行动</button>}
      <button disabled={disabled || cancelling} onClick={onCancel}><Square size={16} />{cancelling ? '正在停止…' : '停止'}</button>
    </>}
    {onDetails && <button className="policy-details-toggle" title="行动详情" aria-label="行动详情" onClick={onDetails}><History size={17} /></button>}
  </div>;
}

export function PolicyProgress(props: PolicyControlProps & { offers: Offer[]; frame?: Frame; onDetails: () => void; currentRevision?: number }) {
  const { policy, pumping, cancelling } = props;
  if (policy.status === 'idle') return null;
  const latestStep = policy.steps.at(-1);
  const manuallyContinued = policy.status === 'stopped' && latestStep && props.currentRevision !== undefined && props.currentRevision > latestStep.afterRevision;
  const choices = policy.stopDetail?.choices.flatMap(choice => {
    const offer = props.offers.find(row => row.index === choice.index && row.label === choice.label);
    if (!offer) return [];
    const target = props.frame ? [...targetNames(offer, props.frame), ...(offer.destination ? [siteName(offer.destination, props.frame)] : [])].join('、') : '';
    return [actionName(offer) + (target ? `（${target}）` : '')];
  }) ?? [];
  return <section className="policy-progress" aria-label="人格行动进度" data-policy-status={policy.status}>
    <div className="policy-readback" role="status"><strong>{policy.label} · {manuallyContinued ? '上段代行' : '已执行'} {policy.executed} 次</strong>
      <p>{manuallyContinued ? '你已接手 · 按当前位置继续选择' : cancelling ? '正在停止…' : policy.status === 'stopped' ? '已停止' : pumping ? '正在推进' : '行动已中断'}{!manuallyContinued ? latestStep ? ` · 刚刚完成：${actionName(latestStep)}` : ' · 暂无已完成行动' : ''}</p>
      {policy.status === 'stopped' && !manuallyContinued && policy.reason && <p className="policy-safety-stop" role={['death', 'incapacitated', 'frozen', 'unexpected'].includes(policy.stopDetail?.code ?? '') ? 'alert' : 'status'}>{policy.reason}</p>}
      {policy.status === 'stopped' && !manuallyContinued && choices.length > 0 && ['ambiguous', 'manual_decision', 'no_candidate', 'resource_reserve', 'retry_budget'].includes(policy.stopDetail?.code ?? '') && <p className="stop-candidates">可亲自选择：{choices.join('、')}。打开“全部行动”选择。</p>}
    </div>
    <PolicyCommands {...props} />
  </section>;
}

export function PolicyDetails({ policy, offers }: { policy: IntentPolicy; offers: Offer[] }) {
  if (policy.status === 'idle') return null;
  const elapsed = policy.steps.reduce((total, step) => total + step.afterTime - step.beforeTime, 0);
  const latestStep = policy.steps.at(-1);
  return <section className="policy-details" aria-label="人格行动详情">
    <div className="policy-readback"><strong>{policy.label}</strong>
      <p>{policy.status === 'stopped' ? '已停止' : '进行中'} · 本次已行动 {policy.executed} 次 · 你设置的上限 {policy.limit} 次 · 本次实际总耗时 {elapsed} 局内时间单位</p>
      <small>意外停点：{policy.stopOnUnexpected ? '开启' : '关闭'}</small>
      {policy.plan !== null && <div className="policy-plan" aria-label="当前行动计划">
        <p><strong>{policy.status === 'stopped' ? '停止前目标' : '当前目标'}：{policy.plan.goal}</strong></p>
        <p>预计路线：{policy.plan.route.map(row => text(row.label)).join(' → ') || '尚无路线记录'}</p>
        <small>预计 {policy.plan.estimatedActions} 次行动 · 结果待实际行动确认</small>
        {policy.plan.uncertainty && <p>{policy.plan.uncertainty}</p>}
      </div>}
      {latestStep && <div className="policy-latest" data-testid="policy-latest-action">
        <p><strong>刚刚完成：{actionName(latestStep)}</strong></p>
        <p>实际位置：{siteName(latestStep.beforeSite)} → {siteName(latestStep.afterSite)}</p><p>最新判断：{latestStep.reason}</p><details><summary>计算记录</summary><small>选择权重 {latestStep.score}：用于比较当前行动，不是结算所得分。</small></details>
        <small>局内时刻 {latestStep.beforeTime} → {latestStep.afterTime} · 耗时 {latestStep.afterTime - latestStep.beforeTime} 局内时间单位</small>
      </div>}
      {policy.status === 'stopped' && policy.reason && <p className="policy-reason">{policy.reason}</p>}
    </div>
    {policy.status === 'stopped' && policy.stopDetail && policy.stopDetail.choices.length > 0 && <div className="policy-stop-choices" data-stop-code={policy.stopDetail.code}>
      <p>可亲自选择</p>
      <ul aria-label="当前公开手动选项">{policy.stopDetail.choices.map(choice => {
        const offer = offers.find(row => row.index === choice.index && row.label === choice.label);
        return <li key={choice.index} data-choice-index={choice.index}>{offer ? actionName(offer) : text(choice.label)}</li>;
      })}</ul>
    </div>}
    {!!policy.steps.length && <section className="policy-steps"><h3>已执行行动 · {policy.steps.length}</h3>
      <ol>{policy.steps.map((step, i) => <li key={`${step.beforeRevision}:${i}`}><strong>{actionName(step)}</strong><span>实际位置：{siteName(step.beforeSite)} → {siteName(step.afterSite)}</span><span>{step.reason}</span><small>局内时刻 {step.beforeTime} → {step.afterTime} · 耗时 {step.afterTime - step.beforeTime} 局内时间单位</small></li>)}</ol>
    </section>}
  </section>;
}

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [offerIndex, setOfferIndex] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const openingShown = useRef<string | null>(null);
  const [journal, setJournal] = useState<{ id: string; title: string; time: number; receipt: Frame; routeChanges: RouteReadbackChange[]; surfaceChanges: SurfaceChange[] }[]>([]);
  const [routeChanges, setRouteChanges] = useState<RouteReadbackChange[]>([]);
  const previousReadback = useRef<SessionResponse | null>(null);
  const [surfaceChanges, setSurfaceChanges] = useState<SurfaceChange[]>([]);
  const [recentOffer, setRecentOffer] = useState<Offer | undefined>();
  const [advice, setAdvice] = useState<PersonalityAdvice | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [guideEnabled, setGuideEnabled] = useState(true);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [policySettings, setPolicySettings] = useState<PolicyStartSettings>({ maxActions: 8, stopOnUnexpected: true });
  const [startingIntent, setStartingIntent] = useState<IntentOffer | null>(null);
  const [policyActivity, setPolicyActivity] = useState<'idle' | 'pumping' | 'cancelling'>('idle');
  const policyRunner = useRef<IntentPolicyRunner | null>(null);
  if (!policyRunner.current) policyRunner.current = new IntentPolicyRunner(client, next => flushSync(() => apply(next)));
  const submitted = useRef<{ offer: Offer; revision: number; sessionId: string } | null>(null);
  const inFlight = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const confirmationOpener = useRef<HTMLButtonElement | null>(null);

  function apply(next: SessionResponse) {
    const settings = policySettingsReadback(previousReadback.current, next);
    if (settings) setPolicySettings(settings);
    policyRunner.current?.observe(next);
    if (automationStop(next.frame)) policyRunner.current?.interrupt();
    setStartingIntent(null);
    const changes = sessionRouteChanges(previousReadback.current, next);
    const visibleChanges = surfaceReadbackChanges(previousReadback.current, next);
    if (previousReadback.current?.revision !== next.revision || previousReadback.current?.sessionId !== next.sessionId) {
      const attempt = submitted.current;
      setRecentOffer(attempt && attempt.sessionId === next.sessionId && next.revision > attempt.revision && next.frame.feedback?.status === 'published' && next.frame.feedback.entry === attempt.offer.entry ? attempt.offer : undefined);
    }
    submitted.current = null;
    previousReadback.current = next;
    setRouteChanges(changes);
    setSurfaceChanges(visibleChanges);
    setSession(next);
    setOfferIndex(null);
    setPreviewIndex(null);
    setSelection(previous => {
      if (!previous || previous.kind !== 'object' && previous.kind !== 'surface') return null;
      if (previous.kind === 'surface' && currentMapEntities(next.frame).some(item => item.id === previous.id)) return previous;
      return next.frame.observations.some(item => item.id === previous.id) ? { kind: 'object', id: previous.id } : null;
    });
    if (next.frame.feedback) setJournal(previous => {
      const id = `${next.sessionId}:${next.revision}`;
      return previous.some(row => row.id === id) ? previous : [{ id, title: feedbackTitle(next.frame), time: next.frame.time, receipt: next.frame, routeChanges: changes, surfaceChanges: visibleChanges }, ...previous].slice(0, 20);
    });
  }

  useEffect(() => {
    let active = true;
    client.start().then(next => { if (active) apply(next); }).catch(e => { if (active) setError(String(e.message ?? e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; policyRunner.current?.interrupt(); };
  }, []);

  const guidanceId = session ? guidanceIntent(session, intentId) : undefined;
  useEffect(() => {
    setAdvice(null); setAdviceError(null);
    if (!session || !guidanceId || !guideEnabled || busy || error
      || policyActivity !== 'idle' || session.frame.ending || session.policy?.status === 'running') return;
    const controller = new AbortController();
    client.advice(session, guidanceId, policySettings.stopOnUnexpected, controller.signal)
      .then(result => { if (!controller.signal.aborted) setAdvice(result); })
      .catch(e => { if (!controller.signal.aborted) setAdviceError(e instanceof Error ? e.message : '建议暂未取得。'); });
    return () => controller.abort();
  }, [session?.sessionId, session?.revision, session?.policyRevision, guidanceId, guideEnabled,
    policySettings.stopOnUnexpected, busy, error, policyActivity]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [session?.revision, session?.sessionId]);
  useEffect(() => { if (offerIndex != null) confirmationRef.current?.scrollIntoView({ block: 'nearest' }); }, [offerIndex]);

  function cancelConfirmation() {
    cancelActionConfirmation(() => { setOfferIndex(null); setPreviewIndex(null); }, confirmationOpener.current);
  }

  useEffect(() => {
    if (!panel && offerIndex == null) return;
    return listenForEscape(window, () => {
      if (panel) setPanel(null);
      else cancelConfirmation();
    });
  }, [panel, offerIndex]);

  const panelOpen = panel !== null;
  useEffect(() => {
    if (!panelOpen || !sheetRef.current) return;
    return manageSheetFocus(window, sheetRef.current, document.activeElement as HTMLElement);
  }, [panelOpen]);
  useEffect(() => { if (panel) closeRef.current?.focus(); }, [panel]);
  useEffect(() => {
    if (!session || busy || !session.frame.briefing || session.frame.time !== 0 || openingShown.current === session.sessionId) return;
    openingShown.current = session.sessionId;
    setPanel('opening');
  }, [session?.sessionId, session?.frame.time, busy]);

  async function run(operation: () => Promise<SessionResponse>) {
    if (inFlight.current || policyActivity !== 'idle') return;
    inFlight.current = true; setBusy(true); setError(null);
    try { apply(await operation()); }
    catch (e) { setError(e instanceof Error ? e.message : '未取得会话结果，请同步。'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function runPolicy(selectedIntent?: string) {
    if (inFlight.current || policyActivity !== 'idle' || error || busy) return;
    if ((session && automationStop(previousReadback.current?.frame ?? session.frame)) || (selectedIntent !== undefined && !validPolicySettings(policySettings))) return;
    if (selectedIntent !== undefined) setIntentId(selectedIntent);
    setStartingIntent(selectedIntent === undefined ? null : previousReadback.current?.intentOffers?.find(offer => offer.id === selectedIntent) ?? null);
    setOfferIndex(null); setPreviewIndex(null); setPanel(null);
    setPolicyActivity('pumping'); setError(null);
    try { await policyRunner.current!.run(selectedIntent === undefined ? undefined : { intentId: selectedIntent, ...policySettings }); }
    catch (e) { setError(e instanceof Error ? e.message : '未取得人格行动结果，请同步。'); }
    finally { setPolicyActivity(previous => previous === 'cancelling' ? previous : 'idle'); }
  }

  async function cancelPolicy() {
    if (inFlight.current || policyActivity === 'cancelling' || error || busy) return;
    const cancellation = policyRunner.current!.cancel();
    setPolicyActivity('cancelling');
    try { await cancellation; }
    catch (e) { setError(e instanceof Error ? e.message : '未取得停止结果，请同步。'); }
    finally { setPolicyActivity('idle'); }
  }

  if (!session) return <main className="loading"><Flame size={38} /><h1>冰焰解冻之旅</h1><p>{error ?? '正在点燃永焰…'}</p>{error && <><button onClick={() => void run(() => client.start())} disabled={busy}><RefreshCw size={16} />重新连接</button><button onClick={() => void run(() => client.newSession())} disabled={busy}><Flame size={16} />新建一局</button></>}</main>;

  const frame = session.frame;
  const here = currentSite(frame);
  const selected = selection ?? { kind: 'site', id: here };
  const selectedEntityId = selected.kind === 'surface' || selected.kind === 'object' ? selected.id : undefined;
  const features = tableFeatures(frame);
  const observations = frame.observations;
  const chosenObservation = selected.kind === 'object' ? latestObservations(frame).find(o => o.id === selected.id) : undefined;
  const chosenSurface = selected.kind === 'surface' ? currentMapEntities(frame).find(o => o.id === selected.id) : undefined;
  const chosenFeature = selected.kind === 'feature' ? features.find(f => f.id === selected.id) : undefined;
  const heading = selected.kind === 'all' ? '全部行动' : selected.kind === 'observations' ? '公开观察入口' : selected.kind === 'object' ? chosenObservation ? publicLabel(chosenObservation.label) : '未知' : selected.kind === 'surface' ? chosenSurface ? publicLabel(chosenSurface.label) : '未知' : selected.kind === 'feature' ? chosenFeature?.label ?? '物件' : siteName(selected.id, frame);
  const siteOffers = selected.kind === 'site' && selected.id !== here ? selectedSiteOffers(frame, selected.id) : null;
  const offers = siteOffers?.offers ?? contextOffers(frame, selected);
  const chosenOffer = frame.offers.find(o => o.index === offerIndex);
  const previewOffer = frame.offers.find(o => o.index === previewIndex);
  const policyRunning = !frame.ending && session.policy?.status === 'running';
  const automationBlocked = Boolean(automationStop(frame));
  const continuationIntent = session.policy?.status === 'stopped' ? session.policy.intentId : null;
  const working = busy || policyActivity !== 'idle';
  const blocked = working || Boolean(error) || Boolean(frame.ending) || policyRunning;
  const policyControls: PolicyControlProps | null = session.policy ? {
    policy: session.policy, pumping: policyActivity === 'pumping', cancelling: policyActivity === 'cancelling',
    disabled: busy || Boolean(error) || automationBlocked || session.policy.status === 'stopped' && !validPolicySettings(policySettings),
    canContinue: !automationBlocked && continuationIntent !== null,
    onResume: () => void runPolicy(session.policy?.status === 'stopped' ? continuationIntent! : undefined),
    onCancel: () => void cancelPolicy(),
  } : null;
  const backdrop = sceneBackdrop(frame);
  const recommendation = guideEnabled && !working && !error
    ? personalityRecommendation(session, advice, guidanceId, policySettings.stopOnUnexpected) : null;
  const currentAdvice = guideEnabled && !working && !error
    ? currentPersonalityAdvice(session, advice, guidanceId, policySettings.stopOnUnexpected) : null;
  const location = guideLocation(frame, recommendation?.offer);
  const recommendedSite = location?.kind === 'site' ? location.id : undefined;

  function select(next: Selection) {
    setSelection(next); setOfferIndex(null); setPreviewIndex(null);
    const only = uniqueSelectionOffer(frame, next);
    if (only && !blocked) {
      confirmationOpener.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
      setOfferIndex(only.index);
    }
  }
  function selectEntity(id: string) {
    select({ kind: currentMapEntities(frame).some(item => item.id === id) ? 'surface' : 'object', id });
    setPanel(null);
  }
  function choose(offer: Offer) {
    if (blocked || inFlight.current) return;
    submitted.current = { offer, revision: session!.revision, sessionId: session!.sessionId };
    void run(() => client.choose(offer.index));
  }
  function act(offer: Offer, initiator: HTMLButtonElement) {
    if (blocked) return;
    if (!selection || !offers.some(o => o.index === offer.index)) setSelection({ kind: 'site', id: here });
    if (requiresActionConfirmation(offer, recommendation?.offer.index)) { confirmationOpener.current = initiator; setOfferIndex(offer.index); }
    else choose(offer);
  }

  return <div className="app" data-session-revision={session.revision}>
    <header className="masthead">
      <a className="brand" href="/" aria-label="冰焰解冻之旅"><Flame size={23} /><span>冰焰解冻之旅<small>THAWED THROUGH THE EVERFLAME</small></span></a>
      <div className="chapter"><span>01</span><div>冻结的宫殿<small>{siteName(here, frame)}</small></div></div>
      <nav aria-label="冒险记录">
        <label className="guide-toggle" title="当前人格建议"><input type="checkbox" checked={guideEnabled} disabled={policyRunning || working || Boolean(frame.ending)} onChange={event => setGuideEnabled(event.target.checked)} />人格引导</label>
        <button title="人格倾向" aria-label="人格倾向" disabled={blocked} onClick={() => setPanel('intents')}><UserRound size={19} /></button>
        <button title="目标与结局" aria-label="目标与结局" onClick={() => setPanel('goals')}><Flag size={19} /></button>
        <button title="已知地图" aria-label="已知地图" onClick={() => setPanel('map')}><Map size={19} /></button>
        <button title="观察记录" aria-label="观察记录" onClick={() => setPanel('memory')}><Eye size={19} /><span>{observations.length}</span></button>
        <button title="行动记录" aria-label="行动记录" onClick={() => setPanel('history')}><History size={19} /></button>
        <span className="nav-divider" />
        <button title="同步会话" aria-label="同步会话" disabled={working} onClick={() => void run(() => client.refresh())}><RefreshCw size={18} className={working ? 'spinning' : ''} /></button>
        <button title="重新开始" aria-label="重新开始" disabled={working || Boolean(error) || policyRunning} onClick={() => setPanel('restart')}><RotateCcw size={18} /></button>
      </nav>
    </header>

    <main className={`play-area board ${backdrop ? 'has-backdrop' : 'unpictured-scene'} ${selection ? 'details-open' : ''}`} aria-label="当前场景" data-testid="current-scene" data-scene-hud="true">
      {backdrop && <img className="board-art" src={backdrop} alt="" aria-hidden="true" />}
      <section className="resource-hud" aria-label="本人状态">
        <PlayerIdentity />
        <div className="vitals"><div className={`stat ${frame.ending?.id === 'adventurer_dead' ? 'life-lost' : ''}`}><Heart size={20} /><span>生命<strong>{frame.ending?.id === 'adventurer_dead' ? '死亡' : text(frame.fields.life)}</strong></span></div>
          <div className="stat"><Zap size={20} /><span>耐力<strong>{frame.fields.endurance ?? '？'}<small> / {frame.fields.maxEndurance ?? '？'}</small></strong></span></div></div>
        <ResourceReadbacks frame={frame} />
        <PlayerAvailability frame={frame} />
        <InventoryReadbacks frame={frame} />
        <PlayerReadings frame={frame} />
      </section>
      <section className="map-hud" aria-label="地图与目的地">
        <GeographicMap frame={frame} selectedId={selected.kind === 'site' ? selected.id : undefined} selectedEntityId={selectedEntityId} onSelect={id => select({ kind: 'site', id })} onSelectEntity={selectEntity} compact recommendedSite={recommendedSite} />
        <button className={`destination-toggle ${recommendedSite ? 'recommended-location' : ''}`} onClick={() => setPanel('map')}><Compass size={18} /><span>目的地与路线</span><ChevronRight size={16} /></button>
      </section>
      <section className="scene-content" aria-label="眼前场景与目标">
        <div className="quest-hud" aria-hidden={panel === 'policy' || panel === 'ending' || undefined}>{!frame.ending && <AdventureStatus frame={frame} />}{frame.ending ? <EndingNotice frame={frame} policy={session.policy} onView={() => setPanel('ending')} />
          : startingIntent ? <section className="policy-progress" aria-label="人格行动进度"><div className="policy-readback" role="status"><strong>{startingIntent.label}</strong><p>{error ? '启动结果待同步' : policyActivity === 'cancelling' ? '正在停止…' : '正在启动…'}</p></div><div className="policy-commands"><button disabled={Boolean(error) || busy || policyActivity === 'cancelling'} onClick={() => void cancelPolicy()}><Square size={16} />停止</button></div></section>
          : policyControls && policyControls.policy.status === 'running' ? <PolicyProgress {...policyControls} frame={frame} offers={frame.offers} currentRevision={session.revision} onDetails={() => setPanel('policy')} />
          : recommendation ? <PublicFirstStep offer={recommendation.offer} frame={frame} reason={recommendation.reason} compact />
          : guideEnabled && !working && guidanceId && (currentAdvice?.reason || adviceError) ? <section className="next-step-guidance" data-testid="personality-guidance"><strong>当前人格建议</strong><p>{adviceError ?? currentAdvice?.reason}</p></section>
          : <NextStepGuidance frame={frame} blocked={blocked} onAct={act} compact />}
          {!frame.ending && !startingIntent && policyControls?.policy.status === 'stopped' && <StoppedPolicyNotice policy={policyControls.policy} currentRevision={session.revision} onDetails={() => setPanel('policy')} />}</div>
        <div className="scene-heading"><h1>{siteName(here, frame)}</h1><p>{locationNote(frame)}</p><span><Clock3 size={16} />局内时刻 {frame.time}</span>
          {frame.feedback?.status === 'rejected' && !error && !busy && <section className="rejection-notice" role="alert" aria-label={feedbackTitle(frame)}><strong><X size={18} />{feedbackTitle(frame)} · {refusalStatus(frame)}</strong><p>{feedbackText(frame) ?? '尚无公开的拒绝说明。'}</p><details><summary>拒绝记录</summary><small className="refusal-code">错误码: <code>{frame.feedback.refusal.code}</code></small></details></section>}
        </div>
        <SceneStage frame={frame} selectedId={selected.kind === 'surface' ? selected.id : undefined} onSelect={id => select({ kind: 'surface', id })} recommendedId={location?.kind === 'surface' ? location.id : undefined} report={session.playReport} />
      </section>

      {selection && <aside className="inspector" aria-label="所选详情">
        <div className="inspector-top"><span>{frame.ending ? '旅程已结束' : chosenObservation ? '所见记录' : chosenSurface ? '就在附近' : '行动详情'}</span><button title="关闭详情" aria-label="关闭详情" onClick={() => { setSelection(null); cancelConfirmation(); }}><X size={20} /></button></div>
        <div className="selection-heading"><span className="selection-icon">{selected.kind === 'object' ? <Eye size={23} /> : selected.kind === 'site' && selected.id === 'ballroom_chandelier_reach' ? <LampCeiling size={25} /> : <Compass size={23} />}</span><h2>{heading}</h2></div>
        <details className="selection-note"><summary>{frame.ending ? '旅程回顾' : chosenObservation ? '上次观察的详情' : chosenSurface ? '眼前所见' : siteOffers?.firstStep ? `第一步：${siteName(siteOffers.path![1], frame)}` : '地点与行动说明'}</summary><p>{frame.ending ? timingGuidance(frame).notice : chosenObservation ? '这里保留着上次相遇的见闻。' : chosenSurface ? `你在${siteName(chosenSurface.site, frame)}看见了这个目标。` : chosenFeature ? chosenFeature.note : selected.kind === 'observations' ? '花一点时间看看附近。' : selected.kind === 'site' && selected.id !== here ? '先选择前往这个方向的第一步。' : timingGuidance(frame).notice}</p></details>
        <div className="offer-scroll" ref={scrollRef}>
          {chosenSurface && <CurrentEntityDetails item={chosenSurface} frame={frame} />}
          {chosenSurface && !frame.ending && <SurfaceActionGap frame={frame} id={chosenSurface.id} onBrowse={() => select({ kind: 'observations' })} />}
          <details className="preview-details"><summary>所选行动预告</summary><ActionPreview frame={frame} offer={previewOffer} heading={heading} feature={chosenFeature} /></details>
          {chosenSurface && <SurfaceHistory frame={frame} id={chosenSurface.id} submitted={recentOffer} report={session.playReport} />}
          {chosenObservation && <SurfaceHistory frame={frame} id={chosenObservation.id} submitted={recentOffer} report={session.playReport} />}
          <h3 className="actions-label">{frame.ending ? '旅程回顾' : siteOffers?.firstStep ? `第一步 → ${siteName(siteOffers.path![1], frame)}` : '可以做什么'}</h3>
          {!chosenOffer && <ActionChoices frame={frame} offers={offers} blocked={blocked} selectedIndex={offerIndex} onAct={act} onPreview={setPreviewIndex} recommendedIndex={recommendation?.offer.index} />}
          {!frame.ending && !offers.length && !chosenSurface && (selected.kind === 'site'
            ? <SiteActionGap frame={frame} id={selected.id} onAct={act} />
            : <p className="empty">当前没有与它对应的可选行动。</p>)}
          {chosenOffer && !frame.ending && <section className="confirmation" ref={confirmationRef} aria-label="行动确认">
            <h3>{actionName(chosenOffer)}</h3>
            <TargetHistoryWarning offer={chosenOffer} frame={frame} />
            {chosenOffer.entry === 'accept_alpha_adventurer' && <TowerConversation frame={frame} accepting />}
            <p>{actionNote(chosenOffer, frame, false)}</p>
            {chosenOffer.index === recommendation?.offer.index && <p className="capsule-purpose">{recommendation.reason}</p>}
            {chosenOffer.destination && <p className="journey"><span>{siteName(here, frame)}</span><ArrowRight size={15} /><strong>{siteName(chosenOffer.destination, frame)}</strong></p>}
            {chosenOffer.targetIds?.length ? <p>目标：{targetNames(chosenOffer, frame).join('、')}</p> : null}
            {publicCost(chosenOffer) && <p className="cost"><Flame size={16} />{publicCost(chosenOffer)}</p>}
            {chosenOffer.forecasts?.map((forecast, i) => <p className="forecast" key={i}>{forecastName(forecast.label)}<strong>{text(forecast.value)}</strong></p>)}
            {actionValueNote(chosenOffer) && <p>{actionValueNote(chosenOffer)}</p>}
            <small>{actionTimingNote(chosenOffer, session.playReport)}</small>
            <button className="execute" disabled={blocked} data-testid="execute" onClick={() => choose(chosenOffer)}>{busy ? '正在结算…' : '执行行动'}<ArrowRight size={18} /></button>
            <button className="cancel-confirmation" title="取消行动确认" onClick={cancelConfirmation}><X size={15} />取消</button>
          </section>}
        </div>
      </aside>}
      <section className="action-dock" aria-label="行动与结果">
        <LatestReceipt frame={frame} error={error} onRead={() => setPanel('receipt')} />
        <div className="action-bar"><LocalCommands frame={frame} blocked={blocked} onAct={act} recommendedIndex={recommendation?.offer.index} />
          {!frame.ending && <div className="action-tools">
            <button className={`all-actions-toggle ${location?.kind === 'all' || location?.kind === 'observations' || location?.kind === 'site' && location.id === here ? 'recommended-location' : ''}`} title="查看全部行动" aria-label="查看全部行动" onClick={() => select({ kind: 'all' })}><Compass size={20} /><span>全部行动</span></button></div>}
        </div>
      </section>
    </main>

    {panel && <div className="scrim" onClick={() => setPanel(null)}><section ref={sheetRef} className={`sheet ${panel === 'map' ? 'map-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={e => e.stopPropagation()}>
      <header><h2 id="sheet-title">{panel === 'opening' ? '进入冰宫' : panel === 'map' ? '已知地图' : panel === 'memory' ? '观察记录' : panel === 'history' ? '行动记录' : panel === 'goals' ? '目标与结局' : panel === 'intents' ? '人格倾向' : panel === 'policy' ? '自动行动详情' : panel === 'ending' ? '旅程结算' : panel === 'receipt' ? '本次行动与随后变化' : '重新开始这段旅程？'}</h2><button ref={closeRef} title="关闭" aria-label="关闭" onClick={() => setPanel(null)}><X size={20} /></button></header>
      {panel === 'receipt' && <div className="sheet-body"><ActionOutcome frame={frame} busy={busy} error={error} onRefresh={() => void run(() => client.refresh())} onAct={(offer, initiator) => { setPanel(null); act(offer, initiator); }} routeChanges={routeChanges} surfaceChanges={surfaceChanges} /></div>}
      {panel === 'opening' && <div className="sheet-body"><p className="opening-briefing">{frame.briefing}</p><button className="execute" onClick={() => setPanel(null)}>进入舞厅<ArrowRight size={18} /></button></div>}
      {panel === 'ending' && frame.ending && <div className="sheet-body"><EndingSummary frame={frame} report={session.playReport} onRestart={() => setPanel('restart')} onHistory={() => setPanel('history')} /></div>}
      {panel === 'policy' && policyControls && <div className="sheet-body"><PolicyCommands {...policyControls} /><PolicyDetails policy={policyControls.policy} offers={frame.offers} /></div>}
      {panel === 'intents' && <div className="sheet-body">{recommendation && <PublicFirstStep offer={recommendation.offer} frame={frame} reason={recommendation.reason} />}<p>代行从当前建议开始，每一步都会重新判断。你设置的是最多行动次数，可以随时停止。</p><PersonalityChoices offers={session.intentOffers ?? []} selectedId={guidanceId ?? null} settings={policySettings} disabled={blocked || automationBlocked} onSelect={setIntentId} onSettings={setPolicySettings} onApprove={id => void runPolicy(id)} /></div>}
      {panel === 'goals' && <div className="sheet-body"><h3>这次冒险</h3><p>{frame.briefing ?? '尝试中断仪式，让居民有机会离开，并找到通往外岸的路。'}</p><EndingRules /></div>}
      {panel === 'map' && <div className="sheet-body"><GeographicMap frame={frame} selectedId={selected.kind === 'site' ? selected.id : undefined} selectedEntityId={selectedEntityId} onSelect={id => { select({ kind: 'site', id }); setPanel(null); }} onSelectEntity={selectEntity} recommendedSite={recommendedSite} /><AdjacentRouteList frame={frame} selectedId={selected.kind === 'site' ? selected.id : undefined} onSelect={id => { select({ kind: 'site', id }); setPanel(null); }} recommendedSite={recommendedSite} /></div>}
      {panel === 'memory' && <div className="sheet-body"><p>你在旅途中记下的见闻。</p><HistoricalMemory frame={frame} selectedId={selected.kind === 'object' ? selected.id : undefined} onSelect={id => { select({ kind: 'object', id }); setPanel(null); }} report={session.playReport} />
        {frame.fields.chandelierClue && <section className="clue"><Eye size={18} /><div><strong>吊灯线索 · 已取得记录</strong><p>{text(frame.fields.chandelierClue)}</p></div></section>}
        <MovementReadbacks frame={frame} /></div>}
      {panel === 'history' && <div className="sheet-body"><PlayReport report={session.playReport} compact />{!policyRunning && guideEnabled && <NextStepGuidance frame={frame} blocked={blocked} onAct={(offer, initiator) => { setPanel(null); act(offer, initiator); }} />}<section className="journey-status" aria-label="阶段与风险"><div className={`ritual-status ritual-${frame.information.ritual.phase}`} data-testid="ritual-phase"><strong>仪式 · 上次所闻</strong><p>{text(frame.information.ritual.label)}</p><small>{frame.information.ritual.recordedAt ? recordedAt(frame.information.ritual.recordedAt) : '还没有听到仪式的动静'}</small></div><ActionRisk frame={frame} /><EscortResponse frame={frame} /></section><p>这段旅程最近的 20 次行动回执。</p>{journal.length ? journal.map(row => <details className="journal-row" key={row.id}><summary>时刻 {row.time} · {row.title}</summary><ActionOutcome frame={row.receipt} routeChanges={row.routeChanges} surfaceChanges={row.surfaceChanges} busy={false} error={null} onRefresh={() => {}} /></details>) : <div className="empty">暂无最近行动回执。</div>}</div>}
      {panel === 'restart' && <div className="sheet-body"><p>将重新创建开局状态，当前旅程不再显示。</p><button className="execute" disabled={working || policyRunning || Boolean(error)} onClick={() => { setPanel(null); setJournal([]); openingShown.current = null; void run(() => client.restart()); }}>重新开始<RotateCcw size={17} /></button></div>}
    </section></div>}
  </div>;
}
