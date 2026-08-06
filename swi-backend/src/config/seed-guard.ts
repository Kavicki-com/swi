// Guarda do seed de desenvolvimento.
//
// O seed cria contas de demonstração com senha conhecida e dados fabricados.
// Contra um banco de produção isso não é "popular dados": é abrir uma conta
// administrativa com credencial pública. Por isso são duas condições
// independentes, e a ausência de NODE_ENV conta como perigo, não como dev.

export function assertSeedAllowed(env: NodeJS.ProcessEnv): void {
  const nodeEnv = env.NODE_ENV
  if (!nodeEnv) {
    throw new Error('Seed recusado: NODE_ENV não está definido. Declare development ou test explicitamente.')
  }
  if (nodeEnv === 'production') {
    throw new Error('Seed recusado: não roda em produção, nem com ALLOW_DEV_SEED=1.')
  }
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Seed recusado: NODE_ENV precisa ser development ou test.')
  }
  if (env.ALLOW_DEV_SEED !== '1') {
    throw new Error('Seed recusado: defina ALLOW_DEV_SEED=1 para confirmar que este banco é descartável.')
  }
}
