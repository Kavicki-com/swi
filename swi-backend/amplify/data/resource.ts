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
