import { Module } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { JourneyController } from './journey.controller'
import { MediaModule } from '../media/media.module'
import { IdempotencyModule } from '../idempotency/idempotency.module'

@Module({ imports: [MediaModule, IdempotencyModule], providers: [JourneyService], controllers: [JourneyController] })
export class JourneyModule {}
