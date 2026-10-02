import { Module } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { PositionsController } from './positions.controller'
import { PositionSimulatorService } from './position-simulator.service'
import { PositionHistoryService } from './position-history.service'
import { PositionRetentionJob } from './position-retention.job'
import { RealtimeModule } from '../realtime/realtime.module'
import { MediaModule } from '../media/media.module'
import { EvacuationModule } from '../evacuation/evacuation.module'

@Module({
  // EvacuationModule: o simulador ack'a a evacuação na chegada ao muster.
  imports: [RealtimeModule, MediaModule, EvacuationModule],
  providers: [PositionsService, PositionSimulatorService, PositionHistoryService, PositionRetentionJob],
  controllers: [PositionsController],
  exports: [PositionsService],
})
export class PositionsModule {}
