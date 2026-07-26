import { NotFoundException } from '@nestjs/common'
import { ReportsService } from './reports.service'

const media = () =>
  ({
    presignGet: jest.fn(async (k: string) => `signed:${k}`),
    presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  }) as any

const notifications = () => ({ enqueueForMany: jest.fn() }) as any

const prisma = () =>
  ({
    report: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    // Resolve nome do responsável → foto do Profile (o DTO devolve
    // responsibleAvatars). Default vazio: sem match, avatar ''.
    profile: { findMany: jest.fn().mockResolvedValue([]) },
    comment: { create: jest.fn() },
  }) as any

// Org-scoping (QA C1): Report não tem companyId próprio — a empresa é derivada
// do autor (author.companyId). Toda leitura/escrita compara com a empresa do
// requisitante; cross-org devolve null/NotFound.
const row = (over = {}) => ({
  id: 'r1',
  title: 'T',
  summary: null,
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Ana',
  authorAvatarKey: 'reports/av.jpg',
  creationDate: new Date('2026-01-02T00:00:00Z'), // 00:00 UTC = 21:00 BRT do dia 01

  sector: null,
  responsibles: ['Ana'],
  details: null,
  imageKeys: ['reports/x.jpg'],
  activities: [],
  author: { companyId: 'org1' },
  ...over,
})

describe('ReportsService', () => {
  it('list escopa pela empresa do autor, ordena por createdAt desc e mapeia keys→urls presigned', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([row()])
    const out = await new ReportsService(db, media(), notifications()).list('org1')
    expect(db.report.findMany).toHaveBeenCalledWith({
      where: { author: { companyId: 'org1' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      skip: 0,
    })
    expect(out.items[0].images).toEqual(['signed:reports/x.jpg'])
    expect(out.items[0].imageKeys).toEqual(['reports/x.jpg']) // keys crus coexistem com as urls presigned
    expect(out.items[0].authorAvatarUri).toBe('signed:reports/av.jpg')
    expect(out.items[0].creationDate).toBe('01/01/2026') // BRT (UTC-3) rola pro dia anterior
    expect(out.items[0].summary).toBe('') // null → '' (telas exigem string)
  })

  // QA de volume (2026-07-26): 262 relatórios no banco, a API devolvia 200 e a
  // tela não dizia nada — 62 sumiam em silêncio. O total vem junto pra UI poder
  // avisar, e limit/offset permitem buscar o resto.
  it('list devolve o TOTAL da empresa junto (não só a página) e aceita limit/offset', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([row()])
    db.report.count.mockResolvedValue(262)
    const out = await new ReportsService(db, media(), notifications()).list('org1', { limit: 50, offset: 100 })
    expect(db.report.findMany).toHaveBeenCalledWith({
      where: { author: { companyId: 'org1' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 100,
    })
    // count usa o MESMO where da página — total da empresa, não do banco todo.
    expect(db.report.count).toHaveBeenCalledWith({ where: { author: { companyId: 'org1' } } })
    expect(out.total).toBe(262)
  })

  it('list satura o limit no cap de segurança e ignora offset negativo', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([])
    db.report.count.mockResolvedValue(0)
    await new ReportsService(db, media(), notifications()).list('org1', { limit: 5000, offset: -10 })
    const arg = db.report.findMany.mock.calls[0][0]
    expect(arg.take).toBe(200)
    expect(arg.skip).toBe(0)
  })

  it('DTO carrega os imageKeys crus além das urls presigned (destrava edição de anexo)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(row({ imageKeys: ['reports/a.jpg', 'reports/b.jpg'], comments: [] }))
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    expect(out!.imageKeys).toEqual(['reports/a.jpg', 'reports/b.jpg']) // keys crus, sem presign
    expect(out!.images).toEqual(['signed:reports/a.jpg', 'signed:reports/b.jpg']) // urls presigned coexistem
  })

  // O painel pintava uma rotação fixa de 3 PNGs decorativos ao lado de
  // "Responsáveis:" — caras que não eram das pessoas listadas, e uma pílula
  // "+13" literal (QA 2026-07-26). O DTO agora resolve nome → foto real.
  it('resolve a foto de cada responsável pelo nome, na mesma ordem', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(
      row({ responsibles: ['Jennifer Gomes', 'Sem Cadastro', 'Josué Oliveira'], comments: [] }),
    )
    db.profile.findMany.mockResolvedValue([
      { fullName: 'Josué Oliveira', avatarKey: 'chat/avatars/worker-3.png' },
      { fullName: 'Jennifer Gomes', avatarKey: 'chat/avatars/worker-6.png' },
    ])
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    expect(db.profile.findMany.mock.calls[0][0].where).toEqual({
      fullName: { in: ['Jennifer Gomes', 'Sem Cadastro', 'Josué Oliveira'] },
    })
    // Ordem preservada; quem não está no diretório vira '' (placeholder), nunca
    // a foto de outra pessoa.
    expect(out!.responsibleAvatars).toEqual([
      'signed:chat/avatars/worker-6.png',
      '',
      'signed:chat/avatars/worker-3.png',
    ])
  })

  it('sem responsáveis não consulta o banco por avatar', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(row({ responsibles: [], comments: [] }))
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    expect(out!.responsibleAvatars).toEqual([])
    expect(db.profile.findMany).not.toHaveBeenCalled()
  })

  // Decisão 2026-07-26 (seguir o Figma): cada atividade tem o grupo de rostos
  // da EQUIPE REAL — responsibleNames no Json, resolvidos pra foto no detalhe.
  it('resolve as fotos das equipes por atividade, em UMA query, ordem preservada', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(
      row({
        responsibles: [], // isola a query das atividades da query dos responsáveis
        comments: [],
        activities: [
          { title: 'Manutenção de motores', responsibleNames: ['Josué Oliveira', 'Sem Cadastro'] },
          { title: 'Ajustes elétricos', responsibleNames: ['Josué Oliveira'] },
        ],
      }),
    )
    db.profile.findMany.mockResolvedValue([
      { fullName: 'Josué Oliveira', avatarKey: 'chat/avatars/worker-3.png' },
    ])
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    // Nomes únicos das DUAS atividades numa única ida ao banco.
    expect(db.profile.findMany).toHaveBeenCalledTimes(1)
    expect(db.profile.findMany.mock.calls[0][0].where).toEqual({
      fullName: { in: ['Josué Oliveira', 'Sem Cadastro'] },
    })
    const acts = out!.activities as Array<{ responsibleAvatars: string[] }>
    expect(acts[0].responsibleAvatars).toEqual(['signed:chat/avatars/worker-3.png', ''])
    expect(acts[1].responsibleAvatars).toEqual(['signed:chat/avatars/worker-3.png'])
  })

  it('atividade sem responsibleNames passa intocada (sem query, sem campo inventado)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(
      row({ responsibles: [], comments: [], activities: [{ title: 'Só texto' }] }),
    )
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    expect(db.profile.findMany).not.toHaveBeenCalled()
    expect(out!.activities).toEqual([{ title: 'Só texto' }])
  })

  it('get inexistente → null', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    expect(await new ReportsService(db, media(), notifications()).get('nope', 'org1')).toBeNull()
  })

  it('get de relatório de OUTRA empresa → null (não vaza conteúdo)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(row({ comments: [], author: { companyId: 'org2' } }))
    expect(await new ReportsService(db, media(), notifications()).get('r1', 'org1')).toBeNull()
  })

  it('create seta authorId do JWT, denorm do profile e defaults', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      name: 'Fallback',
      companyId: 'org1',
      profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg', sector: 'Noroeste' },
    })
    db.report.create.mockResolvedValue(row({ authorName: 'Ana Perfil' }))
    db.user.findMany.mockResolvedValue([])
    await new ReportsService(db, media(), notifications()).create('u1', {
      title: 'T',
      responsibles: [],
      imageKeys: ['reports/x.jpg'],
    } as any)
    const arg = db.report.create.mock.calls[0][0].data
    expect(arg.authorId).toBe('u1')
    expect(arg.authorName).toBe('Ana Perfil')
    expect(arg.sector).toBe('Noroeste')
    expect(arg.status).toBe('pending')
    expect(arg.statusLabel).toBe('Em Revisão')
    expect(arg.activities).toEqual([])
  })

  it('create sem profile usa user.name como authorName', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', companyId: 'org1', profile: null })
    db.report.create.mockResolvedValue(row())
    db.user.findMany.mockResolvedValue([])
    await new ReportsService(db, media(), notifications()).create('u1', { title: 'T' } as any)
    expect(db.report.create.mock.calls[0][0].data.authorName).toBe('Fallback')
  })

  it('create faz broadcast só pros workers aprovados DA MESMA empresa (best-effort)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'A', companyId: 'org1', profile: null })
    db.report.create.mockResolvedValue(row({ id: 'r9', title: 'R9' }))
    db.user.findMany.mockResolvedValue([{ id: 'w2' }, { id: 'w3' }])
    const notif = notifications()
    await new ReportsService(db, media(), notif).create('author-1', { title: 'R9' } as any)
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: 'author-1' }, companyId: 'org1' },
      select: { id: true },
    })
    expect(notif.enqueueForMany).toHaveBeenCalledWith(['w2', 'w3'], expect.objectContaining({ domain: 'reports', title: 'Novo relatório', body: 'R9', targetId: 'r9' }))
  })

  it('create não quebra se o broadcast falhar (best-effort)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'A', companyId: 'org1', profile: null })
    db.report.create.mockResolvedValue(row({ id: 'r9', title: 'R9' }))
    db.user.findMany.mockResolvedValue([{ id: 'w2' }])
    const notif = notifications()
    notif.enqueueForMany.mockRejectedValue(new Error('boom'))
    const out = await new ReportsService(db, media(), notif).create('author-1', { title: 'R9' } as any)
    expect(out.id).toBe('r9')
  })

  it('update aplica só os campos fornecidos e devolve o DTO (mesma empresa)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1', author: { companyId: 'org1' } })
    db.report.update.mockResolvedValue(row({ title: 'Novo', status: 'accept', statusLabel: 'Aceito' }))
    const out = await new ReportsService(db, media(), notifications()).update('r1', 'u1', {
      title: 'Novo',
      status: 'accept',
      statusLabel: 'Aceito',
    } as any, 'org1')
    const arg = db.report.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'r1' })
    expect(arg.data).toEqual({ title: 'Novo', status: 'accept', statusLabel: 'Aceito' })
    expect(out.title).toBe('Novo')
    expect(out.status).toBe('accept')
    expect(out.statusLabel).toBe('Aceito')
  })

  it('update de relatório de outra empresa → NotFound sem tocar no update', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1', author: { companyId: 'org2' } })
    await expect(
      new ReportsService(db, media(), notifications()).update('r1', 'u1', { title: 'x' } as any, 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.report.update).not.toHaveBeenCalled()
  })

  it('update inexistente → NotFoundException', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    await expect(
      new ReportsService(db, media(), notifications()).update('nope', 'u1', { title: 'x' } as any, 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('addComment cria comentário e devolve o DTO (authorName do profile, avatar presigned)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1', author: { companyId: 'org1' } })
    db.user.findUnique.mockResolvedValue({
      name: 'Fallback',
      companyId: 'org1',
      profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg' },
    })
    db.comment.create.mockResolvedValue({
      id: 'c1',
      reportId: 'r1',
      authorId: 'u1',
      body: 'Comentário',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    const out = await new ReportsService(db, media(), notifications()).addComment('r1', 'u1', { body: 'Comentário' } as any)
    expect(db.report.findUnique).toHaveBeenCalledWith({
      where: { id: 'r1' },
      select: { id: true, author: { select: { companyId: true } } },
    })
    expect(db.comment.create.mock.calls[0][0].data).toEqual({ reportId: 'r1', authorId: 'u1', body: 'Comentário' })
    expect(out).toEqual({
      id: 'c1',
      body: 'Comentário',
      authorName: 'Ana Perfil',
      authorAvatarUri: 'signed:reports/av.jpg',
      createdAt: '01/01/2026',
    })
  })

  it('addComment sem profile usa user.name e avatar vazio', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1', author: { companyId: 'org1' } })
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', companyId: 'org1', profile: null })
    db.comment.create.mockResolvedValue({
      id: 'c2',
      reportId: 'r1',
      authorId: 'u1',
      body: 'Oi',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    const out = await new ReportsService(db, media(), notifications()).addComment('r1', 'u1', { body: 'Oi' } as any)
    expect(out.authorName).toBe('Fallback')
    expect(out.authorAvatarUri).toBe('')
  })

  it('addComment em relatório inexistente → NotFoundException', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    await expect(
      new ReportsService(db, media(), notifications()).addComment('nope', 'u1', { body: 'x' } as any),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('addComment em relatório de OUTRA empresa → NotFound sem criar nada', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1', author: { companyId: 'org2' } })
    db.user.findUnique.mockResolvedValue({ name: 'Eu', companyId: 'org1', profile: null })
    await expect(
      new ReportsService(db, media(), notifications()).addComment('r1', 'u1', { body: 'x' } as any),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('get embute comments ordenados por createdAt asc, cada um com seu autor', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(
      row({
        comments: [
          {
            id: 'c1',
            reportId: 'r1',
            authorId: 'u1',
            body: 'Primeiro',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            author: { name: 'Ana', profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg' } },
          },
          {
            id: 'c2',
            reportId: 'r1',
            authorId: 'u2',
            body: 'Segundo',
            createdAt: new Date('2026-01-03T00:00:00Z'),
            author: { name: 'Bruno', profile: null },
          },
        ],
      }),
    )
    const out = await new ReportsService(db, media(), notifications()).get('r1', 'org1')
    expect(db.report.findUnique).toHaveBeenCalledWith({
      where: { id: 'r1' },
      include: {
        author: { select: { companyId: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { include: { profile: true } } },
        },
      },
    })
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(out!.comments).toEqual([
      { id: 'c1', body: 'Primeiro', authorName: 'Ana Perfil', authorAvatarUri: 'signed:reports/av.jpg', createdAt: '01/01/2026' },
      { id: 'c2', body: 'Segundo', authorName: 'Bruno', authorAvatarUri: '', createdAt: '02/01/2026' },
    ])
  })
})
