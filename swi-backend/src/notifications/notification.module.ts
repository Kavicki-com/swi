import { Module } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { NotificationController } from './notification.controller'
import { RealtimeModule } from '../realtime/realtime.module'
import { QueueModule } from '../queue/queue.module'

@Module({
  imports: [RealtimeModule, QueueModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
