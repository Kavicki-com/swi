import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { MediaService } from './media.service'
import { PresignDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign')
  presign(@Body() dto: PresignDto) {
    return this.media.presignPut(dto.contentType)
  }
}
