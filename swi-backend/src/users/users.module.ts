import { Module } from '@nestjs/common'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'
import { MediaModule } from '../media/media.module'
import { RealtimeModule } from '../realtime/realtime.module'

@Module({ imports: [MediaModule, RealtimeModule], providers: [UsersService], exports: [UsersService], controllers: [UsersController] })
export class UsersModule {}
