import { NotFoundException } from '@nestjs/common'
import type { Response } from 'express'
import { ReportsController } from './reports.controller'
import type { ReportsService } from './reports.service'
import type { JwtUser } from '../auth/current-user.decorator'

// Três decisões vivem aqui e não no serviço: a paginação vinda da query vira
// número ou undefined (nunca NaN), o total sai em header exposto ao browser, e
// relatório inexistente vira 404 em vez de null no corpo.

const service = () =>
  ({
    list: jest.fn().mockResolvedValue({ items: [{ id: 'r1' }], total: 42 }),
    listAssignees: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 'r1' }),
    create: jest.fn().mockResolvedValue({ id: 'r1' }),
    update: jest.fn().mockResolvedValue({ id: 'r1' }),
    remove: jest.fn().mockResolvedValue(undefined),
    addComment: jest.fn().mockResolvedValue({ id: 'c1' }),
  }) as unknown as jest.Mocked<ReportsService>

const res = () => ({ setHeader: jest.fn() }) as unknown as Response & { setHeader: jest.Mock }
const user = { userId: 'u1', companyId: 'empresa-1', role: 'WORKER' } as unknown as JwtUser

describe('ReportsController', () => {
  it('lista no escopo da empresa e publica o total num header que o browser enxerga', async () => {
    const s = service()
    const r = res()

    await expect(new ReportsController(s).list(user, r, '10', '20')).resolves.toEqual([{ id: 'r1' }])

    expect(s.list).toHaveBeenCalledWith('empresa-1', { limit: 10, offset: 20 })
    expect(r.setHeader).toHaveBeenCalledWith('X-Total-Count', '42')
    expect(r.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', 'X-Total-Count')
  })

  it('sem limit/offset na query passa undefined, não NaN', async () => {
    const s = service()
    await new ReportsController(s).list(user, res())
    expect(s.list).toHaveBeenCalledWith('empresa-1', { limit: undefined, offset: undefined })
  })

  it('responsáveis atribuíveis saem do par usuário/empresa do token', async () => {
    const s = service()
    await new ReportsController(s).listAssignees(user)
    expect(s.listAssignees).toHaveBeenCalledWith('u1', 'empresa-1')
  })

  it('relatório de outra empresa (ou inexistente) vira 404, não corpo nulo', async () => {
    const s = service()
    s.get.mockResolvedValue(null)
    await expect(new ReportsController(s).get('r9', user)).rejects.toBeInstanceOf(NotFoundException)
    expect(s.get).toHaveBeenCalledWith('r9', 'empresa-1')
  })

  it('criar, atualizar e comentar usam a identidade do token', async () => {
    const s = service()
    const c = new ReportsController(s)

    await c.create('u1', { title: 'T' })
    await c.update('r1', user, { title: 'T2' })
    await c.addComment('r1', 'u1', { body: 'oi' })

    expect(s.create).toHaveBeenCalledWith('u1', { title: 'T' })
    expect(s.update).toHaveBeenCalledWith('r1', 'u1', { title: 'T2' }, 'empresa-1')
    expect(s.addComment).toHaveBeenCalledWith('r1', 'u1', { body: 'oi' })
  })

  // Quem pode excluir é decisão do serviço (autor ou ADMIN), mas o controller
  // precisa entregar a ele os três dados do token (id, papel e empresa),
  // senão a régua de autorização não teria como ser aplicada.
  it('excluir repassa id, papel e empresa do token ao serviço', async () => {
    const s = service()
    await new ReportsController(s).remove('r1', user)
    expect(s.remove).toHaveBeenCalledWith('r1', 'u1', 'WORKER', 'empresa-1')
  })
})
