import { Module } from '@nestjs/common'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { MailModule } from '../mail/mail.module'

@Module({ imports: [MediaModule, RealtimeModule, MailModule], providers: [UsersService], exports: [UsersService], controllers: [UsersController] })
export class UsersModule {}
