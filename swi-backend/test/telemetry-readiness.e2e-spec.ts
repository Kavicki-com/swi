import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'

// E2E do relato de prontidão: o celular Android conta ao backend o que só ele
// sabe (Health Connect e Bluetooth), e o painel lê pela consulta do aparelho
// por onde a leitura chega e o que falta. O relato entra pela rota com a
// credencial de verdade e sai pela rota do administrador, com o Postgres no
// meio, para provar a substituição e a derivação sobre o que foi gravado.
//
// CNPJ exclusivo deste spec, pelo mesmo motivo do e2e do pareamento.
const CNPJ = '99000000002301'

describe('Telemetry readiness e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    admin: `telemetry-ready-admin-${randomUUID()}@ex.com`,
    android: `telemetry-ready-android-${randomUUID()}@ex.com`,
    semNascimento: `telemetry-ready-sem-nasc-${randomUUID()}@ex.com`,
    iphone: `telemetry-ready-iphone-${randomUUID()}@ex.com`,
    semRelato: `telemetry-ready-sem-relato-${randomUUID()}@ex.com`,
  }
  let companyId = ''
  let adminId = ''
  let workerAndroid = ''
  let workerSemNascimento = ''
  let workerIphone = ''
  let workerSemRelato = ''
  let androidHeaders: Record<string, string> = {}
  let semNascimentoHeaders: Record<string, string> = {}
  let iphoneHeaders: Record<string, string> = {}
  let androidDeviceId = ''

  const bearer = (sub: string, role: string) => ({
    Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role })}`,
  })

  /** Tudo o que o app sabe, com o monitoramento completo pelos dois caminhos. */
  const completo = () => ({
    healthConnect: {
      availability: 'AVAILABLE',
      readGranted: true,
      backgroundGranted: true,
      manufacturerPackage: 'com.mi.health',
      lastSyncAt: '2026-10-22T13:00:00.000Z',
      lastFailure: null,
    },
    bluetooth: {
      bandChosen: true,
      listenerState: 'CONNECTED',
      listenerStateSince: '2026-10-22T12:58:00.000Z',
      lastReadingAt: '2026-10-22T13:01:00.000Z',
    },
  })

  const relatar = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).put('/telemetry/v1/devices/me/readiness').set(headers).send(body)

  const consultar = async (workerId: string) => {
    const { body } = await request(app.getHttpServer())
      .get(`/telemetry/v1/devices/workers/${workerId}`)
      .set(bearer(adminId, 'ADMIN'))
      .expect(200)
    return body
  }

  const aparelho = async (workerId: string, kind: 'ANDROID_PHONE' | 'IPHONE') => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind, credentialHash: hashCredential(secret) },
    })
    return { id: device.id, headers: { Authorization: `Device ${encodeCredential(device.id, secret)}` } }
  }

  const cleanup = async () => {
    const workers = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    await prisma.profile.deleteMany({ where: { userId: { in: workers.map((w) => w.id) } } })
    // Cascade a partir do User leva os aparelhos.
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    companyId = (await prisma.company.create({ data: { name: 'Readiness Co', cnpj: CNPJ, ...endereco } })).id

    const user = async (email: string, role: 'ADMIN' | 'WORKER', birthDate?: Date) =>
      (
        await prisma.user.create({
          data: {
            email,
            name: email,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
            ...(birthDate === undefined ? {} : { profile: { create: { birthDate } } }),
          },
        })
      ).id

    const nascimento = new Date('1991-05-10T00:00:00.000Z')
    adminId = await user(emails.admin, 'ADMIN')
    workerAndroid = await user(emails.android, 'WORKER', nascimento)
    workerSemNascimento = await user(emails.semNascimento, 'WORKER')
    workerIphone = await user(emails.iphone, 'WORKER', nascimento)
    workerSemRelato = await user(emails.semRelato, 'WORKER', nascimento)

    const android = await aparelho(workerAndroid, 'ANDROID_PHONE')
    androidDeviceId = android.id
    androidHeaders = android.headers
    semNascimentoHeaders = (await aparelho(workerSemNascimento, 'ANDROID_PHONE')).headers
    iphoneHeaders = (await aparelho(workerIphone, 'IPHONE')).headers
    await aparelho(workerSemRelato, 'ANDROID_PHONE')
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('o relato é gravado no aparelho e a consulta devolve o que o app informou, com a hora', async () => {
    const antes = Date.now()

    await relatar(androidHeaders, completo()).expect(204)

    const { device } = await consultar(workerAndroid)
    expect(device.id).toBe(androidDeviceId)
    expect(device.relato).toEqual(completo())
    expect(new Date(device.relatadoEm).getTime()).toBeGreaterThanOrEqual(antes - 1_000)
  })

  it('o relato novo substitui o anterior inteiro: o fato que o app deixou de mandar não sobrevive', async () => {
    await relatar(androidHeaders, completo()).expect(204)
    const primeiro = (await consultar(workerAndroid)).device.relatadoEm

    // A pessoa revogou a leitura no Health Connect e a sincronização falhou; o
    // app não manda mais o pacote do fabricante.
    const segundo = {
      healthConnect: {
        availability: 'AVAILABLE',
        readGranted: false,
        backgroundGranted: false,
        lastSyncAt: '2026-10-22T13:00:00.000Z',
        lastFailure: { reason: 'PERMISSION_DENIED', at: '2026-10-22T13:15:00.000Z' },
      },
      bluetooth: { bandChosen: true, listenerState: 'BLUETOOTH_OFF', listenerStateSince: '2026-10-22T13:10:00.000Z' },
    }
    await relatar(androidHeaders, segundo).expect(204)

    const { device } = await consultar(workerAndroid)
    expect(device.relato).toEqual({
      healthConnect: { ...segundo.healthConnect, manufacturerPackage: null },
      bluetooth: { ...segundo.bluetooth, lastReadingAt: null },
    })
    expect(new Date(device.relatadoEm).getTime()).toBeGreaterThanOrEqual(new Date(primeiro).getTime())
  })

  it('repetir o mesmo relato é idempotente: o estado é o mesmo, só as horas de contato andam', async () => {
    await relatar(androidHeaders, completo()).expect(204)
    const uma = (await consultar(workerAndroid)).device

    await relatar(androidHeaders, completo()).expect(204)
    const duas = (await consultar(workerAndroid)).device

    // lastSeenAt anda a cada autenticação do aparelho, relatadoEm a cada relato.
    const semHoras = (device: Record<string, unknown>) => ({ ...device, lastSeenAt: null, relatadoEm: null })
    expect(semHoras(duas)).toEqual(semHoras(uma))
    expect(new Date(duas.relatadoEm).getTime()).toBeGreaterThanOrEqual(new Date(uma.relatadoEm).getTime())
  })

  describe('caminhosAtivos', () => {
    const com = (hc: object, bt: object) => {
      const base = completo()
      return { healthConnect: { ...base.healthConnect, ...hc }, bluetooth: { ...base.bluetooth, ...bt } }
    }

    it.each([
      ['os dois, com leitura sincronizada e pulseira escutando', com({}, {}), ['HEALTH_CONNECT', 'BLUETOOTH']],
      ['só o Health Connect, sem pulseira escolhida', com({}, { bandChosen: false }), ['HEALTH_CONNECT']],
      // Bluetooth desligado é falha do caminho, não fim dele: a escuta segue
      // ligada esperando o Bluetooth voltar.
      [
        'só o Bluetooth, com leitura permitida mas sem sincronização ainda',
        com({ lastSyncAt: null }, { listenerState: 'BLUETOOTH_OFF' }),
        ['BLUETOOTH'],
      ],
      ['só o Bluetooth, com a leitura do Health Connect negada', com({ readGranted: false }, {}), ['BLUETOOTH']],
      [
        'nenhum, com leitura negada e escuta encerrada',
        com({ readGranted: false }, { listenerState: 'ENDED' }),
        [],
      ],
    ])('%s', async (_caso, relato, esperado) => {
      await relatar(androidHeaders, relato).expect(204)

      expect((await consultar(workerAndroid)).device.caminhosAtivos).toEqual(esperado)
    })
  })

  describe('pendencias', () => {
    it('com tudo cumprido, a lista vem inteira, na ordem da lista de prontidão, sem nada pendente', async () => {
      await relatar(androidHeaders, completo()).expect(204)

      expect((await consultar(workerAndroid)).device.pendencias).toEqual([
        { id: 'PAIR', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: false },
        { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: false },
        { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: false },
        { id: 'BIRTH_DATE', obrigatorio: true, pendente: false },
      ])
    })

    it('sem data de nascimento no perfil e com o Health Connect a atualizar, cada passo que falta vem pendente', async () => {
      await relatar(semNascimentoHeaders, {
        healthConnect: {
          availability: 'UPDATE_REQUIRED',
          readGranted: false,
          backgroundGranted: false,
          manufacturerPackage: null,
          lastSyncAt: null,
          lastFailure: { reason: 'UPDATE_REQUIRED', at: '2026-10-22T13:15:00.000Z' },
        },
        bluetooth: { bandChosen: false, listenerState: 'ENDED', listenerStateSince: null, lastReadingAt: null },
      }).expect(204)

      expect((await consultar(workerSemNascimento)).device.pendencias).toEqual([
        { id: 'PAIR', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: true },
        { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: true },
        { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: true },
        { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: true },
        { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: true },
        { id: 'BIRTH_DATE', obrigatorio: true, pendente: true },
      ])
    })

    it('fato que o app não soube informar vem como não informado (pendente nulo), sem virar pendência', async () => {
      // Antes da primeira rodada o app ainda não sabe das permissões.
      await relatar(androidHeaders, {
        healthConnect: { availability: 'AVAILABLE', readGranted: null },
        bluetooth: { bandChosen: true, listenerState: 'SEARCHING' },
      }).expect(204)

      expect((await consultar(workerAndroid)).device.pendencias).toEqual([
        { id: 'PAIR', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: null },
        { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: null },
        // Pacote não detectado é fato: a detecção rodou e não achou.
        { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: true },
        { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: false },
        { id: 'BIRTH_DATE', obrigatorio: true, pendente: false },
      ])
    })

    it('sem relato ainda, os passos do celular vêm não informados pelo app, sem inventar pendência', async () => {
      const { device } = await consultar(workerSemRelato)

      expect(device.relato).toBeNull()
      expect(device.relatadoEm).toBeNull()
      expect(device.caminhosAtivos).toEqual([])
      // Parear e data de nascimento o backend sabe sozinho; o resto só o app.
      expect(device.pendencias).toEqual([
        { id: 'PAIR', obrigatorio: true, pendente: false },
        { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: null },
        { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: null },
        { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: null },
        { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: null },
        { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: null },
        { id: 'BIRTH_DATE', obrigatorio: true, pendente: false },
      ])
    })
  })

  describe('iPhone', () => {
    it('a lista de prontidão e os caminhos do Android não se aplicam e não são devolvidos', async () => {
      const { device } = await consultar(workerIphone)

      expect(device.kind).toBe('IPHONE')
      expect(device.pendencias).toBeNull()
      expect(device.caminhosAtivos).toBeNull()
      expect(device.relato).toBeNull()
    })

    it('o iPhone não relata prontidão: a rota recusa e nada é gravado', async () => {
      await relatar(iphoneHeaders, completo()).expect(403)

      expect((await consultar(workerIphone)).device.relatadoEm).toBeNull()
    })
  })

  it('valor fora do contrato é recusado com 400 e não substitui o relato', async () => {
    await relatar(androidHeaders, completo()).expect(204)

    const torto = completo()
    await relatar(androidHeaders, { ...torto, bluetooth: { ...torto.bluetooth, listenerState: 'PAIRED' } }).expect(400)

    expect((await consultar(workerAndroid)).device.relato).toEqual(completo())
  })

  // Por último: revoga o aparelho deste funcionário.
  it('credencial revogada recebe 401, como no envio de leituras', async () => {
    const { device } = await consultar(workerSemNascimento)
    await request(app.getHttpServer())
      .post(`/telemetry/v1/devices/${device.id}/revoke`)
      .set(bearer(adminId, 'ADMIN'))
      .expect(204)

    await relatar(semNascimentoHeaders, completo()).expect(401)
  })
})
