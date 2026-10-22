import { Module } from '@nestjs/common'
import { RescueService } from './rescue.service'
import { RescueController } from './rescue.controller'
import { JourneyModule } from '../journey/journey.module'
import { NotificationModule } from '../notifications/notification.module'
import { TelemetryModule } from '../telemetry/telemetry.module'

@Module({
  // TelemetryModule pelo pedido de ajuda, que o despacho atende e o encerramento fecha.
  imports: [JourneyModule, NotificationModule, TelemetryModule],
  providers: [RescueService],
  controllers: [RescueController],
})
export class RescueModule {}
