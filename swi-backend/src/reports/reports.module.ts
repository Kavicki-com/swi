import { Module } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { ReportsController } from './reports.controller'
import { MediaModule } from '../media/media.module'
import { NotificationModule } from '../notifications/notification.module'

@Module({ imports: [MediaModule, NotificationModule], providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
