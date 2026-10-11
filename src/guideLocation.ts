import { contextOffers, currentSite, observationOffers, tableFeatures, type Selection } from './tabletop';
import type { Frame, Offer } from './types';

// Point to an existing interaction surface; never create or reorder an Action.
export function guideLocation(frame: Frame, offer?: Offer): Selection | null {
  if (!offer || frame.ending) return null;
  const includes = (selection: Selection) => contextOffers(frame, selection).some(row => row.index === offer.index);
  for (const entity of frame.information.visibleEntities) {
    const selection: Selection = { kind: 'surface', id: entity.id };
    if (includes(selection)) return selection;
  }
  if (offer.destination) return { kind: 'site', id: offer.destination };
  for (const feature of tableFeatures(frame)) {
    const selection: Selection = { kind: 'feature', id: feature.id };
    if (includes(selection)) return selection;
  }
  if (observationOffers(frame).some(row => row.index === offer.index)) return { kind: 'observations' };
  const here: Selection = { kind: 'site', id: currentSite(frame) };
  return includes(here) ? here : { kind: 'all' };
}
