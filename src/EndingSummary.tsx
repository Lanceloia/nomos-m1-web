import { ChevronRight, Flag, Heart, History, RotateCcw } from 'lucide-react';
import { PlayReport } from './PlayReport';
import { CHANGE_NAMES, publishedResult, recordedAt, siteName, text } from './tabletop';
import type { Frame, IntentPolicy, PlayReport as Report } from './types';

export function EndingNotice({ frame, policy, onView }: { frame: Frame; policy?: IntentPolicy; onView: () => void }) {
  if (!frame.ending) return null;
  const dead = frame.ending.id === 'adventurer_dead';
  const failed = dead || frame.ending.id === 'rescue_window_expired';
  const result = publishedResult(frame);
  const vitals = [...result?.changes ?? [], ...result?.laterChanges ?? []].filter(change => ['life', 'endurance'].includes(change.field));
  return <section className={`ending-notice ${failed ? 'terminal-failure' : ''}`} aria-label="旅程已结束">
    <div role={failed ? 'alert' : 'status'}><strong>{dead ? '你已死亡' : '旅程已结束'} · {frame.ending.title}</strong>
      {failed && <p>{frame.ending.narrationZh}</p>}
      {dead && <p className="terminal-vitals"><Heart size={17} />生命 · 死亡</p>}
      {!!vitals.length && <p className="terminal-vitals">{vitals.map(change => `${CHANGE_NAMES[change.field]} ${text(change.before)} → ${text(change.after)}`).join('；')}</p>}
      <small>本局行动已结束</small>
      {failed && policy?.stopOnUnexpected === false && <small>意外停点已关闭；死亡、失能或冰封仍会停止自动行动。</small>}
    </div>
    <button aria-haspopup="dialog" onClick={onView}>查看结算<ChevronRight size={16} /></button>
  </section>;
}

export function EndingRules() {
  return <section className="ending-rules"><h3>旅程何时结束</h3><ul>
    <li><strong>离宫：</strong>在外岸实际选择离开宫殿。</li>
    <li><strong>死亡：</strong>旅人的生命状态变为死亡。</li>
    <li><strong>救援窗口关闭：</strong>失去行动能力后，未能在救援期内恢复。</li>
  </ul><p>中断仪式后，仍可照看居民、探索宫殿或寻找出口。</p></section>;
}

export function EndingSummary({ frame, report, onRestart, onHistory }: {
  frame: Frame; report: Report; onRestart: () => void; onHistory: () => void;
}) {
  if (!frame.ending) return null;
  const departed = frame.ending.id === 'departed_palace';
  const phase = frame.information.ritual;
  const people = frame.information.visibleEntities.filter(row => row.kind === 'person');
  return <section className="ending-summary" aria-label="本次旅程结算" data-testid="ending-summary">
    <span className="ending-category"><Flag size={18} />{departed ? '离宫结局' : '旅程终止'}</span>
    <h2>{departed ? '你走出了冰宫' : frame.ending.title}</h2>
    <p>{departed ? '本次冒险到此结束。你可以回看这一路的见闻，或开启新的一局。' : frame.ending.narrationZh}</p>
    {departed && people.some(person => person.site === frame.fields.locationId) && <p className="ending-reunion">你并非独自站在外岸：{people.filter(person => person.site === frame.fields.locationId).map(person => text(person.label)).join('、')}也出现在你眼前。这是你最后亲眼看见的去向。</p>}
    {!!report.metrics.peopleThawed && <p>这一路，你曾让 {report.metrics.peopleThawed} 位人物从冰封中解脱。{report.metrics.ritualDisrupted ? '你也察觉到仪式的吟唱不再继续。' : '仪式的结果仍以你的见闻为准。'}</p>}
    <dl className="ending-facts">
      <div><dt>你的旅程</dt><dd>{departed ? '已完成离宫' : frame.ending.id === 'adventurer_dead' ? '死亡' : '救援窗口已关闭'}</dd></div>
      <div><dt>仪式见闻</dt><dd>{phase.phase === 'unknown' ? '没有取得仪式记录' : text(phase.label)}
        {phase.phase !== 'unknown' && <small>上次所闻 · {recordedAt(phase.recordedAt)}</small>}</dd></div>
      <div><dt>最后看见的人</dt><dd>{people.length ? people.map(person => <span key={person.id}>{text(person.label)} · {siteName(person.site, frame)}</span>) : '当前没有看见其他人'}</dd></div>
    </dl>
    <p className="ending-unknown">其他居民的最终去向未记录在本次结算中。</p>
    {frame.fields.gold != null && <details className="ending-inventory"><summary>随身财物</summary><p>金币：{frame.fields.gold}</p></details>}
    <PlayReport report={report} />
    <details><summary>结局条件</summary><EndingRules /></details>
    <div className="ending-commands"><button onClick={onHistory}><History size={16} />旅程回顾</button><button onClick={onRestart}>再玩一局<RotateCcw size={16} /></button></div>
  </section>;
}
