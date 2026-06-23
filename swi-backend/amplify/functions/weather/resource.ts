import { defineFunction, secret } from '@aws-amplify/backend';

// 1ª Lambda do projeto. Passagem deploy-gated p/ a OpenWeather One Call 3.0.
// A chave vem de um secret (setado no deploy via `ampx sandbox secret`).
export const weather = defineFunction({
  name: 'weather',
  entry: './handler.ts',
  environment: {
    OPENWEATHER_API_KEY: secret('OPENWEATHER_API_KEY'),
  },
  timeoutSeconds: 15,
  runtime: 20,
});
