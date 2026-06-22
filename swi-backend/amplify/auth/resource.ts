import { defineAuth } from '@aws-amplify/backend';

/**
 * Worker authentication for the SWI mobile app.
 * - Email + password login with self sign-up and email-code confirmation
 *   (Cognito default email; SES is a later-slice upgrade for volume).
 * - Groups gate authorization in data/resource.ts. NOTE: Cognito does NOT
 *   auto-assign a group on self sign-up — assigning `worker` requires a
 *   post-confirmation Lambda trigger, DEFERRED to the admin-tooling slice
 *   (see plan Phase 6 prerequisites). For now self-signed-up users are
 *   group-less (fine: Profile uses owner-auth, not group-auth), and `admin`
 *   (occupational health) is assigned manually in the Cognito console.
 */
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['admin', 'worker'],
});
