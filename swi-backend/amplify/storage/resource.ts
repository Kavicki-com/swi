import { defineStorage } from '@aws-amplify/backend';

// Anexos de relatórios. Worker autenticado lê; o dono escreve no próprio prefixo.
export const storage = defineStorage({
  name: 'swiReportsMedia',
  access: (allow) => ({
    'reports/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
