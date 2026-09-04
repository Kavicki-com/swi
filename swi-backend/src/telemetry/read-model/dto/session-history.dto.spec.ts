import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { SessionHistoryQueryDto } from './session-history.dto'

// A recusa de limite zero na entrada é o que impede a rota de pedir uma página
// que não existe. O serviço também se protege, mas por outro motivo: ele é
// público e tem chamadores fora da rota. As duas guardas são de donos
// diferentes e nenhuma torna a outra dispensável.

const limitErrs = async (query: object) => {
  const errs = await validate(plainToInstance(SessionHistoryQueryDto, query))
  return errs.filter((e) => e.property === 'limit').length
}

describe('SessionHistoryQueryDto', () => {
  it('recusa limite zero: página de tamanho nenhum não é pedido válido', async () => {
    expect(await limitErrs({ limit: 0 })).toBeGreaterThan(0)
  })

  it('recusa limite acima do teto', async () => {
    expect(await limitErrs({ limit: 501 })).toBeGreaterThan(0)
  })

  it('aceita limite dentro da faixa, inclusive vindo como texto da query string', async () => {
    expect(await limitErrs({ limit: 1 })).toBe(0)
    expect(await limitErrs({ limit: 500 })).toBe(0)
    expect(await limitErrs({ limit: '200' })).toBe(0)
  })

  it('aceita ausência de limite: a rota tem padrão próprio', async () => {
    expect(await limitErrs({})).toBe(0)
  })
})
