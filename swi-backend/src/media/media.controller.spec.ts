import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ForbiddenException } from '@nestjs/common'
import { MediaController } from './media.controller'

// Hardening (follow-up da fatia admin-tarefas): o presign tinha só JwtAuthGuard,
// então QUALQUER autenticado (inclusive WORKER) obtinha URL real de upload com
// prefix 'order'. Não é escalonamento (anexar exige POST/PATCH /work-orders),
// mas permite poluir o bucket. Regra: 'order' é namespace de quem opera ordens
// de serviço (workOrders.operate na matriz, hoje ADMIN e SUPERVISOR); os demais
// prefixos seguem valendo pra qualquer autenticado (o mobile WORKER usa
// reports/task/chat legitimamente).

// presignPut (nao Post): o R2 nao implementa presigned POST — ver
// media.service.ts. O contrato devolve { url, key }, sem `fields`.
const media = () =>
  ({ presignPut: jest.fn(async () => ({ url: 'u', key: 'k' })) }) as any

const reqWithRole = (role?: string) => ({ user: role ? { role } : undefined }) as any

describe('MediaController.presign: prefixo order segue workOrders.operate', () => {
  it('WORKER pedindo prefix order → 403 e nenhum presign emitido', () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    expect(() =>
      ctrl.presign({ contentType: 'image/jpeg', contentLength: 100, prefix: 'order' } as any, reqWithRole('WORKER')),
    ).toThrow(ForbiddenException)
    expect(svc.presignPut).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'SUPERVISOR'])('%s pedindo prefix order → presign normal', async (role) => {
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/jpeg', contentLength: 100, prefix: 'order' }, reqWithRole(role))
    expect(svc.presignPut).toHaveBeenCalledWith('image/jpeg', 100, 'order')
  })

  it('sem papel no token pedindo prefix order → 403', () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    expect(() =>
      ctrl.presign({ contentType: 'image/jpeg', contentLength: 100, prefix: 'order' } as any, reqWithRole()),
    ).toThrow(ForbiddenException)
    expect(svc.presignPut).not.toHaveBeenCalled()
  })

  it.each(['reports', 'task', 'chat', 'exams', 'avatars'])('WORKER pedindo prefix %s segue liberado', async (prefix) => {
    // 'exams' e 'avatars' são upload do próprio perfil: qualquer autenticado.
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/png', contentLength: 100, prefix }, reqWithRole('WORKER'))
    expect(svc.presignPut).toHaveBeenCalledWith('image/png', 100, prefix)
  })

  it('prefix omitido cai no default reports (liberado pra WORKER)', async () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/jpeg', contentLength: 100 }, reqWithRole('WORKER'))
    expect(svc.presignPut).toHaveBeenCalledWith('image/jpeg', 100, 'reports')
  })
})

describe('MediaController.presign — throttle dedicado', () => {
  it('a rota declara @Throttle próprio (mais apertado que o global de 100/min)', () => {
    // Node-level: o registro do throttler é metadata do Nest; o marcador no
    // fonte é o contrato aqui (padrão da casa: testes estruturais de fonte).
    const src = readFileSync(join(__dirname, 'media.controller.ts'), 'utf8')
    expect(src).toMatch(/@Throttle\(/)
  })
})
