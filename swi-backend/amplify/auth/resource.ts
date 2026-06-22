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
