import { Module } from '@nestjs/common'
import { DeviceAuthGuard } from './devices/device-auth.guard'
import { DeviceAuthService } from './devices/device-auth.service'
import { TelemetryDevicesController } from './devices/telemetry-devices.controller'
import { PrismaTelemetryRepository } from './persistence/prisma-telemetry.repository'

// Módulo da telemetria do piloto. Nasce aqui, com o pareamento, e é onde a
// ingestão e o read model vão se pendurar depois. PrismaModule é global, então
// não precisa ser importado.
@Module({
  controllers: [TelemetryDevicesController],
  providers: [DeviceAuthService, DeviceAuthGuard, PrismaTelemetryRepository],
  // Exportados para a ingestão, que guarda o evento pelo repositório e protege
  // a rota com o guard do aparelho.
  exports: [DeviceAuthService, DeviceAuthGuard, PrismaTelemetryRepository],
})
export class TelemetryModule {}
