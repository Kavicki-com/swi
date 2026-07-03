import { Module } from '@nestjs/common'
import { EvacuationController } from './evacuation.controller'
import { EvacuationService } from './evacuation.service'
import { RouteProvider } from './evacuation.provider'

@Module({
  controllers: [EvacuationController],
  providers: [EvacuationService, RouteProvider],
})
export class EvacuationModule {}
