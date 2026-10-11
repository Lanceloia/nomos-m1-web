import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Frame, PlayerInformation, SurfaceEntity } from './types';
import { publicFrame, surface } from './presence.fixtures';

describe('required public presence and reading DTO', () => {
  it('requires a recognized refusal only on the rejected feedback branch', () => {
    type Feedback = NonNullable<Frame['feedback']>;
    expectTypeOf<Extract<Feedback, { status: 'rejected' }>['refusal']>().toEqualTypeOf<{ code: 'K0_NOT_ADMITTED' | 'C0_BINDING_REJECTED' | 'UNPUBLISHED_RESULT' }>();
    // @ts-expect-error Rejected feedback must carry its public refusal code.
    const invalidRejected: Feedback = { status: 'rejected', actionLabel: 'Attempt', text: '' };
    // @ts-expect-error Published feedback does not carry a refusal.
    const invalidPublished: Feedback = { status: 'published', actionLabel: 'Attempt', text: '', refusal: { code: 'K0_NOT_ADMITTED' } };
    expect(invalidRejected.status).toBe('rejected'); expect(invalidPublished.status).toBe('published');
  });
  it('requires the new arrays, without optional aliases', () => {
    expectTypeOf<Pick<PlayerInformation, 'nearbyEntities'>>().toEqualTypeOf<{ nearbyEntities: SurfaceEntity[] }>();
    expectTypeOf<Pick<Frame['fields'], 'details'>>().toEqualTypeOf<{ details: { label: string; value: string }[] }>();
    const { nearbyEntities, ...oldInformation } = publicFrame().information;
    // @ts-expect-error The legacy information contract cannot be consumed.
    const invalidInformation: PlayerInformation = oldInformation;
    const { details, ...oldFields } = publicFrame().fields;
    // @ts-expect-error The legacy field contract cannot be consumed.
    const invalidFields: Frame['fields'] = oldFields;
    expect(invalidInformation.nearbyEntities).toBeUndefined(); expect(invalidFields.details).toBeUndefined();
    expect(nearbyEntities).toEqual([]); expect(details).toEqual([]);
  });
  it('accepts explicit current elementals at their supplied sites, with unknown detail state', () => {
    const item: SurfaceEntity = surface('elemental', 'elemental', 'ritual_ring');
    expect(item).toMatchObject({ kind: 'elemental', site: 'ritual_ring', state: 'unknown', presence: 'current', facts: [] });
  });
  it('requires exact nullable own lifecycle codes independently of display wording', () => {
    expectTypeOf<Frame['fields']['lifeState']>().toEqualTypeOf<'alive' | 'incapacitated' | 'dead' | null>();
    expectTypeOf<Frame['fields']['coldState']>().toEqualTypeOf<'mobile' | 'frozen' | 'immune' | null>();
    const { lifeState, coldState, ...legacyFields } = publicFrame().fields;
    // @ts-expect-error Localized HUD strings cannot replace the required raw states.
    const invalidFields: Frame['fields'] = legacyFields;
    // @ts-expect-error Display wording is not a lifecycle code.
    const invalidState: Frame['fields']['lifeState'] = 'Alive';
    expect(lifeState).toBeNull(); expect(coldState).toBeNull();
    expect(invalidFields.lifeState).toBeUndefined(); expect(invalidState).toBe('Alive');
  });
});
