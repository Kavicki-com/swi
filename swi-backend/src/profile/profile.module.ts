import { Module } from '@nestjs/common'
import { ProfileService } from './profile.service'
import { ProfileController } from './profile.controller'
import { MediaModule } from '../media/media.module'

@Module({ imports: [MediaModule], providers: [ProfileService], controllers: [ProfileController] })
export class ProfileModule {}
