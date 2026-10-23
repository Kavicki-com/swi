import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { PUSH_TRANSPORT } from '../src/push/push.service'
import type { JsonResponse } from '../src/common/httpGet'

// CNPJ exclusivo deste teste: o cleanup apaga por CNPJ.
const CNPJ = '99000000002801'

// Token de push do aparelho e o push da evacuação de ponta a ponta. O
// transporte da Expo é trocado por um dublê: nenhuma requisição sai da máquina.
describe('Push e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    admin: 'push-admin@ex.com',
    w1: 'push-w1@ex.com',
    w2: 'push-w2@ex.com',
    gone: 'push-gone@ex.com',
  }
  let ids: Record<string, string> = {}
  let companyId: string
  const sent: { url: string; messages: any[]; headers: Record<string, string> }[] = []
  const transport = jest.fn(async (url: string, messages: any[], headers: Record<string, string>): Promise<JsonResponse> => {
    sent.push({ url, messages, headers })
    return { ok: true, status: 200, json: async () => ({ data: messages.map(() => ({ status: 'ok', id: 'r' })) }) }
  })

  const T1 = 'ExponentPushToken[push-e2e-aparelho-1]'
  const T2 = 'ExpoPushToken[push-e2e-aparelho-2]'
  const T_GONE = 'ExpoPushToken[push-e2e-aparelho-3]'

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await prisma.pushToken.deleteMany({ where: { token: { in: [T1, T2, T_GONE] } } })
    await prisma.evacuationAck.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.evacuation.deleteMany({ where: { startedById: { in: userIds } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUSH_TRANSPORT)
      .useValue(transport)
      .compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    companyId = (await prisma.company.create({ data: { name: 'Push Co', cnpj: CNPJ, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const base = { passwordHash, emailVerified: true, approvalStatus: 'APPROVED' as const, companyId }
    ids = {
      admin: (await prisma.user.create({ data: { email: emails.admin, name: 'Push Admin', role: 'ADMIN', ...base } })).id,
      w1: (await prisma.user.create({ data: { email: emails.w1, name: 'Push W1', role: 'WORKER', ...base } })).id,
      w2: (await prisma.user.create({ data: { email: emails.w2, name: 'Push W2', role: 'WORKER', ...base } })).id,
      gone: (await prisma.user.create({ data: { email: emails.gone, name: 'Push Gone', role: 'WORKER', ...base } })).id,
    }
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const http = () => request(app.getHttpServer())
  const login = async (email: string) => {
    const { body } = await http().post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  it('sem token de acesso → 401', async () => {
    await http().post('/push/tokens').send({ token: T1, platform: 'android' }).expect(401)
    await http().delete('/push/tokens').send({ token: T1 }).expect(401)
  })

  it('valida o formato do token e a plataforma', async () => {
    const w1 = await login(emails.w1)
    await http().post('/push/tokens').set(w1).send({ token: 'fcm-cru', platform: 'android' }).expect(400)
    await http().post('/push/tokens').set(w1).send({ token: T1, platform: 'web' }).expect(400)
    await http().post('/push/tokens').set(w1).send({ token: T1 }).expect(400)
    await http().delete('/push/tokens').set(w1).send({ token: 'qualquer' }).expect(400)
  })

  it('registrar, trocar de conta no mesmo aparelho e remover só o próprio', async () => {
    const w1 = await login(emails.w1)
    const w2 = await login(emails.w2)
    const admin = await login(emails.admin)

    await http().post('/push/tokens').set(w1).send({ token: T1, platform: 'android' }).expect(204)
    expect(await prisma.pushToken.findUnique({ where: { token: T1 } })).toMatchObject({ userId: ids.w1, platform: 'android' })
    // Registrar de novo é idempotente.
    await http().post('/push/tokens').set(w1).send({ token: T1, platform: 'android' }).expect(204)
    expect(await prisma.pushToken.count({ where: { token: T1 } })).toBe(1)

    // O mesmo aparelho entra com outra conta: o token passa a ser dela.
    await http().post('/push/tokens').set(w2).send({ token: T1, platform: 'ios' }).expect(204)
    expect(await prisma.pushToken.findUnique({ where: { token: T1 } })).toMatchObject({ userId: ids.w2, platform: 'ios' })

    // Quem não é dono não apaga (e não descobre nada: 204 igual).
    await http().delete('/push/tokens').set(w1).send({ token: T1 }).expect(204)
    expect(await prisma.pushToken.findUnique({ where: { token: T1 } })).not.toBeNull()
    await http().delete('/push/tokens').set(w2).send({ token: T1 }).expect(204)
    expect(await prisma.pushToken.findUnique({ where: { token: T1 } })).toBeNull()

    // Administrador também usa o app e registra o próprio aparelho.
    await http().post('/push/tokens').set(admin).send({ token: T1, platform: 'android' }).expect(204)
    await http().delete('/push/tokens').set(admin).send({ token: T1 }).expect(204)
  })

  it('apagar o usuário apaga os tokens dele', async () => {
    const gone = await login(emails.gone)
    await http().post('/push/tokens').set(gone).send({ token: T_GONE, platform: 'android' }).expect(204)
    await prisma.user.delete({ where: { id: ids.gone } })
    expect(await prisma.pushToken.findUnique({ where: { token: T_GONE } })).toBeNull()
  })

  it('evacuação: push visível e só de dados no start, só de dados no end, para os workers da empresa', async () => {
    const saved = process.env.PUSH_ENABLED
    process.env.PUSH_ENABLED = '1'
    try {
      const w1 = await login(emails.w1)
      const w2 = await login(emails.w2)
      const admin = await login(emails.admin)
      await http().post('/push/tokens').set(w1).send({ token: T1, platform: 'android' }).expect(204)
      await http().post('/push/tokens').set(w2).send({ token: T2, platform: 'ios' }).expect(204)
      // O aparelho do administrador não recebe: o push vai para quem evacua.
      sent.length = 0

      const { body: evac } = await http()
        .post('/evacuations')
        .set(admin)
        .send({ musterPoint: [-46.62, -23.544] })
        .expect(201)
      // O start manda dois lotes, em paralelo: o visível e o só de dados.
      await waitFor(() => sent.length >= 2)
      expect(sent[0].url).toBe('https://exp.host/--/api/v2/push/send')
      const batch = (pick: (m: any) => boolean) => sent.find((s) => pick(s.messages[0]))!.messages
      const started = batch((m) => m.data.type === 'evacuation.started' && 'title' in m)
      expect(started.map((m) => m.to).sort()).toEqual([T2, T1].sort())
      expect(started[0]).toMatchObject({
        title: 'Evacuação iniciada',
        priority: 'high',
        channelId: 'evacuation',
        data: { type: 'evacuation.started', evacuationId: evac.id },
      })
      const silentStart = batch((m) => m.data.type === 'evacuation.started' && !('title' in m))
      expect(silentStart.map((m) => m.to).sort()).toEqual([T2, T1].sort())
      expect(silentStart[0]).toMatchObject({
        priority: 'high',
        _contentAvailable: true,
        data: { type: 'evacuation.started', evacuationId: evac.id },
      })
      expect(silentStart[0]).not.toHaveProperty('body')

      await http().post(`/evacuations/${evac.id}/end`).set(admin).expect(204)
      await waitFor(() => sent.length >= 3)
      const ended = batch((m) => m.data.type === 'evacuation.ended')
      expect(ended.map((m) => m.to).sort()).toEqual([T2, T1].sort())
      expect(ended[0]).toMatchObject({ priority: 'high', data: { type: 'evacuation.ended', evacuationId: evac.id } })
      expect(ended[0]).not.toHaveProperty('title')
      expect(ended[0]).not.toHaveProperty('body')
    } finally {
      if (saved === undefined) delete process.env.PUSH_ENABLED
      else process.env.PUSH_ENABLED = saved
    }
  })

  it('DeviceNotRegistered na resposta apaga o token', async () => {
    const saved = process.env.PUSH_ENABLED
    process.env.PUSH_ENABLED = '1'
    try {
      const admin = await login(emails.admin)
      transport.mockImplementationOnce(async (url, messages, headers) => {
        sent.push({ url, messages, headers })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: messages.map((m: any) =>
              m.to === T2 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'r' }),
          }),
        }
      })
      sent.length = 0
      const { body: evac } = await http().post('/evacuations').set(admin).send({ musterPoint: [-46.62, -23.544] }).expect(201)
      await waitFor(async () => (await prisma.pushToken.findUnique({ where: { token: T2 } })) === null)
      expect(await prisma.pushToken.findUnique({ where: { token: T1 } })).not.toBeNull()
      await http().post(`/evacuations/${evac.id}/end`).set(admin).expect(204)
    } finally {
      if (saved === undefined) delete process.env.PUSH_ENABLED
      else process.env.PUSH_ENABLED = saved
    }
  })
})

// O push corre por fora da resposta HTTP; o teste espera ele chegar.
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timeout esperando o push')
}
