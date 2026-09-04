import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import type { DeviceRequest } from './device-auth.guard'
import type { DeviceIdentity } from './device-auth.service'

// Lê a identidade que o DeviceAuthGuard pendurou na request. É o par do
// CurrentUser das rotas de pessoa: quem mede vem daqui, nunca do corpo.

export const currentDeviceFactory = (_: unknown, ctx: ExecutionContext): DeviceIdentity => {
  const { device } = ctx.switchToHttp().getRequest<DeviceRequest>()
  // Falha fechada: sem o guard na rota, o serviço receberia undefined e
  // gravaria evento sem dono. Melhor recusar do que atribuir a ninguém.
  if (device === undefined) {
    throw new UnauthorizedException('Credencial de dispositivo inválida')
  }
  return device
}

export const CurrentDevice = createParamDecorator(currentDeviceFactory)
