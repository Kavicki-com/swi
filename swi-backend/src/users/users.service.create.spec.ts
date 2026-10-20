import { ConflictException, Logger } from '@nestjs/common'
import type { Role } from '@prisma/client'
import { UsersService } from './users.service'

// Cadastro pelo painel manda as credenciais por e-mail. O que esta suíte prova
// é a ordem (grava, depois envia), o que chega ao serviço de e-mail e o
// melhor esforço: e-mail que falha não desfaz cadastro, e a senha não vaza no
// log. O bcrypt real fica fora: custo 12 por teste só atrasaria a suíte sem
// provar nada daqui.
jest.mock('../auth/codes', () => ({ hash: jest.fn(async () => 'hash-de-teste') }))

const prisma = () => ({ user: { findUnique: jest.fn(), create: jest.fn() } }) as any
const media = () => ({ presignGet: jest.fn((k: string) => Promise.resolve('signed:' + k)) }) as any
const realtime = () => ({ disconnectUser: jest.fn() }) as any
const mail = () => ({ sendPanelCredentials: jest.fn().mockResolvedValue(undefined) }) as any

const dto = { name: 'Nova Pessoa', email: 'nova@ex.com', password: 'Senha@2026' }
const gravado = (role: Role) => ({
  id: 'u-novo', name: 'Nova Pessoa', email: 'nova@ex.com', role, approvalStatus: 'APPROVED', active: true,
  companyId: 'org1', companyRole: null, username: null, createdAt: new Date('2026-01-01T00:00:00Z'), profile: null,
})

function monta(role: Role = 'WORKER') {
  const db = prisma()
  // Primeira consulta: findByEmail (ninguém com o e-mail). Segunda: empresa do admin.
  db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ companyId: 'org1' })
  db.user.create.mockResolvedValue(gravado(role))
  const m = mail()
  return { db, m, svc: new UsersService(db, media(), realtime(), m) }
}

describe('UsersService.create: credenciais por e-mail', () => {
  const urlAntes = process.env.ADMIN_APP_URL
  afterEach(() => {
    if (urlAntes === undefined) delete process.env.ADMIN_APP_URL
    else process.env.ADMIN_APP_URL = urlAntes
    jest.restoreAllMocks()
  })

  it('grava primeiro, depois envia login e senha, e a resposta confirma o envio', async () => {
    const { db, m, svc } = monta()
    const r = await svc.create('admin-1', { ...dto, role: 'WORKER' })
    expect(m.sendPanelCredentials).toHaveBeenCalledWith('nova@ex.com', {
      name: 'Nova Pessoa',
      email: 'nova@ex.com',
      password: 'Senha@2026',
    })
    expect(db.user.create.mock.invocationCallOrder[0]).toBeLessThan(m.sendPanelCredentials.mock.invocationCallOrder[0])
    expect(r).toMatchObject({ id: 'u-novo', email: 'nova@ex.com', credentialsEmailSent: true })
  })

  it('quem entra pelo painel recebe a URL do painel; o funcionário, não', async () => {
    process.env.ADMIN_APP_URL = 'https://painel.teste'
    const sup = monta('SUPERVISOR')
    await sup.svc.create('admin-1', { ...dto, role: 'SUPERVISOR' })
    expect(sup.m.sendPanelCredentials.mock.calls[0][1]).toMatchObject({ panelUrl: 'https://painel.teste' })

    const w = monta('WORKER')
    await w.svc.create('admin-1', { ...dto, role: 'WORKER' })
    expect(w.m.sendPanelCredentials.mock.calls[0][1]).not.toHaveProperty('panelUrl')
  })

  it('e-mail que falha não desfaz o cadastro: a resposta diz que não saiu e a senha fica fora do log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { m, svc } = monta()
    m.sendPanelCredentials.mockRejectedValue(new Error('smtp fora do ar'))
    const r = await svc.create('admin-1', { ...dto, role: 'WORKER' })
    expect(r).toMatchObject({ id: 'u-novo', credentialsEmailSent: false })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('u-novo')
    expect(String(warn.mock.calls[0][0])).not.toContain('Senha@2026')
  })

  it('e-mail já cadastrado: 409 antes de gravar, e nada é enviado', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce({ id: 'ja-existe' })
    const m = mail()
    await expect(
      new UsersService(db, media(), realtime(), m).create('admin-1', { ...dto, role: 'WORKER' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(db.user.create).not.toHaveBeenCalled()
    expect(m.sendPanelCredentials).not.toHaveBeenCalled()
  })
})
