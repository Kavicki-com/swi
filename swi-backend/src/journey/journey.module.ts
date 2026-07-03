import { Module } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { JourneyController } from './journey.controller'
import { MediaModule } from '../media/media.module'

@Module({ imports: [MediaModule], providers: [JourneyService], controllers: [JourneyController] })
export class JourneyModule {}
