import { PushController } from './push.controller'
import type { PushService } from './push.service'

// O dono do token vem sempre do JWT, nunca do corpo: é isso que impede um
// usuário de registrar ou remover aparelho em nome de outro.
const service = () =>
  ({
    register: jest.fn().mockResolvedValue(undefined),
    unregister: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<PushService>

describe('PushController', () => {
  it('registra o token para o usuário do token de acesso', async () => {
    const s = service()
    await new PushController(s).register('u1', { token: 'ExpoPushToken[a]', platform: 'android' })
    expect(s.register).toHaveBeenCalledWith('u1', 'ExpoPushToken[a]', 'android')
  })

  it('remove o token só no escopo do usuário do token de acesso', async () => {
    const s = service()
    await new PushController(s).remove('u1', { token: 'ExpoPushToken[a]' })
    expect(s.unregister).toHaveBeenCalledWith('u1', 'ExpoPushToken[a]')
  })
})
