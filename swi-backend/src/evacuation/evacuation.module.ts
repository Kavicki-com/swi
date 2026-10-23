import { Module } from '@nestjs/common'
import { EvacuationController } from './evacuation.controller'
import { EvacuationService } from './evacuation.service'
import { RouteProvider } from './evacuation.provider'
import { EvacuationsController } from './evacuations.controller'
import { EvacuationEventsService } from './evacuation-events.service'
import { RealtimeModule } from '../realtime/realtime.module'
import { NotificationModule } from '../notifications/notification.module'
import { PushModule } from '../push/push.module'

@Module({
  imports: [RealtimeModule, NotificationModule, PushModule],
  controllers: [EvacuationController, EvacuationsController],
  providers: [EvacuationService, RouteProvider, EvacuationEventsService],
  // Exportado pro PositionsModule: o simulador ack'a na chegada ao muster.
  exports: [EvacuationEventsService],
})
export class EvacuationModule {}
