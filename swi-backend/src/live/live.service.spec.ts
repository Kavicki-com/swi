import { JwtService } from '@nestjs/jwt'
import type { PrismaService } from '../prisma/prisma.service'
import { LiveRegistry } from './live-registry'
import { LIVE_MAX_SDP_LENGTH, LiveService } from './live.service'

// O socket não sabe papel nem empresa de quem conectou, então o serviço relê
// os dois no banco a cada ligar e assistir, como o REST faz a cada requisição.
// Depois disso, oferta, resposta e candidatos só valem entre os dois sockets
// da sessão. O serviço não fala com socket: devolve a resposta e quem avisar.

const secret = 'test-secret-live'

type UserRow = { id: string; role: 'WORKER' | 'ADMIN'; companyId: string | null; active: boolean; name: string }

const users: Record<string, UserRow> = {
  w1: { id: 'w1', role: 'WORKER', companyId: 'c1', active: true, name: 'Ana' },
  w2: { id: 'w2', role: 'WORKER', companyId: 'c1', active: true, name: 'Bruno' },
  semEmpresa: { id: 'semEmpresa', role: 'WORKER', companyId: null, active: true, name: 'Caio' },
  inativo: { id: 'inativo', role: 'WORKER', companyId: 'c1', active: false, name: 'Dora' },
  a1: { id: 'a1', role: 'ADMIN', companyId: 'c1', active: true, name: 'Admin 1' },
  a2: { id: 'a2', role: 'ADMIN', companyId: 'c1', active: true, name: 'Admin 2' },
  outra: { id: 'outra', role: 'ADMIN', companyId: 'c2', active: true, name: 'Outra empresa' },
  adminSemEmpresa: { id: 'adminSemEmpresa', role: 'ADMIN', companyId: null, active: true, name: 'Solto' },
}

// Nome exibido segue o resto do sistema: o do perfil, e na falta dele o do cadastro.
const fullNames: Record<string, string> = { w2: 'Bruno Lima' }

const prismaDouble = () => ({
  user: {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const user = users[where.id]
      if (!user) return null
      return { ...user, profile: fullNames[user.id] ? { fullName: fullNames[user.id] } : null }
    }),
    findMany: jest.fn(async ({ where }: { where: { companyId: string } }) =>
      Object.values(users)
        .filter((u) => u.role === 'ADMIN' && u.active && u.companyId === where.companyId)
        .map((u) => ({ id: u.id })),
    ),
  },
})

describe('LiveService', () => {
  const jwt = new JwtService({ secret })
  const token = (sub: string) => jwt.sign({ sub, role: 'WORKER' })
  let prisma: ReturnType<typeof prismaDouble>
  let live: LiveService
  let seq = 0

  beforeAll(() => {
    process.env.JWT_SECRET = secret
  })
  beforeEach(() => {
    seq = 0
    prisma = prismaDouble()
    live = new LiveService(jwt, prisma as unknown as PrismaService, new LiveRegistry(() => `sessao-${++seq}`))
  })

  const startAna = () => live.start('cel-1', token('w1'))
  const watchAna = (socketId = 'painel-1', who = 'a1') => live.watch(socketId, token(who), { workerId: 'w1' })

  describe('ligar', () => {
    it('funcionário com empresa liga e os administradores ativos da empresa são avisados', async () => {
      const outcome = await startAna()
      expect(outcome.reply).toEqual({ ok: true })
      expect(outcome.deliveries).toEqual([
        { userIds: ['a1', 'a2'], event: 'live.started', payload: { workerId: 'w1', name: 'Ana', startedAt: expect.any(String) } },
      ])
      expect(live.list('c1').map((b) => b.workerId)).toEqual(['w1'])
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: 'ADMIN', companyId: 'c1', active: true },
        select: { id: true },
      })
    })

    it('o nome vem do perfil quando há, como no chat e nos relatórios', async () => {
      const outcome = await live.start('cel-2', token('w2'))
      expect(outcome.deliveries[0]).toMatchObject({ payload: { workerId: 'w2', name: 'Bruno Lima' } })
      expect(live.list('c1')).toEqual([{ workerId: 'w2', name: 'Bruno Lima', startedAt: expect.any(String) }])
    })

    it('token vencido ou assinado com outro segredo não liga', async () => {
      const vencido = jwt.sign({ sub: 'w1', exp: Math.floor(Date.now() / 1000) - 60 })
      const alheio = new JwtService({ secret: 'outro-segredo' }).sign({ sub: 'w1' })
      expect(await live.start('cel-1', vencido)).toEqual({ reply: { ok: false, error: 'unauthorized' }, deliveries: [] })
      expect(await live.start('cel-1', alheio)).toEqual({ reply: { ok: false, error: 'unauthorized' }, deliveries: [] })
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it.each([
      ['token inválido', 'lixo', 'unauthorized'],
      ['token vazio', '', 'unauthorized'],
      ['usuário inativo', 'inativo', 'unauthorized'],
      ['usuário que não existe', 'fantasma', 'unauthorized'],
      ['administrador', 'a1', 'forbidden'],
      ['funcionário sem empresa', 'semEmpresa', 'no-company'],
    ])('%s não liga', async (_caso, who, error) => {
      const outcome = await live.start('cel-x', who === 'lixo' || who === '' ? who : token(who))
      expect(outcome).toEqual({ reply: { ok: false, error }, deliveries: [] })
      expect(live.list('c1')).toEqual([])
    })

    it('ligar de novo pelo mesmo socket não avisa ninguém', async () => {
      await startAna()
      expect(await startAna()).toEqual({ reply: { ok: true }, deliveries: [] })
    })

    it('ligar por outro socket avisa o aparelho antigo e derruba quem assistia a ele', async () => {
      await startAna()
      await watchAna()
      const outcome = await live.start('cel-2', token('w1'))
      expect(outcome.reply).toEqual({ ok: true })
      expect(outcome.deliveries).toEqual([
        { socketId: 'cel-1', event: 'live.closed', payload: { workerId: 'w1' } },
        { socketId: 'painel-1', event: 'live.ended', payload: { sessionId: 'sessao-1', workerId: 'w1' } },
        { userIds: ['a1', 'a2'], event: 'live.started', payload: { workerId: 'w1', name: 'Ana', startedAt: expect.any(String) } },
      ])
    })

    it('o aparelho antigo é avisado mesmo sem ninguém assistindo', async () => {
      await startAna()
      expect((await live.start('cel-2', token('w1'))).deliveries[0]).toEqual({
        socketId: 'cel-1',
        event: 'live.closed',
        payload: { workerId: 'w1' },
      })
    })

    it('falha ao buscar os administradores não impede de ligar', async () => {
      prisma.user.findMany.mockRejectedValueOnce(new Error('banco fora'))
      expect(await startAna()).toEqual({ reply: { ok: true }, deliveries: [] })
      expect(live.list('c1')).toHaveLength(1)
    })
  })

  describe('parar', () => {
    it('encerra, avisa quem assistia e os administradores', async () => {
      await startAna()
      await watchAna()
      expect(await live.stop('cel-1')).toEqual({
        reply: { ok: true },
        deliveries: [
          { socketId: 'painel-1', event: 'live.ended', payload: { sessionId: 'sessao-1', workerId: 'w1' } },
          { userIds: ['a1', 'a2'], event: 'live.stopped', payload: { workerId: 'w1' } },
        ],
      })
      expect(live.list('c1')).toEqual([])
    })

    it('quem não transmite pode pedir para parar sem efeito', async () => {
      await startAna()
      expect(await live.stop('painel-1', 'a1')).toEqual({ reply: { ok: true }, deliveries: [] })
      expect(await live.stop('cel-9', 'w2')).toEqual({ reply: { ok: true }, deliveries: [] })
      expect(live.list('c1')).toHaveLength(1)
    })

    it('o próprio funcionário para de outro socket dele, e o socket que transmitia é avisado', async () => {
      await startAna()
      expect((await live.stop('cel-2', 'w1')).deliveries).toEqual([
        { socketId: 'cel-1', event: 'live.closed', payload: { workerId: 'w1' } },
        { userIds: ['a1', 'a2'], event: 'live.stopped', payload: { workerId: 'w1' } },
      ])
      expect(live.list('c1')).toEqual([])
    })
  })

  describe('assistir', () => {
    it('administrador da empresa recebe a sessão e o celular é chamado para ofertar', async () => {
      await startAna()
      expect(await watchAna()).toEqual({
        reply: { ok: true, sessionId: 'sessao-1' },
        deliveries: [{ socketId: 'cel-1', event: 'live.viewer', payload: { sessionId: 'sessao-1' } }],
      })
    })

    it('o mesmo painel assistindo de novo fecha a sessão antiga no celular', async () => {
      await startAna()
      await watchAna()
      expect((await watchAna()).deliveries).toEqual([
        { socketId: 'cel-1', event: 'live.viewer-left', payload: { sessionId: 'sessao-1' } },
        { socketId: 'cel-1', event: 'live.viewer', payload: { sessionId: 'sessao-2' } },
      ])
    })

    it.each([
      ['funcionário', 'w2', 'forbidden'],
      ['administrador de outra empresa', 'outra', 'not-live'],
      ['administrador sem empresa', 'adminSemEmpresa', 'not-live'],
      ['usuário inativo', 'inativo', 'unauthorized'],
    ])('%s não assiste', async (_caso, who, error) => {
      await startAna()
      expect(await watchAna('painel-x', who)).toEqual({ reply: { ok: false, error }, deliveries: [] })
    })

    it('funcionário que não transmite responde not-live', async () => {
      expect(await watchAna()).toEqual({ reply: { ok: false, error: 'not-live' }, deliveries: [] })
    })

    it('o quarto administrador encontra a transmissão lotada', async () => {
      await startAna()
      await watchAna('painel-1')
      await watchAna('painel-2')
      await watchAna('painel-3', 'a2')
      expect(await watchAna('painel-4', 'a2')).toEqual({ reply: { ok: false, error: 'full' }, deliveries: [] })
    })

    it.each([[undefined], [null], ['w1'], [{}], [{ workerId: 7 }], [{ workerId: '' }], [{ workerId: 'x'.repeat(200) }]])(
      'pedido mal formado %# é recusado sem consultar o banco',
      async (payload) => {
        await startAna()
        prisma.user.findUnique.mockClear()
        expect(await live.watch('painel-1', token('a1'), payload)).toEqual({ reply: { ok: false, error: 'invalid' }, deliveries: [] })
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
      },
    )
  })

  describe('sair de assistir', () => {
    it('avisa o celular para fechar a conexão daquele painel', async () => {
      await startAna()
      await watchAna()
      expect(live.unwatch('painel-1', { sessionId: 'sessao-1' })).toEqual({
        reply: { ok: true },
        deliveries: [{ socketId: 'cel-1', event: 'live.viewer-left', payload: { sessionId: 'sessao-1' } }],
      })
    })

    it('sessão de outro painel ou já encerrada não muda nada', async () => {
      await startAna()
      await watchAna()
      expect(live.unwatch('painel-2', { sessionId: 'sessao-1' })).toEqual({ reply: { ok: true }, deliveries: [] })
      expect(live.unwatch('painel-1', { sessionId: 7 })).toEqual({ reply: { ok: false, error: 'invalid' }, deliveries: [] })
    })
  })

  describe('repasse de oferta, resposta e candidatos', () => {
    beforeEach(async () => {
      await startAna()
      await watchAna()
    })

    it('a oferta vai do celular para o painel', () => {
      expect(live.relay('offer', 'cel-1', { sessionId: 'sessao-1', sdp: 'v=0 oferta' })).toEqual({
        reply: { ok: true },
        deliveries: [{ socketId: 'painel-1', event: 'live.offer', payload: { sessionId: 'sessao-1', sdp: 'v=0 oferta' } }],
      })
    })

    it('a resposta vai do painel para o celular', () => {
      expect(live.relay('answer', 'painel-1', { sessionId: 'sessao-1', sdp: 'v=0 resposta' })).toEqual({
        reply: { ok: true },
        deliveries: [{ socketId: 'cel-1', event: 'live.answer', payload: { sessionId: 'sessao-1', sdp: 'v=0 resposta' } }],
      })
    })

    it('oferta do painel e resposta do celular são recusadas: só o celular oferta', () => {
      expect(live.relay('offer', 'painel-1', { sessionId: 'sessao-1', sdp: 'v=0' })).toEqual({ reply: { ok: false, error: 'forbidden' }, deliveries: [] })
      expect(live.relay('answer', 'cel-1', { sessionId: 'sessao-1', sdp: 'v=0' })).toEqual({ reply: { ok: false, error: 'forbidden' }, deliveries: [] })
    })

    it('candidatos vão nos dois sentidos, só com os campos conhecidos', () => {
      const candidate = { candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 50000 typ host', sdpMid: '0', sdpMLineIndex: 0, extra: 'fora' }
      expect(live.relay('candidate', 'cel-1', { sessionId: 'sessao-1', candidate }).deliveries).toEqual([
        {
          socketId: 'painel-1',
          event: 'live.candidate',
          payload: { sessionId: 'sessao-1', candidate: { candidate: candidate.candidate, sdpMid: '0', sdpMLineIndex: 0 } },
        },
      ])
      // Fim dos candidatos: texto vazio, sem mid nem índice.
      expect(live.relay('candidate', 'painel-1', { sessionId: 'sessao-1', candidate: { candidate: '' } }).deliveries).toEqual([
        { socketId: 'cel-1', event: 'live.candidate', payload: { sessionId: 'sessao-1', candidate: { candidate: '' } } },
      ])
    })

    it('socket de fora da sessão não repassa nada', () => {
      expect(live.relay('candidate', 'intruso', { sessionId: 'sessao-1', candidate: { candidate: '' } })).toEqual({
        reply: { ok: false, error: 'not-found' },
        deliveries: [],
      })
      expect(live.relay('offer', 'cel-1', { sessionId: 'sessao-9', sdp: 'v=0' })).toEqual({ reply: { ok: false, error: 'not-found' }, deliveries: [] })
    })

    it.each([
      ['sem sessão', 'offer', { sdp: 'v=0' }],
      ['sdp vazio', 'offer', { sessionId: 'sessao-1', sdp: '' }],
      ['sdp grande demais', 'offer', { sessionId: 'sessao-1', sdp: 'x'.repeat(LIVE_MAX_SDP_LENGTH + 1) }],
      ['candidato sem texto', 'candidate', { sessionId: 'sessao-1', candidate: { sdpMid: '0' } }],
      ['candidato grande demais', 'candidate', { sessionId: 'sessao-1', candidate: { candidate: 'x'.repeat(5000) } }],
      ['índice que não é inteiro', 'candidate', { sessionId: 'sessao-1', candidate: { candidate: '', sdpMLineIndex: 1.5 } }],
      ['nada', 'answer', null],
    ] as const)('%s é recusado', (_caso, kind, payload) => {
      expect(live.relay(kind, 'cel-1', payload)).toEqual({ reply: { ok: false, error: 'invalid' }, deliveries: [] })
    })
  })

  describe('queda de socket', () => {
    it('celular que cai encerra a transmissão como se tivesse parado', async () => {
      await startAna()
      await watchAna()
      expect(await live.leave('cel-1')).toEqual([
        { socketId: 'painel-1', event: 'live.ended', payload: { sessionId: 'sessao-1', workerId: 'w1' } },
        { userIds: ['a1', 'a2'], event: 'live.stopped', payload: { workerId: 'w1' } },
      ])
    })

    it('painel que cai libera a vaga e o celular fecha a conexão dele', async () => {
      await startAna()
      await watchAna()
      expect(await live.leave('painel-1')).toEqual([
        { socketId: 'cel-1', event: 'live.viewer-left', payload: { sessionId: 'sessao-1' } },
      ])
    })

    it('socket sem transmissão nem sessão não consulta o banco', async () => {
      prisma.user.findMany.mockClear()
      expect(await live.leave('qualquer')).toEqual([])
      expect(prisma.user.findMany).not.toHaveBeenCalled()
    })
  })

  it('administrador sem empresa não vê transmissão nenhuma', async () => {
    await startAna()
    expect(live.list(null)).toEqual([])
  })
})
