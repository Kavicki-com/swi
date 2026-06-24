import { defineFunction, secret } from '@aws-amplify/backend';

// 2ª Lambda do projeto. Passagem deploy-gated p/ o Mapbox Directions (walking).
// O token vem de um secret (setado no deploy via `ampx sandbox secret`).
export const route = defineFunction({
  name: 'route',
  entry: './handler.ts',
  environment: {
    MAPBOX_TOKEN: secret('MAPBOX_TOKEN'),
  },
  timeoutSeconds: 15,
  runtime: 20,
});
