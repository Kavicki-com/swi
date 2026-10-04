import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { NotificationModule } from '../notifications/notification.module'
import { MailModule } from '../mail/mail.module'
import { IdempotencyModule } from '../idempotency/idempotency.module'

@Module({ imports: [MediaModule, RealtimeModule, NotificationModule, MailModule, IdempotencyModule], providers: [ChatService], controllers: [ChatController] })
export class ChatModule {}
