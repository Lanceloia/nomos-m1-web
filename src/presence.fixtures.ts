import type { Frame, Observation, SurfaceEntity } from './types';

export function publicFrame(): Frame {
  return {
    time: 12, ending: null, offers: [], observations: [],
    fields: { details: [], lifeState: null, coldState: null, location: '舞厅入口', locationId: 'ballroom_entrance', everflameCharges: 3, carriedReservoirCharges: null,
      coldCondition: 'unknown', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
    scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance'], siteLabels: {}, routes: [] },
    information: { visibleEntities: [], nearbyEntities: [], visibility: 'provided', visibilityNotice: '眼前记录', movements: [], escortReplies: [],
      ritual: { phase: 'unknown', label: '', evidence: 'unknown', recordedAt: null },
      escortResponse: { status: 'not_observed', label: '' }, timingNotice: '' },
  };
}

export function surface(id: string, kind: SurfaceEntity['kind'], site: string, label = '作者提供的名称'): SurfaceEntity {
  return { id, kind, site, label, state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' };
}

export function memory(id: string, kind: string, site: string | null, revision = 1): Observation {
  return { id, kind, site, label: '上次观察的名称', state: 'unknown', evidence: 'local_record', facts: [], presence: 'not_confirmed',
    recordedAt: { time: revision * 2, revision }, detailRecordedAt: null };
}
