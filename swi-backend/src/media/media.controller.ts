import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { MediaService } from './media.service'
import { PresignDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { can } from '../auth/permissions'

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // 30/min cobre o pior caso legítimo (submit com 20 anexos presigna em rajada)
  // e corta abuso do endpoint como fábrica de URLs de upload (15 MB cada, até
  // 100 MB quando é vídeo de relatório).
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('presign')
  presign(@Body() dto: PresignDto, @Req() req: { user?: { role?: string } }) {
    const prefix = dto.prefix ?? 'reports'
    // 'order' é anexo de ordem de serviço: escreve nele quem opera ordens
    // (workOrders.operate, a mesma permissão do work-orders.controller). WORKER
    // não tem caminho legítimo nesse namespace; sem esta checagem, qualquer
    // autenticado geraria URL real de upload nele.
    if (prefix === 'order' && !can(req.user?.role, 'workOrders.operate')) {
      throw new ForbiddenException('prefixo restrito a quem opera ordens de serviço')
    }
    return this.media.presignPut(dto.contentType, dto.contentLength, prefix)
  }
}
