import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateSupportRequestDto } from './dto'

// Persiste o pedido de suporte em SupportRequest, senão ele é descartado em
// silêncio. O vínculo é o userId do JWT quando existe sessão, ou o email
// digitado quando não.
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
