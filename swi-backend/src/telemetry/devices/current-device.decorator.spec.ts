import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { currentDeviceFactory } from './current-device.decorator'
import type { DeviceRequest } from './device-auth.guard'
import type { DeviceIdentity } from './device-auth.service'

// O par do CurrentUser para as rotas de aparelho. O que se prova aqui é de onde
// sai a identidade de quem mede: da request que o guard preencheu.

const DEVICE: DeviceIdentity = { deviceId: 'device-1', workerId: 'worker-1' }

const context = (device?: DeviceIdentity): ExecutionContext => {
  const request = { headers: {}, device } as DeviceRequest
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext
}

describe('CurrentDevice', () => {
  it('entrega a identidade que o guard verificou', () => {
    expect(currentDeviceFactory(undefined, context(DEVICE))).toEqual(DEVICE)
  })

  // Sem o guard na rota o valor seria undefined e o evento entraria sem dono.
  // Recusar é a única saída segura, e é barata de provar.
  it('recusa quando a request não passou pelo guard', () => {
    expect(() => currentDeviceFactory(undefined, context())).toThrow(UnauthorizedException)
  })
})
