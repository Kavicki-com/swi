import { NotificationController } from './notification.controller'
import type { NotificationService } from './notification.service'
import type { JwtUser } from '../auth/current-user.decorator'

// O ponto sensível aqui é o "Solicitar Pausa": o destinatário vem do corpo
// (workerId), mas a EMPRESA vem do token. É esse par que impede um admin de
// disparar pausa para um trabalhador de outra organização.

const service = () =>
  ({
    list: jest.fn().mockResolvedValue([]),
    requestPause: jest.fn().mockResolvedValue(undefined),
    markAllRead: jest.fn().mockResolvedValue(undefined),
    markRead: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<NotificationService>

const admin = { userId: 'admin-1', companyId: 'empresa-1', role: 'ADMIN' } as unknown as JwtUser

describe('NotificationController', () => {
  it('lista as notificações do usuário do token', async () => {
    const s = service()
    await new NotificationController(s).list('u1')
    expect(s.list).toHaveBeenCalledWith('u1')
  })

  it('pausa: alvo vem do corpo, empresa vem do token', async () => {
    const s = service()
    await new NotificationController(s).pauseRequest(admin, { workerId: 'worker-9' })
    expect(s.requestPause).toHaveBeenCalledWith('worker-9', 'empresa-1')
  })

  it('marcar tudo lido e marcar uma lida são escopados no usuário do token', async () => {
    const s = service()
    const c = new NotificationController(s)

    await c.markAllRead('u1')
    await c.markRead('u1', 'n1')

    expect(s.markAllRead).toHaveBeenCalledWith('u1')
    expect(s.markRead).toHaveBeenCalledWith('u1', 'n1')
  })
})
