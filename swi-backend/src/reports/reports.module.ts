import { Module } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { ReportsController } from './reports.controller'
import { MediaModule } from '../media/media.module'

@Module({ imports: [MediaModule], providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
