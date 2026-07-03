import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { NotificationModule } from '../notifications/notification.module'

@Module({ imports: [MediaModule, RealtimeModule, NotificationModule], providers: [ChatService], controllers: [ChatController] })
export class ChatModule {}
