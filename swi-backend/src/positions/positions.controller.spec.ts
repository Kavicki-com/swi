import { ForbiddenException } from '@nestjs/common'
import { PositionsController } from './positions.controller'
import type { PositionsService } from './positions.service'
import type { PositionHistoryService } from './position-history.service'

// Mapa de calor: a equipe do painel escolhe a janela; o funcionário lê só a
// consulta padrão. Quem chega aqui já passou pelo RolesGuard.
describe('PositionsController.heat', () => {
  const setup = () => {
    const history = { heat: jest.fn().mockResolvedValue({ cells: [] }) }
    const c = new PositionsController({} as PositionsService, history as unknown as PositionHistoryService)
    return { c, history }
  }
  const janela = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }

  it.each(['ADMIN', 'SUPERVISOR'])('%s escolhe a janela e lê o balde legado de quem não tem empresa', async (role) => {
    const { c, history } = setup()
    await c.heat({ userId: 'u1', role, companyId: 'c1' }, janela)
    expect(history.heat).toHaveBeenCalledWith('c1', janela, { includeSim: false, noCompany: 'legacy-bucket' }, expect.any(Date))
  })

  it('o funcionário não escolhe a janela', () => {
    const { c, history } = setup()
    expect(() => c.heat({ userId: 'w1', role: 'WORKER', companyId: 'c1' }, janela)).toThrow(ForbiddenException)
    expect(history.heat).not.toHaveBeenCalled()
  })
})
