import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'
import { Roles } from './roles.decorator'

// Alvos REAIS carregando a metadata via o decorator Roles — exatamente como os
// controllers a aplicam. getClass()/getHandler() do ctx devolvem estes alvos.
@Roles('ADMIN')
class AdminScopedController {
  bareHandler() {} // sem @Roles no método → só a classe exige ADMIN
}
class BareController {
  @Roles('ADMIN')
  adminHandler() {} // @Roles no método (padrão do users.controller)
  bareHandler() {} // sem @Roles em lugar nenhum → rota pública/JWT-only
}

// ExecutionContext fake (mesmo padrão do current-user.decorator.spec): devolve os
// alvos com metadata + o req.user.
const ctx = (handler: any, cls: any, user: any): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any

const guard = () => new RolesGuard(new Reflector())

describe('RolesGuard', () => {
  // (a) @Roles NA CLASSE — a regressão silenciosa (voltar pra reflector.get(getHandler))
  // ignoraria isto e reabriria o WorkOrdersController pra qualquer WORKER.
  it('metadata só na CLASSE nega WORKER', () => {
    const c = ctx(AdminScopedController.prototype.bareHandler, AdminScopedController, { role: 'WORKER' })
    expect(guard().canActivate(c)).toBe(false)
  })

  it('metadata só na CLASSE admite ADMIN', () => {
    const c = ctx(AdminScopedController.prototype.bareHandler, AdminScopedController, { role: 'ADMIN' })
    expect(guard().canActivate(c)).toBe(true)
  })

  // (b) @Roles no MÉTODO — backward-compat com users.controller.
  it('metadata no MÉTODO ainda resolve: admite ADMIN', () => {
    const c = ctx(BareController.prototype.adminHandler, BareController, { role: 'ADMIN' })
    expect(guard().canActivate(c)).toBe(true)
  })

  it('metadata no MÉTODO ainda resolve: nega WORKER', () => {
    const c = ctx(BareController.prototype.adminHandler, BareController, { role: 'WORKER' })
    expect(guard().canActivate(c)).toBe(false)
  })

  // (c) sem @Roles em lugar nenhum → rota aberta (JWT-only), independe do role.
  it('sem @Roles (método e classe) → true', () => {
    expect(guard().canActivate(ctx(BareController.prototype.bareHandler, BareController, { role: 'WORKER' }))).toBe(true)
    expect(guard().canActivate(ctx(BareController.prototype.bareHandler, BareController, undefined))).toBe(true)
  })

  // (d) fail-closed: req sem user numa rota que exige role → nega.
  it('rota com @Roles mas sem req.user → false (fail-closed)', () => {
    const c = ctx(AdminScopedController.prototype.bareHandler, AdminScopedController, undefined)
    expect(guard().canActivate(c)).toBe(false)
  })
})
