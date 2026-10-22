import { BadRequestException } from '@nestjs/common'
import type { JwtUser } from '../../auth/current-user.decorator'
import { HelpRequestController } from './help-request.controller'
import type { HelpRequestService } from './help-request.service'

// Quem pede e de quem é o pedido saem do token; a chave de idempotência vem do
// cabeçalho e passa pela mesma validação das outras rotas do app.

const worker = { userId: 'worker-1', companyId: 'empresa-1', role: 'WORKER' } as JwtUser
const service = () =>
  ({
    request: jest.fn().mockResolvedValue({ id: 'help-1' }),
    mine: jest.fn().mockResolvedValue(null),
  }) as unknown as jest.Mocked<HelpRequestService>

describe('HelpRequestController', () => {
  it('pede ajuda pelo funcionário do token, com a chave do cabeçalho', async () => {
    const s = service()
    await new HelpRequestController(s).request(worker, '6F1C2B0E-8A4D-4C3E-9B1A-2D3E4F5A6B7C')
    expect(s.request).toHaveBeenCalledWith('worker-1', '6f1c2b0e-8a4d-4c3e-9b1a-2d3e4f5a6b7c')
  })

  it('sem chave pede sem proteção; chave fora do formato é 400', async () => {
    const s = service()
    await new HelpRequestController(s).request(worker, undefined)
    expect(s.request).toHaveBeenCalledWith('worker-1', undefined)
    expect(() => new HelpRequestController(s).request(worker, 'nao-e-uuid')).toThrow(BadRequestException)
  })

  it('lê só o próprio pedido, embrulhado em helpRequest', async () => {
    const s = service()
    expect(await new HelpRequestController(s).mine(worker)).toEqual({ helpRequest: null })
    expect(s.mine).toHaveBeenCalledWith('worker-1')
  })
})
