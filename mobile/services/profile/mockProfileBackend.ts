import type { Profile, ProfileBackend } from './types';

let store: Profile = {};

export const mockProfileBackend: ProfileBackend = {
  async get() { return Object.keys(store).length ? { ...store } : null; },
  async save(patch) { store = { ...store, ...patch }; return { ...store }; },
};
