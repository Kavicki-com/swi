import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'

@Module({ imports: [MediaModule, RealtimeModule], providers: [ChatService], controllers: [ChatController] })
export class ChatModule {}
