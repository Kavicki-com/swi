import { logLevelsFor } from './log-levels'

describe('logLevelsFor', () => {
  // Depuração descreve o que o motor de saúde fez com cada sessão. Em produção
  // esse nível fica desligado; o que sobra é o que alguém precisa ler.
  it('produção fica sem debug e sem verbose', () => {
    const levels = logLevelsFor('production')
    expect(levels).toEqual(['fatal', 'error', 'warn', 'log'])
  })

  it.each(['development', 'test'] as const)('%s mantém todos os níveis', (env) => {
    const levels = logLevelsFor(env)
    expect(levels).toContain('debug')
    expect(levels).toContain('verbose')
  })
})
