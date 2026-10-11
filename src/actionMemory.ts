import type { Frame, Offer, PlayReport } from './types';

// Published episode records are historical evidence, never a live NPC state.
export function latestThaw(report: PlayReport | undefined, id: string) {
  return report?.actions.filter(action => action.thawedTargetId === id).at(-1);
}

export function thawAfterObservation(frame: Frame, report: PlayReport | undefined, id: string) {
  const action = latestThaw(report, id);
  const detail = frame.observations.filter(row => row.id === id && row.detailRecordedAt)
    .sort((a, b) => b.detailRecordedAt!.time - a.detailRecordedAt!.time)[0]?.detailRecordedAt;
  return action && (!detail || action.timeAfter > detail.time) ? action : undefined;
}

export function historicalTiming(offer: Offer, report?: PlayReport): string | null {
  const actions = report?.actions.filter(action => action.entry === offer.entry && action.label === offer.label);
  const latest = actions?.at(-1);
  return latest ? `上次同一行动推进了 ${latest.timeAfter - latest.timeBefore} 局内时间单位（${latest.timeBefore} → ${latest.timeAfter}）。仅供比较，本次耗时随当前状况结算。` : null;
}
