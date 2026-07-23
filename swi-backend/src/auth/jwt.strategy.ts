import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { requireJwtSecret } from './jwt-secret'
import { UsersService } from '../users/users.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: requireJwtSecret(),
    })
  }
  // Reconsulta o banco a cada request: desativar/excluir revoga a sessão na hora
  // (o token vive 7 dias). role vem fresca do banco, não do payload assinado.
  async validate(payload: { sub: string; role: string }) {
    const u = await this.users.findById(payload.sub)
    if (!u || !u.active) throw new UnauthorizedException()
    return { userId: u.id, role: u.role }
  }
}
