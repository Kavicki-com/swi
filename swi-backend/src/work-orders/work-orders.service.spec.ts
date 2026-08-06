import { BadRequestException, NotFoundException } from '@nestjs/common'
import { WorkOrdersService } from './work-orders.service'

const media = () =>
  ({
    presignGet: jest.fn(async (k: string) => `signed:${k}`),
    presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  }) as any

const notifications = () => ({ enqueueForMany: jest.fn() }) as any

const prisma = () => {
  const db: any = {
    workOrder: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
  db.$transaction = jest.fn(async (cb: any) => cb(db))
  return db
}

// Org-scoping (QA C1): WorkOrder não tem companyId — a empresa é a do autor.
// Detalhe devolvido por get (create/update chamam o detail interno na volta).
const detailRow = (over: any = {}) => ({
  id: 'o1', title: 'Ordem', summary: 'Resumo', details: 'Detalhes', sector: 'Norte',
  estimatedMinutes: 120, startDate: null, dueDate: null, status: 'pending', imageKeys: ['order/a.jpg'],
  createdAt: new Date('2026-03-10T12:00:00.000Z'),
  author: { name: 'Admin', companyId: 'org1', profile: { fullName: 'Admin Full', avatarKey: 'chat/av-admin.png' } },
  responsibles: [
    { id: 'u1', name: 'W1', profile: { fullName: 'Worker Um', jobTitle: 'Op', sector: 'Norte', birthDate: new Date('1990-05-04'), avatarKey: 'chat/av1.png' } },
  ],
  items: [{ id: 't1', position: 0, title: 'Item 1', description: 'd1', status: 'pending', startedAt: null, accumulatedSeconds: 0, estimatedMinutes: null }],
  ...over,
})

// Estado existente lido SOB a trava no update (items+responsáveis+estimativa+autor).
const existingRow = (over: any = {}) => ({
  id: 'o1', title: 'Ordem', summary: 'S', details: 'D', sector: 'N',
  estimatedMinutes: 120, startDate: null, dueDate: null, status: 'in_progress', imageKeys: [],
  author: { companyId: 'org1' },
  items: [
    { id: 't1', position: 0, title: 'Item 1', description: 'd1', status: 'pending' },
    { id: 't2', position: 1, title: 'Item 2', description: 'd2', status: 'done' },
  ],
  responsibles: [{ id: 'u1' }, { id: 'u2' }],
  ...over,
})

describe('WorkOrdersService', () => {
  // ---------------- create ----------------
  it('create com checklist: valida responsáveis NA EMPRESA, cria itens, rateia e devolve o shape do get', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    db.workOrder.create.mockResolvedValue({ id: 'o1', title: 'Ordem' })
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const out = await new WorkOrdersService(db, media(), notifications()).create('admin1', {
      title: 'Ordem', summary: 'Resumo', estimatedMinutes: 100,
      responsibleIds: ['u1', 'u2'],
      items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
    }, 'org1')
    // validateResponsibles restrito à empresa do admin — worker de outra org é inválido.
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['u1', 'u2'] }, role: 'WORKER', approvalStatus: 'APPROVED', companyId: 'org1',
    })
    const data = db.workOrder.create.mock.calls[0][0].data
    expect(data.authorId).toBe('admin1')
    expect(data.responsibles).toEqual({ connect: [{ id: 'u1' }, { id: 'u2' }] })
    expect(data.items.create).toHaveLength(3)
    expect(data.items.create.map((i: any) => i.title)).toEqual(['A', 'B', 'C'])
    expect(data.items.create.map((i: any) => i.position)).toEqual([0, 1, 2])
    expect(data.items.create.map((i: any) => i.estimatedMinutes)).toEqual([34, 33, 33]) // rateio 100/3
    expect(out.id).toBe('o1')
  })

  it('create sem checklist: cria 1 item automático (título do pai, descrição=summary) — Decisão B', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }])
    db.workOrder.create.mockResolvedValue({ id: 'o1', title: 'Ordem X' })
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    await new WorkOrdersService(db, media(), notifications()).create('admin1', {
      title: 'Ordem X', summary: 'O resumo', estimatedMinutes: 60, responsibleIds: ['u1'],
    }, 'org1')
    const items = db.workOrder.create.mock.calls[0][0].data.items.create
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Ordem X')
    expect(items[0].description).toBe('O resumo')
    expect(items[0].estimatedMinutes).toBe(60) // rateio 60/1
  })

  it('create com responsável inválido (não-worker/não-aprovado/outra org) → 400 e NÃO cria', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }]) // só 1 dos 2 casou o filtro
    await expect(
      new WorkOrdersService(db, media(), notifications()).create('admin1', {
        title: 'T', responsibleIds: ['u1', 'u2'],
      } as any, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.workOrder.create).not.toHaveBeenCalled()
  })

  it('create enfileira notificação pros responsáveis (domain journey, targetId=order.id)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    db.workOrder.create.mockResolvedValue({ id: 'o9', title: 'Ordem 9' })
    db.workOrder.findUnique.mockResolvedValue(detailRow({ id: 'o9' }))
    const notif = notifications()
    await new WorkOrdersService(db, media(), notif).create('admin1', {
      title: 'Ordem 9', responsibleIds: ['u1', 'u2'],
    }, 'org1')
    expect(notif.enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({
      domain: 'journey', title: 'Nova tarefa atribuída', body: 'Ordem 9', targetId: 'o9',
    }))
  })

  it('create deduplica os destinatários da notificação (não empurra push duplicado)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) // 2 ids únicos válidos
    db.workOrder.create.mockResolvedValue({ id: 'o1', title: 'Ordem' })
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const notif = notifications()
    await new WorkOrdersService(db, media(), notif).create('admin1', {
      title: 'Ordem', responsibleIds: ['u1', 'u1', 'u2'], // 'u1' duplicado no payload
    }, 'org1')
    expect(notif.enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.anything()) // deduplicado
  })

  it('create não quebra se o enqueue falhar (best-effort)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([{ id: 'u1' }])
    db.workOrder.create.mockResolvedValue({ id: 'o1', title: 'Ordem' })
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const notif = notifications()
    notif.enqueueForMany.mockRejectedValue(new Error('boom'))
    const out = await new WorkOrdersService(db, media(), notif).create('admin1', { title: 'Ordem', responsibleIds: ['u1'] }, 'org1')
    expect(out.id).toBe('o1')
  })

  // ---------------- list ----------------
  it('list escopa pela empresa do autor, filtra por status e deriva progressPct do TEMPO', async () => {
    const db = prisma()
    db.workOrder.findMany.mockResolvedValue([
      {
        id: 'o1', title: 'A', sector: 'N', status: 'in_progress', estimatedMinutes: 100,
        // 2 itens concluídos de 4 dariam 50% na régua antiga (checklist); por
        // TEMPO são 30min de 100 = 30%.
        items: [
          { status: 'done', startedAt: null, accumulatedSeconds: 900, estimatedMinutes: 25 },
          { status: 'done', startedAt: null, accumulatedSeconds: 900, estimatedMinutes: 25 },
          { status: 'pending', startedAt: null, accumulatedSeconds: 0, estimatedMinutes: 25 },
          { status: 'pending', startedAt: null, accumulatedSeconds: 0, estimatedMinutes: 25 },
        ],
        responsibles: [{ profile: { avatarKey: 'chat/av1.png' } }, { profile: { avatarKey: null } }],
      },
    ])
    const out = await new WorkOrdersService(db, media(), notifications()).list('in_progress', 'org1')
    expect(db.workOrder.findMany.mock.calls[0][0].where).toEqual({ status: 'in_progress', author: { companyId: 'org1' } })
    expect(db.workOrder.findMany.mock.calls[0][0].take).toBe(200)
    expect(out[0].progressPct).toBe(30) // 1800s de 100min
    expect(out[0].responsibleCount).toBe(2)
    // #5: index-parallel com responsibleCount — o responsável sem avatarKey vira ''
    // (não filtrado), senão o "+N" do overflow e o pareamento nome↔avatar erram.
    expect(out[0].responsibleAvatars).toEqual(['signed:chat/av1.png', ''])
    expect(out[0].sector).toBe('N')
  })

  it('list sem status ainda escopa pela empresa', async () => {
    const db = prisma()
    db.workOrder.findMany.mockResolvedValue([])
    await new WorkOrdersService(db, media(), notifications()).list(undefined, 'org1')
    expect(db.workOrder.findMany.mock.calls[0][0].where).toEqual({ author: { companyId: 'org1' } })
  })

  // ---------------- get ----------------
  it('get inexistente → 404', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValue(null)
    await expect(new WorkOrdersService(db, media(), notifications()).get('nope', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('get de tarefa de OUTRA empresa → 404 (não vaza conteúdo)', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValue(detailRow({ author: { name: 'X', companyId: 'org2', profile: null } }))
    await expect(new WorkOrdersService(db, media(), notifications()).get('o1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('get monta o detalhe: autor, responsáveis (sem bloodType, birthDate ISO), itens e imagens presignadas', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const out = await new WorkOrdersService(db, media(), notifications()).get('o1', 'org1')
    expect(out.author).toEqual({ name: 'Admin Full', avatar: 'signed:chat/av-admin.png' })
    expect(out.responsibles[0]).toEqual({
      id: 'u1', name: 'Worker Um', jobTitle: 'Op', sector: 'Norte',
      birthDate: new Date('1990-05-04').toISOString(), avatar: 'signed:chat/av1.png',
    })
    expect(out.responsibles[0]).not.toHaveProperty('bloodType') // Decisão 2
    expect(out.images).toEqual(['signed:order/a.jpg'])
    expect(out.items).toEqual([
      { id: 't1', title: 'Item 1', description: 'd1', status: 'pending',
        startedAt: null, accumulatedSeconds: 0, estimatedMinutes: null },
    ])
    expect(out.progressPct).toBe(0)
  })

  it('get expõe imageKeys cruas junto das URLs assinadas (destrava edição de anexo no admin)', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const out = await new WorkOrdersService(db, media(), notifications()).get('o1', 'org1')
    // Par posicional: images[i] é a URL assinada de imageKeys[i]. O PATCH
    // substitui o array inteiro, então o form precisa das keys pra reenviar
    // as existentes (URL assinada não passa no regex ^order/<uuid>.(jpg|png)$).
    expect(out.imageKeys).toEqual(['order/a.jpg'])
    expect(out.images).toEqual(['signed:order/a.jpg'])
  })

  it('get expõe createdAt em ISO (tela de detalhe mostra "Data de criação")', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValue(detailRow())
    const out = await new WorkOrdersService(db, media(), notifications()).get('o1', 'org1')
    expect(out.createdAt).toBe('2026-03-10T12:00:00.000Z')
  })

  // ---------------- update ----------------
  it('update reconcilia itens: update do existente, create do novo, delete do ausente', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow()).mockResolvedValue(detailRow())
    await new WorkOrdersService(db, media(), notifications()).update('o1', {
      items: [
        { id: 't1', title: 'Item 1 editado', description: 'd1x' },
        { title: 'Item novo' },
      ],
    }, 'org1')
    expect(db.task.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['t2'] } } }) // t2 fora do payload
    const upd = db.task.update.mock.calls.find((c: any) => c[0].where.id === 't1')[0].data
    expect(upd.title).toBe('Item 1 editado')
    expect(upd.description).toBe('d1x')
    expect(upd.position).toBe(0)
    const cre = db.task.create.mock.calls[0][0].data
    expect(cre.title).toBe('Item novo')
    expect(cre.position).toBe(1)
    expect(cre.orderId).toBe('o1')
    expect(db.workOrder.update).toHaveBeenCalled() // recompute do pai
  })

  it('update de tarefa de OUTRA empresa → 404 sem tocar em nada', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow({ author: { companyId: 'org2' } }))
    await expect(
      new WorkOrdersService(db, media(), notifications()).update('o1', { title: 'X' } as any, 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.workOrder.update).not.toHaveBeenCalled()
    expect(db.task.deleteMany).not.toHaveBeenCalled()
  })

  it('update com items:[] (esvazia o checklist) → 400 e não toca nos itens', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow())
    await expect(
      new WorkOrdersService(db, media(), notifications()).update('o1', { items: [] } as any, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.task.create).not.toHaveBeenCalled()
    expect(db.task.deleteMany).not.toHaveBeenCalled()
  })

  it('update com item id inexistente no payload → 400', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow())
    await expect(
      new WorkOrdersService(db, media(), notifications()).update('o1', { items: [{ id: 'ghost', title: 'X' }] } as any, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('update com id de item DUPLICADO no payload → 400 (não apaga silenciosamente o irmão)', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow()) // itens t1, t2
    await expect(
      // t1 repetido, t2 omitido: o guard antigo (Set) deletaria t2 e faria 2 updates em t1.
      new WorkOrdersService(db, media(), notifications()).update('o1', {
        items: [{ id: 't1', title: 'A' }, { id: 't1', title: 'B' }],
      } as any, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.task.deleteMany).not.toHaveBeenCalled() // nada foi apagado
  })

  it('update de ordem inexistente → 404', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(null)
    await expect(
      new WorkOrdersService(db, media(), notifications()).update('nope', { title: 'X' } as any, 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('update notifica SÓ os responsáveis recém-adicionados', async () => {
    const db = prisma()
    db.workOrder.findUnique
      .mockResolvedValueOnce(existingRow({ responsibles: [{ id: 'u1' }, { id: 'u2' }] }))
      .mockResolvedValue(detailRow())
    db.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u3' }]) // novo conjunto (u2 sai, u3 entra)
    const notif = notifications()
    await new WorkOrdersService(db, media(), notif).update('o1', { responsibleIds: ['u1', 'u3'] }, 'org1')
    expect(notif.enqueueForMany).toHaveBeenCalledTimes(1)
    expect(notif.enqueueForMany).toHaveBeenCalledWith(['u3'], expect.objectContaining({ domain: 'journey', targetId: 'o1' }))
    expect(db.workOrder.update.mock.calls.some((c: any) => c[0].data.responsibles?.set)).toBe(true) // set aplicado no pai
  })

  it('update re-rateia a estimativa quando o conjunto de itens muda', async () => {
    const db = prisma()
    db.workOrder.findUnique
      .mockResolvedValueOnce(existingRow({ estimatedMinutes: 90, items: [{ id: 't1', position: 0, title: 'I1', description: null, status: 'pending' }] }))
      .mockResolvedValue(detailRow())
    await new WorkOrdersService(db, media(), notifications()).update('o1', {
      items: [{ id: 't1', title: 'I1' }, { title: 'I2' }, { title: 'I3' }],
    }, 'org1')
    const t1 = db.task.update.mock.calls.find((c: any) => c[0].where.id === 't1')[0].data
    expect(t1.estimatedMinutes).toBe(30) // 90/3
    expect(db.task.create.mock.calls.map((c: any) => c[0].data.estimatedMinutes)).toEqual([30, 30])
  })

  it('update NÃO re-rateia quando só edita título (conjunto e estimativa iguais)', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow()).mockResolvedValue(detailRow())
    await new WorkOrdersService(db, media(), notifications()).update('o1', {
      items: [{ id: 't1', title: 'Novo título' }, { id: 't2', title: 'Item 2' }],
    }, 'org1')
    for (const c of db.task.update.mock.calls) expect(c[0].data.estimatedMinutes).toBeUndefined()
    const t1 = db.task.update.mock.calls.find((c: any) => c[0].where.id === 't1')[0].data
    expect(t1.title).toBe('Novo título')
    expect(t1.position).toBe(0)
    expect(db.task.create).not.toHaveBeenCalled()
    expect(db.task.deleteMany).not.toHaveBeenCalled()
  })

  it('update roda sob transação e trava o pai; edição SEM mudança de conjunto NÃO recomputa (Fix 4)', async () => {
    const db = prisma()
    db.workOrder.findUnique.mockResolvedValueOnce(existingRow()).mockResolvedValue(detailRow())
    await new WorkOrdersService(db, media(), notifications()).update('o1', { title: 'Renomeada' }, 'org1')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$queryRaw).toHaveBeenCalled() // lockOrder (SELECT ... FOR UPDATE)
    // gate do Fix 4: sem add/delete, o status derivado não muda → recompute é pulado.
    expect(db.task.findMany).not.toHaveBeenCalled()
    expect(db.workOrder.update.mock.calls.some((c: any) => c[0].data.status)).toBe(false)
  })

  it('update: DELETE que deixa todos os restantes done vira o pai para done (recompute roda na mudança de conjunto)', async () => {
    const db = prisma()
    db.workOrder.findUnique
      .mockResolvedValueOnce(existingRow({ items: [
        { id: 't1', position: 0, title: 'I1', description: null, status: 'done' },
        { id: 't2', position: 1, title: 'I2', description: null, status: 'pending' },
      ] }))
      .mockResolvedValue(detailRow())
    db.task.findMany.mockResolvedValue([{ status: 'done' }]) // sobra só t1 (done)
    await new WorkOrdersService(db, media(), notifications()).update('o1', {
      items: [{ id: 't1', title: 'I1' }], // t2 deletado → conjunto muda
    }, 'org1')
    expect(db.task.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['t2'] } } })
    const statusCall = db.workOrder.update.mock.calls.find((c: any) => c[0].data.status)
    expect(statusCall[0].data.status).toBe('done') // recompute rodou e virou o pai
  })

  // ---------------- assignable ----------------
  it('listAssignable devolve só workers aprovados DA EMPRESA (where trava role+approvalStatus+companyId)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      { id: 'u1', name: 'W1', profile: { fullName: 'Worker Um', jobTitle: 'Op', sector: 'N', birthDate: new Date('1988-03-02'), avatarKey: 'chat/av1.png' } },
      { id: 'u2', name: 'W2', profile: null },
    ])
    const out = await new WorkOrdersService(db, media(), notifications()).listAssignable('org1')
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ role: 'WORKER', approvalStatus: 'APPROVED', companyId: 'org1' })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      id: 'u1', name: 'Worker Um', jobTitle: 'Op', sector: 'N',
      birthDate: new Date('1988-03-02').toISOString(), avatar: 'signed:chat/av1.png',
    })
    expect(out[1]).toEqual({ id: 'u2', name: 'W2', jobTitle: '', sector: '', birthDate: null, avatar: '' })
  })
})
