import { Module } from '@nestjs/common'
import { WorkOrdersService } from './work-orders.service'
import { WorkOrdersController } from './work-orders.controller'
import { MediaModule } from '../media/media.module'
import { NotificationModule } from '../notifications/notification.module'

@Module({ imports: [MediaModule, NotificationModule], providers: [WorkOrdersService], controllers: [WorkOrdersController] })
export class WorkOrdersModule {}
