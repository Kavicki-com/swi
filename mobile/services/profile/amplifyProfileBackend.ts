import { generateClient } from 'aws-amplify/data';
import type { Profile, ProfileBackend } from './types';

// Untyped client: keeps mobile isolated from swi-backend's Schema type.
// Owner auth scopes Profile.list() to the current user's own records, so we
// treat "the first (and only) owned Profile" as the user's profile.
const client = generateClient();

// Free function (not `this.get()`) so `save` stays correct even if the backend
// is destructured — mirrors the auth backend's deliberate avoidance of `this`.
async function getProfile(): Promise<Profile | null> {
  const { data } = await (client as any).models.Profile.list();
  return (data?.[0] as Profile) ?? null;
}

export const amplifyProfileBackend: ProfileBackend = {
  get: getProfile,
  async save(patch) {
    // NOTE: get-then-create is not atomic — two concurrent saves with no
    // existing row could both create a Profile. In practice step-1 then step-2
    // fire sequentially behind awaited navigation. Verify the single-row
    // invariant in the Phase 6 deploy smoke.
    const existing = await getProfile();
    const model = (client as any).models.Profile;
    const { data } = existing
      ? await model.update({ id: (existing as any).id, ...patch })
      : await model.create(patch);
    return data as Profile;
  },
};
