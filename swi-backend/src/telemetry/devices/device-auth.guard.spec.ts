import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { DeviceAuthGuard, type DeviceRequest } from './device-auth.guard'
import type { DeviceAuthService } from './device-auth.service'

// O guard existe para uma coisa só: transformar um cabeçalho em identidade
// verificada e pendurá-la na request. Quem decide se a credencial vale é o
// serviço; aqui o que se prova é que nada passa sem essa decisão.

const context = (headers: Record<string, string | undefined>) => {
  const request = { headers } as unknown as DeviceRequest
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext,
    request,
  }
}

const serviceDouble = (authenticate: DeviceAuthService['authenticate']) =>
  ({ authenticate }) as DeviceAuthService

describe('DeviceAuthGuard', () => {
  it('anexa a identidade verificada na request e libera a rota', async () => {
    const identity = { deviceId: 'device-1', workerId: 'worker-1' }
    const { ctx, request } = context({ authorization: 'Device device-1.segredo' })
    const guard = new DeviceAuthGuard(serviceDouble(async () => identity))

    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(request.device).toEqual(identity)
  })

  it('repassa o cabeçalho recebido ao serviço, sem interpretá-lo', async () => {
    const authenticate = jest.fn().mockResolvedValue({ deviceId: 'd', workerId: 'w' })
    const { ctx } = context({ authorization: 'Device device-1.segredo' })

    await new DeviceAuthGuard(serviceDouble(authenticate)).canActivate(ctx)

    expect(authenticate).toHaveBeenCalledWith('Device device-1.segredo')
  })

  it('não libera a rota quando o serviço recusa a credencial', async () => {
    const { ctx, request } = context({ authorization: 'Device device-1.errado' })
    const guard = new DeviceAuthGuard(
      serviceDouble(async () => {
        throw new UnauthorizedException('Credencial de dispositivo inválida')
      }),
    )

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(request.device).toBeUndefined()
  })
})
