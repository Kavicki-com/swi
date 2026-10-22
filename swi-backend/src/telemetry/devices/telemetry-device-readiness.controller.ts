import { Body, Controller, HttpCode, Put, UseGuards } from '@nestjs/common'
import { ApiSecurity, ApiTags } from '@nestjs/swagger'
import { DEVICE_SCHEME } from '../../docs/api-docs'
import { CurrentDevice } from './current-device.decorator'
import { DeviceAuthGuard } from './device-auth.guard'
import { DeviceAuthService, type DeviceIdentity } from './device-auth.service'
import { ReadinessReportDto } from './dto/readiness-report.dto'

// Rota que o celular chama sozinho, com a credencial do pareamento, como a
// ingestão. Fica fora do TelemetryDevicesController porque lá o guard da
// classe é o JWT de pessoa, e aqui quem fala é o aparelho.
@ApiTags('telemetry/devices')
@ApiSecurity(DEVICE_SCHEME)
@Controller('telemetry/v1/devices/me')
@UseGuards(DeviceAuthGuard)
export class TelemetryDeviceReadinessController {
  constructor(private readonly devices: DeviceAuthService) {}

  /**
   * O relato de prontidão do celular Android. PUT e 204: cada relato substitui
   * o anterior inteiro, então repetir o mesmo relato deixa o mesmo estado.
   */
  @Put('readiness')
  @HttpCode(204)
  report(@CurrentDevice() device: DeviceIdentity, @Body() report: ReadinessReportDto): Promise<void> {
    return this.devices.reportReadiness(device, report)
  }
}
