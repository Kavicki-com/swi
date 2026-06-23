import { defineStorage } from '@aws-amplify/backend';

// Anexos de relatórios + fotos de tarefas. Worker autenticado lê; o dono
// escreve no próprio prefixo. Um bucket, prefixo por domínio.
export const storage = defineStorage({
  name: 'swiMedia',
  access: (allow) => ({
    'reports/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    'journey/{entity_id}/*': [
      allow.authenticated.to(['read']),
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
