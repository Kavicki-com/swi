import { Module } from '@nestjs/common'
import { RescueService } from './rescue.service'
import { RescueController } from './rescue.controller'
import { JourneyModule } from '../journey/journey.module'
import { NotificationModule } from '../notifications/notification.module'

@Module({
  imports: [JourneyModule, NotificationModule],
  providers: [RescueService],
  controllers: [RescueController],
})
export class RescueModule {}
