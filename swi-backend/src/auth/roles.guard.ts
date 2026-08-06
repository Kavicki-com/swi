import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    // Handler tem precedência sobre a classe: honra tanto @Roles por-rota
    // (users.controller) quanto @Roles na classe inteira (work-orders.controller).
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [ctx.getHandler(), ctx.getClass()])
    if (!roles?.length) return true
    const { user } = ctx.switchToHttp().getRequest<{ user?: { role?: string } }>()
    return roles.includes(user?.role ?? '')
  }
}
