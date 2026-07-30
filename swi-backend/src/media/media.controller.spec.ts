import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ForbiddenException } from '@nestjs/common'
import { MediaController } from './media.controller'

// Hardening (follow-up da fatia admin-tarefas): o presign tinha só JwtAuthGuard,
// então QUALQUER autenticado (inclusive WORKER) obtinha URL real de upload com
// prefix 'order' — não é escalonamento (anexar exige POST/PATCH /work-orders,
// ADMIN-only), mas permite poluir o bucket. Regra: 'order' é namespace de
// escrita ADMIN-only; os demais prefixos seguem valendo pra qualquer autenticado
// (o mobile WORKER usa reports/task/chat legitimamente).

// presignPut (nao Post): o R2 nao implementa presigned POST — ver
// media.service.ts. O contrato devolve { url, key }, sem `fields`.
const media = () =>
  ({ presignPut: jest.fn(async () => ({ url: 'u', key: 'k' })) }) as any

const reqWithRole = (role?: string) => ({ user: role ? { role } : undefined }) as any

describe('MediaController.presign — prefixo order é ADMIN-only', () => {
  it('WORKER pedindo prefix order → 403 e nenhum presign emitido', () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    expect(() =>
      ctrl.presign({ contentType: 'image/jpeg', contentLength: 100, prefix: 'order' } as any, reqWithRole('WORKER')),
    ).toThrow(ForbiddenException)
    expect(svc.presignPut).not.toHaveBeenCalled()
  })

  it('ADMIN pedindo prefix order → presign normal', async () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/jpeg', contentLength: 100, prefix: 'order' } as any, reqWithRole('ADMIN'))
    expect(svc.presignPut).toHaveBeenCalledWith('image/jpeg', 100, 'order')
  })

  it.each(['reports', 'task', 'chat', 'exams', 'avatars'])('WORKER pedindo prefix %s segue liberado', async (prefix) => {
    // exams/avatars (QA F): upload do próprio perfil — qualquer autenticado.
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/png', contentLength: 100, prefix } as any, reqWithRole('WORKER'))
    expect(svc.presignPut).toHaveBeenCalledWith('image/png', 100, prefix)
  })

  it('prefix omitido cai no default reports (liberado pra WORKER)', async () => {
    const svc = media()
    const ctrl = new MediaController(svc)
    await ctrl.presign({ contentType: 'image/jpeg', contentLength: 100 } as any, reqWithRole('WORKER'))
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
