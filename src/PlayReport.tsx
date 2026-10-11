import type { PlayReport as Report, PlayScores } from './types';
import { actionName, text } from './tabletop';

function achievementLabel(label: string) {
  const [prefix, ...parts] = label.split('：');
  return parts.length ? `${prefix}：${text(parts.join('：'))}` : text(label);
}

function ledgerActionName(action: Report['actions'][number]) {
  const name = actionName({ index: action.number, entry: action.entry, label: action.label });
  const passage = /^(move|cross_ice|bridge_slow|bridge_rush|carry_move|carry_cross_ice|carry_bridge_slow|carry_pass_door|move_wall|pass_door|pass_prison_bars|pass_prison_line|climb_skyhook|balloon_push|balloon_push_ice|balloon_push_bridge|balloon_push_door)_adventurer$/.test(action.entry);
  const destination = passage ? / to (.+)$/.exec(action.label) : null;
  return destination ? `${name} → ${text(destination[1])}` : name;
}

const personalities = [
  { id: 'cautious_investigator', label: '谨慎调查者' },
  { id: 'helpful_rescuer', label: '热心救援者' },
  { id: 'decisive_explorer', label: '果断探索者' },
] as const;

function number(value: number) {
  return String(value);
}

export function displayScore(value: number | null) {
  return value === null ? '暂无' : String(Number((value * 10).toFixed(3)));
}

function ScoreDelta({ scores }: { scores: PlayScores }) {
  const rows = [{ id: 'common', label: '共同成就分' }, ...personalities, { id: 'cost', label: '行动代价' }] as const;
  return <dl className="report-deltas" aria-label="本次分数变化（分）">{rows.map(({ id, label }) => <div key={id}>
    <dt>{label}</dt><dd>{scores[id] > 0 ? '+' : ''}{displayScore(scores[id])}</dd>
  </div>)}</dl>;
}

export function PlayReport({ report, compact = false }: { report: Report; compact?: boolean }) {
  const { metrics, scores } = report;
  const achievementLabels = new Map(report.achievements.map(item => [item.id, achievementLabel(item.label)]));
  const facts = [
    ['已完成行动', metrics.publishedActions], ['手动', metrics.manualActions],
    ['委托', metrics.delegatedActions], ['未获准执行', metrics.rejectedAttempts],
    ['实际耗时', `${number(metrics.elapsed)} 局内时间单位`],
    ['新到访地点', metrics.visitedPlaces], ['人物详察', metrics.peopleDetailed],
    ['仪式中断记录', metrics.ritualDisrupted],
    ['耐力消耗', metrics.enduranceSpent], ['已知充能消耗', metrics.knownChargeSpent],
  ] as const;

  return <section className={`play-report ${compact ? 'compact-report' : 'full-report'}`} aria-label="旅程报告" data-report-status={report.status}>
    <div className="report-heading"><h3>{report.status === 'finished' ? '本局报告' : '旅程进展'}</h3><span>{report.status === 'finished' ? '已结束' : '进行中'}</span></div>
    <p className="report-note">依据本局已确认记录计分</p>
    {!compact && <section className="report-confirmed" aria-label="这一路的经历"><h4>这一路的经历</h4>
      <p>你走过 {metrics.visitedPlaces} 个新地点，仔细看过 {metrics.peopleDetailed} 位人物。
        {metrics.ritualDisrupted > 0 ? '你察觉仪式已中断。' : '这段旅程没有留下仪式中断的见闻。'}
        {metrics.peopleThawed > 0 ? `你让 ${metrics.peopleThawed} 位人物从冰封中解脱。` : '没有人物解冻的记录。'}
        {metrics.departed > 0 ? '最后，你走出了冰宫。' : '你的旅程没有以离宫结束。'}</p>
      <p>居民最终去向以最后所见为准。</p><p aria-label="已确认的解冻与离宫">人物解冻记录 {metrics.peopleThawed} · 离宫记录 {metrics.departed}</p>
    </section>}
    <details className="report-evaluation"><summary>性格与行动评分</summary>{!compact && <p>三种性格回顾同一段经历；分数不是百分制。</p>}
    <dl className="report-totals"><div><dt>共同成就分</dt><dd>{displayScore(scores.common)}</dd></div><div><dt>行动代价（分）</dt><dd>{displayScore(scores.cost)}</dd></div></dl>
    <table className="report-scores"><caption>行为倾向得分</caption><thead><tr><th scope="col">人格</th><th scope="col">得分（分）</th><th scope="col">每行动净收益（分/行动）</th></tr></thead>
      <tbody>{personalities.map(({ id, label }) => <tr key={id}><th scope="row">{label}</th><td>{displayScore(scores[id])}</td><td>{displayScore(report.efficiency[id])}</td></tr>)}</tbody>
    </table>
    </details>
    <details className="report-rules"><summary>分数与记录如何计算</summary><p className="report-note">共同成就来自首次到访、人物解冻、察觉仪式中断和离宫。行动次数、耐力与充能消耗、失败结局计入代价；耗时单独记录。了解人物影响人格评价，不计共同成就。</p><p>每行动净收益 =（共同成就分 + 该人格得分 − 行动代价）÷ 已完成行动数。</p><p>“未获准执行”只计执行前的拒绝；已执行但滑到别处等结果，仍记在实际行动中。本局没有统计居民离宫的确认记录，因此不另报“救援人数”。</p></details>
    {compact ? <p className="report-progress">已完成 {metrics.publishedActions} 次 · 手动 {metrics.manualActions} / 委托 {metrics.delegatedActions} · 耗时 {number(metrics.elapsed)} 局内时间单位</p>
      : <><p className="report-progress">已完成 {metrics.publishedActions} 次 · 手动 {metrics.manualActions} / 委托 {metrics.delegatedActions} · 耗时 {number(metrics.elapsed)} 局内时间单位</p><details><summary>完整旅程统计</summary><dl className="report-metrics">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details></>}
    {compact && <p>人物解冻记录 {metrics.peopleThawed} · 离宫记录 {metrics.departed}</p>}
    <details className="report-achievements"><summary>进展与成就 · {report.achievements.length} 项</summary>
      {report.achievements.length ? <ul>{report.achievements.map(item => <li key={item.id}><strong>{achievementLabel(item.label)}</strong><p>{text(item.evidence)}</p></li>)}</ul>
        : <p className="report-note">暂无已确认成就。</p>}
    </details>
    <details className="report-actions"><summary>实际行动 · {report.actions.length} 次</summary>
      {report.actions.length ? <ol>{report.actions.map(action => <li key={action.number} value={action.number}>
        <strong>{ledgerActionName(action)}</strong>
        <p className="report-action-meta">{action.mode === 'manual' ? '手动' : '委托'}{action.personality !== null ? ` · ${personalities.find(item => item.id === action.personality)?.label ?? '其他人格倾向'}` : ''} · 局内时刻 {number(action.timeBefore)} → {number(action.timeAfter)} · 耗时 {number(action.timeAfter - action.timeBefore)} 局内时间单位</p>
        <ScoreDelta scores={action.scoreDelta} />
        {action.achievements.length > 0 && <p className="report-action-achievements">成就：{action.achievements.map(id => achievementLabels.get(id) ?? '已记录成就').join('、')}</p>}
      </li>)}</ol> : <p className="report-note">还没有已完成的行动。</p>}
    </details>
  </section>;
}
