import { Module } from '@nestjs/common'
import { RealtimeModule } from '../realtime/realtime.module'
import { DeviceAuthGuard } from './devices/device-auth.guard'
import { DeviceAuthService } from './devices/device-auth.service'
import { TelemetryDevicesController } from './devices/telemetry-devices.controller'
import { TelemetryIngestionController } from './ingestion/telemetry-ingestion.controller'
import { TelemetryIngestionService } from './ingestion/telemetry-ingestion.service'
import { PrismaTelemetryRepository } from './persistence/prisma-telemetry.repository'
import { TELEMETRY_REPOSITORY } from './persistence/telemetry.repository'

// Módulo da telemetria do piloto: pareamento, ingestão e, depois, o read model.
// PrismaModule é global, então não precisa ser importado; RealtimeModule sim,
// porque a ingestão avisa pelo socket depois de gravar.
@Module({
  imports: [RealtimeModule],
  controllers: [TelemetryDevicesController, TelemetryIngestionController],
  providers: [
    DeviceAuthService,
    DeviceAuthGuard,
    PrismaTelemetryRepository,
    // A ingestão depende da porta, não do adapter. useExisting e não useClass:
    // o token e a classe têm de resolver para a mesma instância.
    { provide: TELEMETRY_REPOSITORY, useExisting: PrismaTelemetryRepository },
    TelemetryIngestionService,
  ],
  exports: [DeviceAuthService, DeviceAuthGuard, PrismaTelemetryRepository, TELEMETRY_REPOSITORY],
})
export class TelemetryModule {}
