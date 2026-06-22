# SWI Backend — Fatia 1: Auth + Perfil — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @superpowers:executing-plans to implement this plan task-by-task. Use @superpowers:test-driven-development for every task that has a test. Design source: `docs/plans/2026-06-22-swi-backend-auth-profile-design.md`.

**Goal:** Stand up the AWS backend (Amplify Gen 2: Cognito + DynamoDB + AppSync) for the SWI worker auth + profile slice as deploy-ready code, and wire the mobile app to it behind a feature flag so the demo keeps running on mocks until an AWS account exists.

**Architecture:** New isolated sibling `swi-backend/` holds the Amplify Gen 2 definition (`defineAuth` + `defineData`). The mobile app gains a flag (`AUTH_BACKEND: 'mock' | 'amplify'`, default `mock`) that selects between the existing in-memory mock and a real `aws-amplify` implementation behind the already-existing `services/auth/AuthProvider` seam, plus a new `ProfileProvider`. No AWS account yet → everything is built and typechecked but the cloud round-trip is deferred to the Phase 6 runbook.

**Tech Stack:** Amplify Gen 2 (`@aws-amplify/backend`, `ampx`), DynamoDB, AppSync, Cognito; mobile `aws-amplify` v6; Expo Router; `jest-expo` for unit tests.

**Constraint reminders:**
- UI stays 100% DS (`@kavicki/swi-design-system`) + `useTheme()` — no hardcoded tokens, no local component replacements. This slice touches logic/wiring, not DS components.
- Siblings stay isolated: mobile must NOT import from `swi-backend/`. Mobile uses local TS interfaces mirroring the schema; typed codegen into mobile is a post-deploy step (Phase 6).
- Commit only when each task's verification passes. These commit steps are the plan's suggestion, NOT pre-authorization — confirm with the user per project rule before each commit if unsure.

---

## Phase 0 — Repo setup

### Task 0.1: Add `feat/backend-*` branch prefix to CLAUDE.md + create branch

**Files:**
- Modify: `CLAUDE.md` (branch naming section)

**Step 1:** In `CLAUDE.md`, under "Branch naming convention", add a bullet:
```
- `feat/backend-*`, `fix/backend-*`, `chore/backend-*` — work that touches `swi-backend/` (may also touch `mobile/` when wiring the app to the backend)
```

**Step 2:** Create + switch to the branch off the current state (carries the in-flight mobile screens the wiring needs):
```bash
git checkout -b feat/backend-auth-profile
git branch --show-current   # expect: feat/backend-auth-profile
```

**Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "chore(repo): add feat/backend-* branch prefix"
```

### Task 0.2: Gitignore Amplify-generated artifacts

**Files:**
- Modify: `.gitignore`

**Step 1:** Append:
```gitignore
# Amplify Gen 2 generated/per-environment
swi-backend/.amplify/
swi-backend/amplify_outputs*.json
swi-backend/node_modules/
mobile/amplify_outputs*.json
```

**Step 2: Commit**
```bash
git add .gitignore
git commit -m "chore(repo): gitignore Amplify generated artifacts"
```

---

## Phase 1 — `swi-backend/` scaffold (backend-as-code)

> No AWS account is needed for scaffolding or typechecking — only `ampx sandbox` (Phase 6) needs credentials. Network access IS needed for `npm create amplify`.

### Task 1.1: Scaffold the Amplify Gen 2 project

**Files:**
- Create: `swi-backend/` (via official scaffolder)

**Step 1:** From repo root:
```bash
mkdir swi-backend && cd swi-backend && npm create amplify@latest -y
```
Expected: creates `amplify/auth/resource.ts`, `amplify/data/resource.ts`, `amplify/backend.ts`, `package.json`, `tsconfig.json`, `.gitignore`, and installs deps.

**Step 2:** Verify it typechecks out of the box:
```bash
cd swi-backend && npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**
```bash
git add swi-backend
git commit -m "feat(backend): scaffold Amplify Gen 2 project"
```

### Task 1.2: Configure Cognito auth (groups worker/admin)

**Files:**
- Modify: `swi-backend/amplify/auth/resource.ts`

**Step 1:** Replace the file contents:
```ts
import { defineAuth } from '@aws-amplify/backend';

/**
 * Worker authentication for the SWI mobile app.
 * - Email + password login with self sign-up and email-code confirmation
 *   (Cognito default email; SES is a later-slice upgrade for volume).
 * - Groups gate authorization in data/resource.ts: `worker` is the default
 *   for self sign-up; `admin` (occupational health) is assigned manually in
 *   the Cognito console for now (admin tooling is a future slice).
 */
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['admin', 'worker'],
});
```

**Step 2:** Typecheck:
```bash
cd swi-backend && npx tsc --noEmit
```
Expected: no errors.

### Task 1.3: Define the data model (Profile + HealthData)

**Files:**
- Modify: `swi-backend/amplify/data/resource.ts`

**Step 1:** Replace the schema with:
```ts
import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

/**
 * Profile  — personal + address data the worker edits about themselves
 *            (complementary-data step-1 + step-2). owner = the worker.
 * HealthData — clinical data (step-3 / settings health-data). Decision 5:
 *            edited by admin/occupational-health, READ-ONLY for the worker.
 *            `workerId` carries the worker's Cognito sub so the worker can
 *            read their own record even though an admin created it.
 *            NOTE: HealthData is defined now so the schema is correct, but
 *            it is NOT wired to the app in this slice (admin tooling first).
 */
const schema = a.schema({
  Profile: a
    .model({
      fullName: a.string(),
      phone: a.string(),
      cpf: a.string(),
      birthDate: a.date(),
      cep: a.string(),
      street: a.string(),
      number: a.string(),
      complement: a.string(),
      neighborhood: a.string(),
      city: a.string(),
      uf: a.string(),
    })
    .authorization((allow) => [
      allow.owner().to(['read', 'create', 'update']),
      allow.group('admin'),
    ]),

  HealthData: a
    .model({
      workerId: a.string().required(),
      gender: a.string(),
      height: a.float(),
      weight: a.float(),
      bloodType: a.string(),
      disability: a.string(),
    })
    .authorization((allow) => [
      allow.group('admin'),
      allow.ownerDefinedIn('workerId').to(['read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
```

**Step 2:** Typecheck:
```bash
cd swi-backend && npx tsc --noEmit
```
Expected: no errors.

### Task 1.4: Verify backend wiring + commit

**Files:**
- Verify: `swi-backend/amplify/backend.ts` (scaffold already does `defineBackend({ auth, data })`)

**Step 1:** Confirm `backend.ts` imports and registers both `auth` and `data`. If the scaffold omitted either, add it:
```ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

defineBackend({ auth, data });
```

**Step 2:** Final backend typecheck:
```bash
cd swi-backend && npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**
```bash
git add swi-backend
git commit -m "feat(backend): Cognito auth (worker/admin) + Profile/HealthData schema"
```

---

## Phase 2 — Mobile: flag-driven auth abstraction

### Task 2.0: Add `aws-amplify` + `jest-expo` to mobile

**Files:**
- Modify: `mobile/package.json`

**Step 1:** From `mobile/`:
```bash
cd mobile && npm install aws-amplify
cd mobile && npm install --save-dev jest-expo jest @types/jest
```

**Step 2:** Add to `mobile/package.json` `"scripts"`: `"test": "jest"`, and a jest block:
```json
"jest": { "preset": "jest-expo" }
```

**Step 3:** Smoke the runner (no tests yet → "no tests found" is fine):
```bash
cd mobile && npx jest --passWithNoTests
```
Expected: exits 0.

**Step 4: Commit**
```bash
git add mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): add aws-amplify + jest-expo"
```

### Task 2.1: Add the `AUTH_BACKEND` flag

**Files:**
- Modify: `mobile/lib/featureFlags.ts`

**Step 1:** Append (separate concern from the prod-build gates):
```ts
// Selects the auth/profile data source. 'mock' = today's in-memory demo
// behavior (default; no AWS needed). 'amplify' = real Cognito/AppSync via
// aws-amplify — flip to this after `ampx sandbox` generates amplify_outputs
// (see docs/plans/2026-06-22-swi-backend-auth-profile-design.md, Seção 6).
export type AuthBackendKind = 'mock' | 'amplify';
export const AUTH_BACKEND: AuthBackendKind = 'mock';
```

**Step 2: Commit**
```bash
git add mobile/lib/featureFlags.ts
git commit -m "feat(mobile): add AUTH_BACKEND feature flag (default mock)"
```

### Task 2.2: Define the `AuthBackend` interface + types

**Files:**
- Create: `mobile/services/auth/types.ts`

**Step 1:** Create the file:
```ts
import type { User } from '../types';

export type { User };

export interface SignUpParams { email: string; password: string; name: string; }
export interface SignInParams { email: string; password: string; }
export interface ConfirmSignUpParams { email: string; code: string; }
export interface ResetPasswordParams { email: string; }
export interface ConfirmResetParams { email: string; code: string; newPassword: string; }

export interface SignUpResult {
  /** 'CONFIRM' → a verification code was emailed; 'DONE' → already usable. */
  nextStep: 'CONFIRM' | 'DONE';
}

/** Backend-agnostic auth operations. mock + amplify both implement this. */
export interface AuthBackend {
  signIn(p: SignInParams): Promise<User>;
  signUp(p: SignUpParams): Promise<SignUpResult>;
  confirmSignUp(p: ConfirmSignUpParams): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(p: ResetPasswordParams): Promise<void>;
  confirmReset(p: ConfirmResetParams): Promise<void>;
  getCurrentUser(): Promise<User | null>;
}
```

### Task 2.3: Implement + test `mockAuthBackend` (TDD)

**Files:**
- Create: `mobile/services/auth/mockAuthBackend.ts`
- Test: `mobile/services/auth/mockAuthBackend.test.ts`

**Step 1: Write the failing test**
```ts
import { mockAuthBackend } from './mockAuthBackend';

describe('mockAuthBackend', () => {
  it('signIn returns a user derived from the email', async () => {
    const user = await mockAuthBackend.signIn({ email: 'joao@swi.com', password: 'x' });
    expect(user).toEqual({ id: '1', email: 'joao@swi.com', name: 'joao' });
  });

  it('signUp reports a CONFIRM step', async () => {
    const r = await mockAuthBackend.signUp({ email: 'a@b.com', password: 'x', name: 'Ana Lima' });
    expect(r.nextStep).toBe('CONFIRM');
  });

  it('confirmSignUp / resetPassword / confirmReset resolve without throwing', async () => {
    await expect(mockAuthBackend.confirmSignUp({ email: 'a@b.com', code: '123' })).resolves.toBeUndefined();
    await expect(mockAuthBackend.resetPassword({ email: 'a@b.com' })).resolves.toBeUndefined();
    await expect(mockAuthBackend.confirmReset({ email: 'a@b.com', code: '1', newPassword: 'x' })).resolves.toBeUndefined();
  });
});
```

**Step 2: Run → fails** `cd mobile && npx jest services/auth/mockAuthBackend` → FAIL (module not found).

**Step 3: Implement**
```ts
import type { AuthBackend, User } from './types';

// Preserves the pre-backend demo behavior: no real auth, derive a fake user
// from the email (matches the old AuthProvider.signIn). Async to match the
// AuthBackend contract; resolves instantly.
function userFromEmail(email: string): User {
  return { id: '1', email, name: email.split('@')[0] ?? 'Usuário' };
}

export const mockAuthBackend: AuthBackend = {
  async signIn({ email }) { return userFromEmail(email); },
  async signUp() { return { nextStep: 'CONFIRM' }; },
  async confirmSignUp() {},
  async signOut() {},
  async resetPassword() {},
  async confirmReset() {},
  async getCurrentUser() { return null; },
};
```

**Step 4: Run → passes** `cd mobile && npx jest services/auth/mockAuthBackend` → PASS.

**Step 5: Commit**
```bash
git add mobile/services/auth/types.ts mobile/services/auth/mockAuthBackend.ts mobile/services/auth/mockAuthBackend.test.ts
git commit -m "feat(mobile): AuthBackend interface + mock implementation"
```

### Task 2.4: Implement `amplifyAuthBackend` (typecheck-only — no AWS yet)

**Files:**
- Create: `mobile/services/auth/amplifyAuthBackend.ts`

**Step 1:** Implement against `aws-amplify/auth`:
```ts
import {
  signIn as awsSignIn,
  signUp as awsSignUp,
  confirmSignUp as awsConfirmSignUp,
  signOut as awsSignOut,
  resetPassword as awsResetPassword,
  confirmResetPassword as awsConfirmResetPassword,
  getCurrentUser as awsGetCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import type { AuthBackend, User } from './types';

async function currentUser(): Promise<User | null> {
  try {
    const { userId } = await awsGetCurrentUser();
    const attrs = await fetchUserAttributes();
    return {
      id: userId,
      email: attrs.email ?? '',
      name: attrs.name ?? attrs.email?.split('@')[0] ?? 'Usuário',
    };
  } catch {
    return null;
  }
}

export const amplifyAuthBackend: AuthBackend = {
  async signIn({ email, password }) {
    await awsSignIn({ username: email, password });
    const u = await currentUser();
    if (!u) throw new Error('signIn succeeded but no current user');
    return u;
  },
  async signUp({ email, password, name }) {
    const res = await awsSignUp({
      username: email,
      password,
      options: { userAttributes: { email, name } },
    });
    return { nextStep: res.isSignUpComplete ? 'DONE' : 'CONFIRM' };
  },
  async confirmSignUp({ email, code }) {
    await awsConfirmSignUp({ username: email, confirmationCode: code });
  },
  async signOut() { await awsSignOut(); },
  async resetPassword({ email }) { await awsResetPassword({ username: email }); },
  async confirmReset({ email, code, newPassword }) {
    await awsConfirmResetPassword({ username: email, confirmationCode: code, newPassword });
  },
  getCurrentUser: currentUser,
};
```

**Step 2:** Typecheck the mobile app:
```bash
cd mobile && npx tsc --noEmit
```
Expected: no errors. (Cannot unit-test — needs a live Cognito pool; verified by smoke after deploy, Phase 6.)

**Step 3: Commit**
```bash
git add mobile/services/auth/amplifyAuthBackend.ts
git commit -m "feat(mobile): amplify auth backend (deploy-gated)"
```

### Task 2.5: Refactor `AuthProvider` to be flag-driven (TDD on selection)

**Files:**
- Modify: `mobile/services/auth/AuthProvider.tsx`
- Create: `mobile/services/auth/getAuthBackend.ts`
- Test: `mobile/services/auth/getAuthBackend.test.ts`

**Step 1: Write the failing test** for the selector:
```ts
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));
import { getAuthBackend } from './getAuthBackend';
import { mockAuthBackend } from './mockAuthBackend';

it('returns the mock backend when the flag is mock', () => {
  expect(getAuthBackend()).toBe(mockAuthBackend);
});
```

**Step 2: Run → fails.**

**Step 3: Implement the selector**
```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { AuthBackend } from './types';
import { mockAuthBackend } from './mockAuthBackend';
import { amplifyAuthBackend } from './amplifyAuthBackend';

export function getAuthBackend(): AuthBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyAuthBackend : mockAuthBackend;
}
```

**Step 4: Run → passes.**

**Step 5:** Rewrite `AuthProvider.tsx` to expose the full async surface while keeping `useAuth()` as the consumer API. Preserve the stable-identity note. New contract:
```tsx
import {
  createContext, useCallback, useContext, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { User } from '../types';
import type {
  SignUpParams, SignInParams, ConfirmSignUpParams,
  ResetPasswordParams, ConfirmResetParams, SignUpResult,
} from './types';
import { getAuthBackend } from './getAuthBackend';

interface AuthState {
  user: User | null;
  signIn: (p: SignInParams) => Promise<User>;
  signUp: (p: SignUpParams) => Promise<SignUpResult>;
  confirmSignUp: (p: ConfirmSignUpParams) => Promise<void>;
  resetPassword: (p: ResetPasswordParams) => Promise<void>;
  confirmReset: (p: ConfirmResetParams) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const backend = useMemo(() => getAuthBackend(), []);

  const signIn = useCallback(async (p: SignInParams) => {
    const u = await backend.signIn(p);
    setUser((prev) => (prev && prev.email === u.email ? prev : u));
    return u;
  }, [backend]);

  const signUp = useCallback((p: SignUpParams) => backend.signUp(p), [backend]);
  const confirmSignUp = useCallback((p: ConfirmSignUpParams) => backend.confirmSignUp(p), [backend]);
  const resetPassword = useCallback((p: ResetPasswordParams) => backend.resetPassword(p), [backend]);
  const confirmReset = useCallback((p: ConfirmResetParams) => backend.confirmReset(p), [backend]);
  const signOut = useCallback(async () => { await backend.signOut(); setUser(null); }, [backend]);

  const value = useMemo<AuthState>(
    () => ({ user, signIn, signUp, confirmSignUp, resetPassword, confirmReset, signOut }),
    [user, signIn, signUp, confirmSignUp, resetPassword, confirmReset, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

**Step 6:** Typecheck — expect errors at the old call-sites (`signIn(email)` now needs `{email,password}`). Those are fixed in Phase 4. Run `cd mobile && npx jest` (selector + mock tests) → PASS.

**Step 7: Commit**
```bash
git add mobile/services/auth/getAuthBackend.ts mobile/services/auth/getAuthBackend.test.ts mobile/services/auth/AuthProvider.tsx
git commit -m "feat(mobile): flag-driven AuthProvider with async surface"
```

### Task 2.6: Guard `Amplify.configure` in the root layout

**Files:**
- Create: `mobile/services/amplify/configure.ts`
- Modify: `mobile/app/_layout.tsx`

**Step 1:** Create a guarded configurator:
```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';

// Only configures Amplify when the flag is 'amplify' AND the generated
// outputs file exists. Until `ampx sandbox` runs (Phase 6), the require
// throws and we no-op — the mock path needs no Amplify init.
export function configureAmplify(): void {
  if (AUTH_BACKEND !== 'amplify') return;
  try {
    const { Amplify } = require('aws-amplify');
    // amplify_outputs.json is copied into mobile/ post-deploy (gitignored).
    const outputs = require('../../amplify_outputs.json');
    Amplify.configure(outputs);
  } catch (e) {
    console.warn('[amplify] outputs not found; staying unconfigured', e);
  }
}
```

**Step 2:** In `mobile/app/_layout.tsx`, call it once at module scope, right after `SplashScreen.preventAutoHideAsync();`:
```ts
import { configureAmplify } from '../services/amplify/configure';
configureAmplify();
```

**Step 3:** Typecheck (screen call-sites still error until Phase 4):
```bash
cd mobile && npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add mobile/services/amplify/configure.ts mobile/app/_layout.tsx
git commit -m "feat(mobile): guarded Amplify.configure (no-op in mock mode)"
```

---

## Phase 3 — Mobile: profile abstraction

### Task 3.1: Profile types + interface

**Files:**
- Create: `mobile/services/profile/types.ts`

```ts
// Local mirror of the swi-backend Profile model. Siblings are isolated, so
// we do NOT import the backend Schema type; after deploy, `ampx generate
// graphql-client-code --out` can replace this with generated types (Phase 6).
export interface Profile {
  fullName?: string;
  phone?: string;
  cpf?: string;
  birthDate?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
}

export interface ProfileBackend {
  get(): Promise<Profile | null>;
  save(patch: Profile): Promise<Profile>;
}
```

### Task 3.2: `mockProfileBackend` (TDD)

**Files:**
- Create: `mobile/services/profile/mockProfileBackend.ts`
- Test: `mobile/services/profile/mockProfileBackend.test.ts`

**Step 1: Failing test**
```ts
import { mockProfileBackend } from './mockProfileBackend';

it('save merges and get returns the merged profile', async () => {
  await mockProfileBackend.save({ fullName: 'Ana' });
  await mockProfileBackend.save({ city: 'São Paulo' });
  expect(await mockProfileBackend.get()).toMatchObject({ fullName: 'Ana', city: 'São Paulo' });
});
```

**Step 2: Run → fails.**

**Step 3: Implement** (in-memory; no persistence backend in the demo):
```ts
import type { Profile, ProfileBackend } from './types';

let store: Profile = {};

export const mockProfileBackend: ProfileBackend = {
  async get() { return Object.keys(store).length ? { ...store } : null; },
  async save(patch) { store = { ...store, ...patch }; return { ...store }; },
};
```

**Step 4: Run → passes. Commit**
```bash
git add mobile/services/profile/types.ts mobile/services/profile/mockProfileBackend.ts mobile/services/profile/mockProfileBackend.test.ts
git commit -m "feat(mobile): ProfileBackend interface + mock implementation"
```

### Task 3.3: `amplifyProfileBackend` (typecheck-only) + selector + provider

**Files:**
- Create: `mobile/services/profile/amplifyProfileBackend.ts`
- Create: `mobile/services/profile/getProfileBackend.ts`
- Create: `mobile/services/profile/ProfileProvider.tsx`
- Modify: `mobile/app/_layout.tsx` (mount provider inside `<AuthProvider>`)

**Step 1:** `amplifyProfileBackend.ts` — untyped client (isolation: no backend import), owner-scoped single profile per user:
```ts
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
```

**Step 2:** `getProfileBackend.ts`:
```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';
import { amplifyProfileBackend } from './amplifyProfileBackend';

export function getProfileBackend(): ProfileBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyProfileBackend : mockProfileBackend;
}
```

**Step 3:** `ProfileProvider.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Profile } from './types';
import { getProfileBackend } from './getProfileBackend';

interface ProfileState {
  profile: Profile | null;
  loadProfile: () => Promise<Profile | null>;
  saveProfile: (patch: Profile) => Promise<Profile>;
}
const ProfileContext = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const backend = useMemo(() => getProfileBackend(), []);

  const loadProfile = useCallback(async () => {
    const p = await backend.get(); setProfile(p); return p;
  }, [backend]);
  const saveProfile = useCallback(async (patch: Profile) => {
    const p = await backend.save(patch); setProfile(p); return p;
  }, [backend]);

  const value = useMemo<ProfileState>(() => ({ profile, loadProfile, saveProfile }), [profile, loadProfile, saveProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
```

**Step 4:** In `mobile/app/_layout.tsx`, wrap the Stack: `<AuthProvider><ProfileProvider>…</ProfileProvider></AuthProvider>`.

**Step 5:** Typecheck + tests:
```bash
cd mobile && npx tsc --noEmit   # still expect screen call-site errors (Phase 4)
cd mobile && npx jest           # all unit tests PASS
```

**Step 6: Commit**
```bash
git add mobile/services/profile mobile/app/_layout.tsx
git commit -m "feat(mobile): flag-driven ProfileProvider (mock + amplify)"
```

---

## Phase 4 — Wire the screens to the new API

> After this phase `npx tsc --noEmit` in `mobile/` must be clean. Each task: edit, typecheck, commit. The mock path must keep the exact current demo navigation.

### Task 4.1: `login.tsx`

**Modify:** `mobile/app/(auth)/login.tsx`
- `handleLogin` becomes async; replace `signIn(email.value); router.replace('/(app)/dashboard');` with:
```ts
try {
  await signIn({ email: email.value, password: password.value });
  router.replace('/(app)/dashboard');
} catch (e) {
  // Surface via DS Toast/Alert — "Email ou senha inválidos". No hardcoded styles.
}
```
- Typecheck → clean for this file. Commit `fix(mobile): login uses async signIn({email,password})`.

### Task 4.2: `sign-up.tsx`

**Modify:** `mobile/app/(auth)/sign-up.tsx`
- Add `const { signUp } = useAuth();`. `handleSubmit` becomes async; replace the navigation block with:
```ts
const username = fullName.value.trim().split(/\s+/)[0] ?? '';
try {
  await signUp({ email: email.value, password: password.value, name: fullName.value.trim() });
  router.push({ pathname: '/(auth)/email-sent', params: { email: email.value, username } });
} catch (e) {
  // DS Toast/Alert: "Não foi possível criar a conta"
}
```
- In mock mode `signUp` is a no-op returning CONFIRM, so the demo flow is unchanged.
- Typecheck → clean. Commit `feat(mobile): sign-up calls signUp before email-sent`.

### Task 4.3: `email-sent.tsx` (confirmation-code entry in amplify mode)

**Modify:** `mobile/app/(auth)/email-sent.tsx`
- Mock mode: keep the current auto-advance to `account-confirmation` (no code).
- Amplify mode (`AUTH_BACKEND === 'amplify'`): disable the auto-advance timer; render a DS `Input` for the code + a DS `Button` "Confirmar". On press: `await confirmSignUp({ email, code }); router.replace({ pathname: '/(auth)/account-confirmation', params: { username, email } })`.
- Use `import { AUTH_BACKEND } from '../../lib/featureFlags'` and `useAuth().confirmSignUp`.
- Typecheck → clean. Commit `feat(mobile): email-sent confirms signup code in amplify mode`.

### Task 4.4: `account-confirmation.tsx`

**Modify:** `mobile/app/(auth)/account-confirmation.tsx`
- The `signIn` call must match the new signature. Only the mock path needs it here (amplify already authenticated on the previous screen):
```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
...
if (AUTH_BACKEND === 'mock' && email) { void signIn({ email, password: '' }); }
```
- Typecheck → clean. Commit `fix(mobile): account-confirmation matches new signIn signature`.

### Task 4.5: `password-recovery/email.tsx`

**Modify:** `mobile/app/(auth)/password-recovery/email.tsx`
- Add `const { resetPassword } = useAuth();`. `handleSubmit` async; in amplify mode `await resetPassword({ email: email.value })` before navigating; pass `email` onward (already does). Mock mode: unchanged.
- Typecheck → clean. Commit `feat(mobile): password-recovery email triggers resetPassword (amplify)`.

### Task 4.6: `password-recovery/new-password.tsx` (+ recovery `email-sent`)

**Modify:** `mobile/app/(auth)/password-recovery/new-password.tsx`, `mobile/app/(auth)/password-recovery/email-sent.tsx`
- Thread `email` param through `email-sent` into `new-password`.
- Amplify mode: add a DS `Input` for the reset code; on submit `await confirmReset({ email, code, newPassword: password.value })` then `router.replace('/(auth)/login')`. Mock mode: keep current `router.replace('/(auth)/login')`.
- Use `useLocalSearchParams` for `email`; `useAuth().confirmReset`.
- Typecheck → clean. Commit `feat(mobile): new-password confirms reset code (amplify mode)`.

### Task 4.7: complimentary-data `step-1` + `step-2` → ProfileProvider

**Modify:** `mobile/app/(auth)/complimentary-data/step-1.tsx`, `step-2.tsx`
- On each step's "continue", `await saveProfile({ ...fieldsForThisStep })` (from `useProfile()`) before navigating. step-1 saves `fullName, phone, cpf, birthDate`; step-2 saves `cep, street, number, complement, neighborhood, city, uf`. Mock mode writes the in-memory store (demo unaffected); amplify mode creates/updates the DynamoDB `Profile`.
- step-3 (health) is OUT of scope — leave it on its current mock behavior.
- Typecheck → clean. Run `cd mobile && npx jest`. Commit `feat(mobile): complementary-data steps 1-2 persist via ProfileProvider`.

---

## Phase 5 — Verify the slice (mock path, no AWS)

### Task 5.1: Full typecheck + tests
```bash
cd mobile && npx tsc --noEmit        # expect: clean
cd mobile && npx jest                # expect: all PASS
cd swi-backend && npx tsc --noEmit   # expect: clean
```

### Task 5.2: Manual mock-path smoke
- `cd mobile && npx expo start --web`, walk: login → dashboard; sign-up → email-sent → account-confirmation → step-1 → step-2 (profile saved in memory) → step-3 → dashboard; password-recovery happy path. Confirm behavior is identical to before (flag = mock).

### Task 5.3: Update design doc status + commit
- In `docs/plans/2026-06-22-swi-backend-auth-profile-design.md`, set Status → "implementado (mock path); deploy pendente (Phase 6)".
- Commit `docs(backend): mark Fatia 1 implemented (mock path)`.

---

## Phase 6 — Deploy runbook (DEFERRED — needs an AWS account; do NOT run now)

When an AWS account + credentials exist:
1. `aws configure` (or SSO) on this machine — **user action, interactive** (suggest `! aws configure`).
2. `cd swi-backend && npm install && npx ampx sandbox` → provisions Cognito + DynamoDB + AppSync; writes `swi-backend/amplify_outputs.json`.
3. Copy outputs to the app: `cp swi-backend/amplify_outputs.json mobile/amplify_outputs.json` (gitignored, per-env).
4. (Optional, isolation-friendly typing) `cd swi-backend && npx ampx generate graphql-client-code --out ../mobile/services/profile/generated` and swap the untyped client for the generated types.
5. Flip the flag: `AUTH_BACKEND = 'amplify'` in `mobile/lib/featureFlags.ts`.
6. Smoke on a device/emulator: sign-up → receive code by email → confirm → sign-in → fill steps 1-2 → verify the `Profile` row in DynamoDB (AWS console / `ampx`).
7. Create `worker`/`admin` group memberships in the Cognito console as needed for testing.

Cost: sandbox + DynamoDB on-demand + Cognito free tier ≈ **US$0 idle** (scale-to-zero). Production pipeline deploy (`ampx pipeline-deploy`) is a later slice.

### Amplify-flow prerequisites (surfaced by the Phase 4a code review — resolve BEFORE flipping the flag)
These are coherence gaps in the deploy-gated amplify navigation that can only be validated against a live Cognito pool. The mock demo is unaffected.
1. **Signup → onboarding entry.** `app/(auth)/email-sent.tsx` (amplify) routes to `/login` after `confirmSignUp`, which SKIPS `account-confirmation` and the `complimentary-data` onboarding wizard the mock flow enters. Decide: auto-sign-in + route to `account-confirmation` (parity with mock, so the worker fills their profile), or trigger onboarding on first authenticated launch. (TODO at the call-site.)
2. **Recovery is code-based, not link-based.** `app/(auth)/password-recovery/email-sent.tsx` auto-advances magic-link-style; Cognito `resetPassword` emails a CODE entered on `new-password`. Gate this screen for amplify (skip the timer / bypass it) so the code flow is coherent. (TODO at the call-site.)
3. **`birthDate` format.** The mobile form masks `DD/MM/YYYY`; the backend `Profile.birthDate` is `AWSDate` (`YYYY-MM-DD`). Convert before `saveProfile` in the amplify path. (TODO in step-1 wiring.)
4. **Profile single-row invariant.** `amplifyProfileBackend.save` does get-then-create (not atomic); confirm only one `Profile` row per worker exists after the smoke.

---

## Notes for the executor
- If `useField` can't display an external (server) error, prefer a DS `Toast`/`Alert` for auth failures — never hardcode error styling.
- Keep the mock path behavior byte-for-byte where the design says "demo unchanged".
- `aws-amplify` v6 API names are used above; if a name differs in the installed version, check `node_modules/aws-amplify/auth` exports and adjust (do not guess).
- All these docs (`2026-06-22-swi-backend-*`) are temporary — delete when the whole backend is done (user decision, 2026-06-22).
