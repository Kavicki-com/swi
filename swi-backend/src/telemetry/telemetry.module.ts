import { Module } from '@nestjs/common'
import { RealtimeModule } from '../realtime/realtime.module'
import { TelemetryConditionSweepJob } from './alerts/condition-sweep.job'
import { TelemetryConditionService } from './alerts/condition.service'
import { TelemetryAssessmentService } from './assessment/assessment.service'
import { DeviceAuthGuard } from './devices/device-auth.guard'
import { DeviceAuthService } from './devices/device-auth.service'
import { TelemetryDevicesController } from './devices/telemetry-devices.controller'
import { TelemetryIngestionController } from './ingestion/telemetry-ingestion.controller'
import { TelemetryIngestionService } from './ingestion/telemetry-ingestion.service'
import { TelemetryLifecycleJob } from './lifecycle/telemetry-lifecycle.job'
import { TelemetryLifecycleService } from './lifecycle/telemetry-lifecycle.service'
import { PrismaTelemetryRepository } from './persistence/prisma-telemetry.repository'
import { TELEMETRY_REPOSITORY } from './persistence/telemetry.repository'
import { TelemetryQueryController } from './read-model/telemetry-query.controller'
import { TelemetryQueryService } from './read-model/telemetry-query.service'

// Módulo da telemetria do piloto: pareamento, ingestão, avaliação de esforço e
// desgaste, condições e alertas, read model e ciclo de vida do dado (Resumo do
// dia, gravado por job agendado).
// As condições têm duas portas: a do VALOR, que a ingestão chama por evento ao
// vivo, e a da AUSÊNCIA, que é a varredura de silêncio, com agendamento próprio
// a cada 30 s. ScheduleModule.forRoot() está na raiz (AppModule), então basta o
// job ser provedor daqui para o @Cron dele ser apanhado.
// PrismaModule é global, então não precisa ser importado; RealtimeModule sim,
// porque a ingestão avisa pelo socket depois de gravar.
@Module({
  imports: [RealtimeModule],
  controllers: [TelemetryDevicesController, TelemetryIngestionController, TelemetryQueryController],
  providers: [
    DeviceAuthService,
    DeviceAuthGuard,
    PrismaTelemetryRepository,
    // A ingestão depende da porta, não do adapter. useExisting e não useClass:
    // o token e a classe têm de resolver para a mesma instância.
    { provide: TELEMETRY_REPOSITORY, useExisting: PrismaTelemetryRepository },
    TelemetryAssessmentService,
    // Depois da avaliação, porque é nessa ordem que a ingestão as chama.
    TelemetryConditionService,
    TelemetryConditionSweepJob,
    TelemetryIngestionService,
    TelemetryQueryService,
    TelemetryLifecycleService,
    TelemetryLifecycleJob,
  ],
  exports: [
    DeviceAuthService,
    DeviceAuthGuard,
    PrismaTelemetryRepository,
    TELEMETRY_REPOSITORY,
  ],
})
export class TelemetryModule {}
