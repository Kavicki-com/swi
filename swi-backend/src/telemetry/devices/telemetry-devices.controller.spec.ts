import type { JwtUser } from '../../auth/current-user.decorator'
import type { DeviceAuthService } from './device-auth.service'
import { TelemetryDevicesController } from './telemetry-devices.controller'

// O que estes casos protegem não é o roteamento (isso é E2E), e sim de onde vem
// a identidade e quem pode chamar o quê. Um administrador parear um dispositivo
// para si mesmo lendo o corpo da requisição seria invisível para o serviço.

const ADMIN: JwtUser = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

const serviceDouble = () =>
  ({
    createEnrollment: jest.fn().mockResolvedValue({ enrollmentId: 'e1', code: '123456' }),
    completeEnrollment: jest.fn().mockResolvedValue({ deviceId: 'd1', credential: 'd1.segredo' }),
    revoke: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<DeviceAuthService>

describe('TelemetryDevicesController', () => {
  it('cria o enrollment com o administrador do token, não com o do corpo', async () => {
    const devices = serviceDouble()

    await new TelemetryDevicesController(devices).createEnrollment(ADMIN, {
      workerId: 'worker-1',
      kind: 'IPHONE',
    })

    expect(devices.createEnrollment).toHaveBeenCalledWith(ADMIN, {
      workerId: 'worker-1',
      kind: 'IPHONE',
    })
  })

  it('conclui o pareamento com o funcionário do token, não com o do corpo', async () => {
    const devices = serviceDouble()

    await new TelemetryDevicesController(devices).complete('worker-1', {
      enrollmentId: 'enrollment-1',
      code: '123456',
    })

    expect(devices.completeEnrollment).toHaveBeenCalledWith('worker-1', {
      enrollmentId: 'enrollment-1',
      code: '123456',
    })
  })

  it('revoga usando o escopo do administrador do token', async () => {
    const devices = serviceDouble()

    await new TelemetryDevicesController(devices).revoke(ADMIN, 'device-1')

    expect(devices.revoke).toHaveBeenCalledWith(ADMIN, 'device-1')
  })

  it('reserva a criação de enrollment e a revogação ao administrador', () => {
    const roles = (method: 'createEnrollment' | 'complete' | 'revoke') =>
      Reflect.getMetadata('roles', TelemetryDevicesController.prototype[method]) as
        | string[]
        | undefined

    expect(roles('createEnrollment')).toEqual(['ADMIN'])
    expect(roles('revoke')).toEqual(['ADMIN'])
    // Concluir o pareamento é do funcionário dono do enrollment, não do admin.
    expect(roles('complete')).toBeUndefined()
  })

  it('limita a taxa dos dois endpoints de enrollment', () => {
    // Chave montada à mão porque o pacote não exporta a constante na raiz. O
    // formato é `THROTTLER:LIMIT` + nome do throttler, conforme
    // node_modules/@nestjs/throttler/dist/throttler.constants.d.ts.
    const limit = (method: 'createEnrollment' | 'complete') =>
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        TelemetryDevicesController.prototype[method],
      ) as number | undefined

    // O teto global é 100 por minuto e não serve aqui: pareamento é adivinhação
    // de código de seis dígitos, então tem teto próprio e bem menor.
    expect(limit('createEnrollment')).toBe(5)
    expect(limit('complete')).toBe(5)
  })
})
