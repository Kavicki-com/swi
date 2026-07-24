import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

// Guard JWT que NUNCA bloqueia: token válido popula req.user; ausente ou
// inválido vira anônimo (user = null). Pra rotas públicas que aproveitam a
// identidade quando ela existe (ex.: /support vincula o userId do logado).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Assinatura do Passport: (err, user) — o default lança em ambos os casos
  // ruins; aqui todo caminho ruim degrada pra anônimo.
  override handleRequest<TUser = unknown>(err: unknown, user: TUser | false): TUser | null {
    if (err || !user) return null
    return user
  }
}
