import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { MediaService } from './media.service'
import { PresignDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // 30/min cobre o pior caso legítimo (submit com 20 anexos presigna em rajada)
  // e corta abuso do endpoint como fábrica de URLs de upload (15 MB cada).
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('presign')
  presign(@Body() dto: PresignDto, @Req() req: { user?: { role?: string } }) {
    const prefix = dto.prefix ?? 'reports'
    // 'order' é anexo de work-order — escrita ADMIN-only (@Roles na classe do
    // work-orders.controller). WORKER não tem caminho legítimo nesse namespace;
    // sem esta checagem, qualquer autenticado geraria URL real de upload nele.
    if (prefix === 'order' && req.user?.role !== 'ADMIN') {
      throw new ForbiddenException('prefixo restrito a administradores')
    }
    return this.media.presignPut(dto.contentType, dto.contentLength, prefix)
  }
}
