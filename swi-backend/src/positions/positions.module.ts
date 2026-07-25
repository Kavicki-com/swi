import { Module } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { PositionsController } from './positions.controller'
import { PositionSimulatorService } from './position-simulator.service'
import { RealtimeModule } from '../realtime/realtime.module'
import { MediaModule } from '../media/media.module'

@Module({
  imports: [RealtimeModule, MediaModule],
  providers: [PositionsService, PositionSimulatorService],
  controllers: [PositionsController],
  exports: [PositionsService],
})
export class PositionsModule {}
