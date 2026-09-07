// Os decoradores do DTO precisam do Reflect estendido. Antes, ele chegava de
// carona: o DTO importava o serviço de consulta, que arrasta o Nest, que
// carrega reflect-metadata. Cortada essa dependência, a carona acabou, e a
// necessidade fica declarada aqui, que é onde ela é.
import 'reflect-metadata'
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

// O DTO importava o teto de paginação do serviço de consulta, e como valor, não
// como tipo. Quem carregava o DTO carregava o serviço inteiro atrás, com o
// cliente do Prisma e o projetor junto: um teste de unidade do DTO subia banco
// sem precisar, e um pacote de contrato compartilhado com o mobile não
// conseguiria levar o DTO sem levar o backend.
describe('SessionHistoryQueryDto: carregar o DTO não carrega o backend', () => {
  it('não puxa o serviço de consulta nem o cliente do Prisma', () => {
    // Sem limpar o registro: este arquivo só importa o DTO e os dois pacotes de
    // validação, então o que aparecer aqui foi o DTO que puxou. Limpar levaria
    // reflect-metadata junto e os decoradores parariam de existir.
    jest.isolateModules(() => {
      // require, e não import: o que se mede é o grafo que a carga do DTO puxa,
      // e um import estático no topo já teria carregado tudo antes do caso rodar.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./session-history.dto')
    })

    const arrastados = Object.keys(require.cache).filter(
      (p) => p.includes('telemetry-query.service') || p.includes('prisma.service') || p.includes('telemetry-projector'),
    )
    expect(arrastados).toEqual([])
  })
})
