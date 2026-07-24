import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { SupportService } from './support.service'
import { CreateSupportRequestDto } from './dto'
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard'

// Rota PÚBLICA de propósito: o modal de suporte existe na tela de LOGIN
// (usuário sem sessão precisa conseguir pedir ajuda). Throttle apertado
// compensa a ausência de auth. O OptionalJwtAuthGuard nunca bloqueia — só
// popula req.user quando o Authorization vem válido, vinculando o userId.
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  create(@Body() dto: CreateSupportRequestDto, @Req() req: { user?: { userId?: string } }) {
    return this.support.create(dto, req.user?.userId ?? null)
  }
}
