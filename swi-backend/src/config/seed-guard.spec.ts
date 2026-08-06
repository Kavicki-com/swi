import { assertSeedAllowed } from './seed-guard'

describe('assertSeedAllowed', () => {
  // O seed cria contas de demonstração com senha conhecida. Rodá-lo contra um
  // banco de produção não é "popular dados": é abrir uma conta administrativa
  // com credencial pública.
  it('recusa seed em produção mesmo com ALLOW_DEV_SEED=1', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', ALLOW_DEV_SEED: '1' })).toThrow(/produção/)
  })

  it('recusa seed em desenvolvimento sem ALLOW_DEV_SEED', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/ALLOW_DEV_SEED/)
    expect(() => assertSeedAllowed({ NODE_ENV: 'development', ALLOW_DEV_SEED: '0' })).toThrow(/ALLOW_DEV_SEED/)
  })

  it('permite seed em desenvolvimento e teste com a flag explícita', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development', ALLOW_DEV_SEED: '1' })).not.toThrow()
    expect(() => assertSeedAllowed({ NODE_ENV: 'test', ALLOW_DEV_SEED: '1' })).not.toThrow()
  })

  it('recusa ambiente ausente em vez de assumir desenvolvimento', () => {
    // NODE_ENV vazio é o caso de um shell de produção onde ninguém exportou a
    // variável. Assumir dev aqui seria assumir o cenário mais perigoso.
    expect(() => assertSeedAllowed({ ALLOW_DEV_SEED: '1' })).toThrow(/NODE_ENV/)
  })
})
