import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface JwtUser {
  userId: string
  role: string
  // reflete exatamente o retorno de JwtStrategy.validate() — single source of truth do shape do JWT
}

export const currentUserFactory = (_: unknown, ctx: ExecutionContext): JwtUser =>
  ctx.switchToHttp().getRequest<{ user: JwtUser }>().user

export const currentUserIdFactory = (_: unknown, ctx: ExecutionContext): string =>
  currentUserFactory(_, ctx).userId

export const CurrentUser = createParamDecorator(currentUserFactory)
export const CurrentUserId = createParamDecorator(currentUserIdFactory)
