import type { Frame, Observation, RecordedAt } from './types';
import { currentMapEntities, currentSite, publicLabel, recordedAt, siteName } from './tabletop';

export interface EntityPresence {
  id: string;
  kind: string;
  label: string;
  site: string;
  presence: 'current' | 'memory';
  recordedAt: RecordedAt | null;
}

export function latestObservations(frame: Frame): Observation[] {
  const latest = new Map<string, Observation>();
  for (const item of frame.observations) {
    const previous = latest.get(item.id);
    if (!previous || item.recordedAt.revision > previous.recordedAt.revision
      || item.recordedAt.revision === previous.recordedAt.revision && item.recordedAt.time > previous.recordedAt.time) latest.set(item.id, item);
  }
  return [...latest.values()];
}

export function entityPresences(frame: Frame): EntityPresence[] {
  const current = currentMapEntities(frame);
  const ids = new Set(current.map(item => item.id));
  const memories = latestObservations(frame).filter(item => !ids.has(item.id) && !['floor', 'dialogue'].includes(item.kind)).flatMap(item => {
    let site = item.site, stamp = item.recordedAt;
    if (item.kind === 'person') for (const movement of frame.information.movements) {
      const next = movement.recordedAt;
      if (movement.subjectId === item.id && (next.revision > stamp.revision || next.revision === stamp.revision && next.time > stamp.time)) {
        site = movement.end;
        stamp = next;
      }
    }
    return site === null ? [] : [{ id: item.id, kind: item.kind, label: publicLabel(item.label), site, presence: 'memory' as const, recordedAt: stamp }];
  });
  return [
    ...current.map(item => ({ id: item.id, kind: item.kind, label: publicLabel(item.label), site: item.site, presence: 'current' as const, recordedAt: null })),
    ...memories,
  ].sort((a, b) => a.site.localeCompare(b.site) || a.id.localeCompare(b.id));
}

export function entityCategory(kind: string) {
  return kind === 'person' ? 'person' : kind === 'elemental' ? 'elemental' : 'object';
}

export function entityPresenceNote(item: EntityPresence, frame: Frame): string {
  const status = item.presence === 'memory' ? `上次所见 · ${recordedAt(item.recordedAt)}`
    : `${item.site === currentSite(frame) ? '当前可见' : '相邻可见'} · 时刻 ${frame.time}`;
  return `${siteName(item.site, frame)} · ${status}${item.kind === 'elemental' ? ' · 元素 · 威胁未知' : ''}`;
}
