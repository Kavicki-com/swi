import { generateClient } from 'aws-amplify/data';
import type { Profile, ProfileBackend } from './types';

// Untyped client: keeps mobile isolated from swi-backend's Schema type.
// Owner auth scopes Profile.list() to the current user's own records, so we
// treat "the first (and only) owned Profile" as the user's profile.
const client = generateClient();

export const amplifyProfileBackend: ProfileBackend = {
  async get() {
    const { data } = await (client as any).models.Profile.list();
    return (data?.[0] as Profile) ?? null;
  },
  async save(patch) {
    const existing = await this.get();
    const model = (client as any).models.Profile;
    const { data } = existing
      ? await model.update({ id: (existing as any).id, ...patch })
      : await model.create(patch);
    return data as Profile;
  },
};
