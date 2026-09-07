import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { DeviceAuthService, type DeviceIdentity } from './device-auth.service'

/** A request depois do guard: identidade verificada, nunca declarada. */
export interface DeviceRequest {
  headers: Record<string, string | undefined>
  device?: DeviceIdentity
}

/**
 * Guard das rotas que o aparelho chama sozinho, sem JWT de pessoa. Ele não
 * interpreta a credencial: entrega o cabeçalho ao serviço e pendura o resultado
 * na request, para que a ingestão leia o funcionário de um lugar só.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly devices: DeviceAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<DeviceRequest>()
    request.device = await this.devices.authenticate(request.headers.authorization)
    return true
  }
}
