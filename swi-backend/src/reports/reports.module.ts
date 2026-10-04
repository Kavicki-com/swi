import { Module } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { ReportsController } from './reports.controller'
import { MediaModule } from '../media/media.module'
import { NotificationModule } from '../notifications/notification.module'
import { IdempotencyModule } from '../idempotency/idempotency.module'

@Module({ imports: [MediaModule, NotificationModule, IdempotencyModule], providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
