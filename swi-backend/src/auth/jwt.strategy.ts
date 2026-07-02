import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { requireJwtSecret } from './jwt-secret'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: requireJwtSecret(),
    })
  }
  validate(payload: { sub: string; role: string }) { return { userId: payload.sub, role: payload.role } }
}
