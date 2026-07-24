import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateSupportRequestDto } from './dto'

// QA F (2026-07-24): o pedido de suporte era descartado em silêncio pelo
// front. Agora persiste em SupportRequest — o vínculo é o userId do JWT
// quando existe sessão, ou o email digitado quando não.
@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSupportRequestDto, userId: string | null) {
    return this.prisma.supportRequest.create({
      data: {
        reason: dto.reason,
        title: dto.title,
        message: dto.message,
        email: dto.email ?? null,
        userId,
      },
    })
  }
}
