// Seleciona a fonte de dados do swi-admin: 'mock' (default, demo in-memory, sem AWS)
// ou 'amplify' (Cognito/AppSync, flip pós-deploy). Espelha o DATA_BACKEND do mobile;
// apps isolados, cada um tem o seu. Deploy-gated: o amplify path são stubs até deploy.
export type DataBackendKind = 'mock' | 'amplify'
export const DATA_BACKEND: DataBackendKind = 'mock'
