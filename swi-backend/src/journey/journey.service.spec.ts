import { JourneyService } from './journey.service'

const media = () => ({
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
}) as any

const prisma = () => {
  const db: any = {
    journey: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn(), update: jest.fn() },
    task: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    workOrder: { update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  db.$transaction = jest.fn(async (cb: any) => cb(db))
  return db
}

// WorkOrder pai (incluído em cada task): objetivo=summary, anexos=imageKeys,
// avatares/nomes derivados dos profiles dos responsáveis.
const orderRow = (over = {}) => ({
  id: 'o1', summary: 'Checklist de manutenção', imageKeys: ['order/a.jpg'],
  responsibles: [
    { id: 'u1', name: 'Worker Demo', profile: { fullName: 'Worker Demo', avatarKey: 'chat/avatars/worker-1.png' } },
    { id: 'u2', name: 'Colega Fallback', profile: { fullName: 'Colega Dois', avatarKey: null } },
  ],
  ...over,
})
const taskRow = (over: any = {}) => ({
  id: 't1', orderId: 'o1', position: 0, title: 'Inspeção', description: 'd',
  estimatedMinutes: 120, status: 'pending', startedAt: null, accumulatedSeconds: 0,
  progressPct: 0, order: orderRow(over.order), ...over,
})
const journeyRow = (over = {}) => ({
  id: 'j1', workerId: 'u1', date: new Date('2026-07-02'), state: 'idle',
  activeTaskId: null, startedAt: null, accumulatedSeconds: 0, openedAt: null, ...over,
})

// Estado de tempo/status vivo lido SOB a trava (o que o service.freshUnder
// devolve): só status/startedAt/accumulatedSeconds, sem o pai.
const fresh = (over = {}) => ({ status: 'pending', startedAt: null, accumulatedSeconds: 0, ...over })

describe('JourneyService', () => {
  it('getJourney faz get-or-create do turno de hoje e devolve o shape mobile', async () => {
    const db = prisma(); db.journey.upsert.mockResolvedValue(journeyRow())
    const out = await new JourneyService(db, media()).getJourney('u1')
    expect(db.journey.upsert).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 })
  })

  it('listTasks escopa por responsável + janela (startDate) + pai não-done e monta o DTO do item', async () => {
    const db = prisma(); db.task.findMany.mockResolvedValue([taskRow()])
    const out = await new JourneyService(db, media()).listTasks('u1')
    const where = db.task.findMany.mock.calls[0][0].where
    expect(where.order.responsibles.some.id).toBe('u1')      // membership via pai
    expect(where.order.status).toEqual({ not: 'done' })      // pai não concluído
    expect(where.order.OR).toEqual([{ startDate: null }, { startDate: { lte: expect.any(Date) } }]) // janela
    // DTO derivado do pai:
    expect(out[0].objective).toBe('Checklist de manutenção') // Decisão J: summary do pai
    expect(out[0].images).toEqual(['signed:order/a.jpg'])    // Decisão F: anexos do pai
    expect(out[0].responsibleCount).toBe(2)
    expect(out[0].responsibleNames).toEqual(['Worker Demo', 'Colega Dois'])
    // #5: avatares index-parallel com nomes/count — o responsável sem avatarKey vira ''
    // (não é filtrado), senão o índice desalinha nome↔avatar no AvatarGroup.
    expect(out[0].responsibleAvatars).toEqual(['signed:chat/avatars/worker-1.png', ''])
    expect(out[0].responsibleAvatars).toHaveLength(out[0].responsibleNames.length)
    expect(out[0].description).toBe('d')
  })

  it('getTask de outro worker (findFirst null) → null', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    expect(await new JourneyService(db, media()).getTask('u1', 'alheia')).toBeNull()
  })

  it('startTask liga a task + o turno, trava e recomputa o pai e devolve os dois', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.findUnique.mockResolvedValue(fresh())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).startTask('u1', 't1')
    expect(out.task.status).toBe('in_progress')
    expect(typeof out.task.startedAt).toBe('string')     // ISO
    expect(out.journey.state).toBe('ongoing')
    expect(out.journey.activeTaskId).toBe('t1')
    expect(db.$queryRaw).toHaveBeenCalled()              // lock pessimista no pai
    expect(db.workOrder.update).toHaveBeenCalledTimes(1) // recompute do pai
  })

  it('startTask de task inexistente → NotFound', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    await expect(new JourneyService(db, media()).startTask('u1', 'nope')).rejects.toThrow(/não encontrada/i)
  })

  it('startTask roda os writes dentro de uma única transação', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.findUnique.mockResolvedValue(fresh())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).startTask('u1', 't1')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('startTask: falha no último write (journey.update) propaga — não engole', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.findUnique.mockResolvedValue(fresh())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockRejectedValue(new Error('db down no último write'))
    await expect(new JourneyService(db, media()).startTask('u1', 't1')).rejects.toThrow(/db down/)
  })

  it('startTask: todos os reads/writes passam pelo tx — nada escapa pro client externo', async () => {
    const db = prisma()
    // tx distinto do db: se um read/write escapar pro this.prisma, ele cai no `db` (externo) e a asserção pega.
    const tx: any = {
      journey: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(journeyRow()),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data })),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue(taskRow()),
        findUnique: jest.fn().mockResolvedValue(fresh()),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...taskRow(), ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      workOrder: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }
    db.$transaction = jest.fn(async (cb: any) => cb(tx))
    await new JourneyService(db, media()).startTask('u1', 't1')
    // tudo pelo tx:
    expect(tx.task.findFirst).toHaveBeenCalledTimes(1)
    expect(tx.task.findUnique).toHaveBeenCalledTimes(1) // re-read pós-lock também no tx
    expect(tx.task.update).toHaveBeenCalledTimes(1)
    expect(tx.workOrder.update).toHaveBeenCalledTimes(1)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.journey.findFirst).toHaveBeenCalledTimes(1) // busca do turno que vem de ontem também no tx
    expect(tx.journey.upsert).toHaveBeenCalledTimes(1)
    expect(tx.journey.update).toHaveBeenCalledTimes(1)
    // nada no client externo:
    expect(db.task.findFirst).not.toHaveBeenCalled()
    expect(db.task.findUnique).not.toHaveBeenCalled()
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
    expect(db.journey.upsert).not.toHaveBeenCalled()
    expect(db.journey.update).not.toHaveBeenCalled()
  })

  it('completeTask marca o item done, recomputa o pai, limpa o activeTaskId e NÃO encerra o turno', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.task.findMany.mockResolvedValue([{ status: 'done' }, { status: 'done' }]) // recompute: tudo done
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', accumulatedSeconds: 100 }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow({ state: 'ongoing', accumulatedSeconds: 100 }), ...data }))
    const out = await new JourneyService(db, media()).completeTask('u1', 't1')
    expect(db.task.update.mock.calls[0][0].data.status).toBe('done')
    expect(db.task.update.mock.calls[0][0].data.progressPct).toBe(100)
    expect(db.workOrder.update).toHaveBeenCalledTimes(1)
    expect(db.workOrder.update.mock.calls[0][0].data.status).toBe('done') // orderStatus(tudo done) = done
    expect(db.journey.update.mock.calls[0][0].data.activeTaskId).toBeNull() // limpa o ponteiro
    expect(out.task.status).toBe('done')
    expect(out.journey.state).toBe('ongoing')          // turno segue correndo
    expect(out.journey.accumulatedSeconds).toBe(100)   // relógio do turno intocado
  })

  it('completeTask é idempotente: item já done não re-banca (task.update não é chamado)', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'done', accumulatedSeconds: 999, progressPct: 100 }))
    db.task.findUnique
      .mockResolvedValueOnce(fresh({ status: 'done', accumulatedSeconds: 999 }))              // freshUnder (select)
      .mockResolvedValueOnce(taskRow({ status: 'done', accumulatedSeconds: 999, progressPct: 100 })) // re-read completo sob a trava
    db.task.findMany.mockResolvedValue([{ status: 'done' }])
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 'outra' }))
    const out = await new JourneyService(db, media()).completeTask('u1', 't1')
    expect(db.task.update).not.toHaveBeenCalled()        // não re-banca
    expect(db.workOrder.update).toHaveBeenCalledTimes(1) // ainda recomputa o pai
    expect(db.journey.update).not.toHaveBeenCalled()     // activeTaskId != t1 → turno intacto
    expect(out.task.status).toBe('done')
    expect(out.task.accumulatedSeconds).toBe(999)        // tempo bancado preservado
  })

  it('completeTask fecha o TOCTOU: snapshot pré-lock stale (in_progress) mas estado vivo pós-lock é done → NÃO re-banca', async () => {
    const db = prisma()
    // findMyTask (pré-lock) vê in_progress com 50s — passaria o guard antigo e re-bancaria.
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    // freshUnder (pós-lock) revela que outro responsável já concluiu: done com 777s.
    db.task.findUnique
      .mockResolvedValueOnce(fresh({ status: 'done', startedAt: null, accumulatedSeconds: 777 }))       // freshUnder
      .mockResolvedValueOnce(taskRow({ status: 'done', startedAt: null, accumulatedSeconds: 777 }))      // re-read completo sob a trava
    db.task.findMany.mockResolvedValue([{ status: 'done' }])
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 'outra' }))
    const out = await new JourneyService(db, media()).completeTask('u1', 't1')
    expect(db.task.update).not.toHaveBeenCalled()   // guard no estado pós-lock → sem re-bank
    expect(db.workOrder.update).toHaveBeenCalledTimes(1)
    expect(out.task.status).toBe('done')            // DTO reflete o estado vivo, não o stale
    expect(out.task.accumulatedSeconds).toBe(777)   // 777 vivo, NÃO 50 (nem 50+elapsed)
  })

  it('completeTask idempotente: o DTO reflete o pai FRESH (re-lido sob a trava), não o snapshot pré-lock', async () => {
    const db = prisma()
    // pré-lock (findFirst): pai com 1 anexo. Sob a trava, um addPhoto concorrente já pushou o 2º.
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'done', order: orderRow({ imageKeys: ['order/old.jpg'] }) }))
    db.task.findUnique
      .mockResolvedValueOnce(fresh({ status: 'done', accumulatedSeconds: 999 }))                                          // freshUnder
      .mockResolvedValueOnce(taskRow({ status: 'done', order: orderRow({ imageKeys: ['order/old.jpg', 'order/new.jpg'] }) })) // re-read sob a trava
    db.task.findMany.mockResolvedValue([{ status: 'done' }])
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 'outra' }))
    const out = await new JourneyService(db, media()).completeTask('u1', 't1')
    expect(out.task.images).toEqual(['signed:order/old.jpg', 'signed:order/new.jpg']) // anexo concorrente aparece
  })

  it('cancelTask larga o item pra pending preservando o accumulatedSeconds bancado', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'paused', startedAt: null, accumulatedSeconds: 40 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'paused', startedAt: null, accumulatedSeconds: 40 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.task.findMany.mockResolvedValue([{ status: 'pending' }])
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1' }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow({ state: 'ongoing' }), ...data }))
    const out = await new JourneyService(db, media()).cancelTask('u1', 't1')
    expect(db.task.update.mock.calls[0][0].data.status).toBe('pending')
    expect(db.task.update.mock.calls[0][0].data.accumulatedSeconds).toBe(40) // banked preservado
    expect(db.workOrder.update).toHaveBeenCalledTimes(1)                      // recompute do pai
    expect(db.journey.update.mock.calls[0][0].data.activeTaskId).toBeNull()
    expect(out.task.status).toBe('pending')
  })

  it('endJourney zera o turno (idle, 0s) e deixa o item ativo PAUSED (Decisão E) + recomputa o pai', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 100 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 })) // re-read pós-lock
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.task.findMany.mockResolvedValue([{ status: 'paused' }, { status: 'pending' }])
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).endJourney('u1')
    expect(out.state).toBe('idle')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(out.activeTaskId).toBeNull()
    expect(out.accumulatedSeconds).toBe(0)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('paused') // Decisão E: NÃO done
    expect(db.workOrder.update).toHaveBeenCalledTimes(1)               // recompute do pai
    expect(db.$queryRaw).toHaveBeenCalled()                            // trava o pai ANTES (parent-first, sem deadlock)
  })

  it('pauseJourney banca o tempo da task ativa e grava o snapshot de progresso', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 30 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 10 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 10 })) // re-read pós-lock
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).pauseJourney('u1')
    expect(out.state).toBe('paused')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('paused')
    expect(db.task.update.mock.calls[0][0].data.progressPct).toBeGreaterThanOrEqual(0)
    expect(db.$queryRaw).toHaveBeenCalled()               // #1: trava o pai antes de mutar o item
  })

  it('resumeJourney retoma a task ativa (in_progress) e o turno (ongoing)', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'paused', activeTaskId: 't1', startedAt: null, accumulatedSeconds: 40 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'paused', startedAt: null, accumulatedSeconds: 40 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'paused', startedAt: null, accumulatedSeconds: 40 })) // re-read pós-lock
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).resumeJourney('u1')
    expect(out.state).toBe('ongoing')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('in_progress')
    expect(db.$queryRaw).toHaveBeenCalled()               // #1: trava o pai antes de mutar o item
  })

  it('pauseJourney sem task ativa é no-op seguro (só o turno pausa)', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: null }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).pauseJourney('u1')
    expect(out.state).toBe('paused')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update).not.toHaveBeenCalled()
  })

  // ---- #1 CRITICAL: item compartilhado — pause/resume/end NÃO podem regredir um
  // item que outro responsável já concluiu (activeTaskId por-worker aponta p/ done). ----
  it('endJourney NÃO regride o item ativo se ele já está done (outro responsável concluiu)', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 100 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress' })) // snapshot pré-lock stale
    db.task.findUnique.mockResolvedValue(fresh({ status: 'done', startedAt: null, accumulatedSeconds: 777 })) // vivo sob a trava: done
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).endJourney('u1')
    expect(db.task.update).not.toHaveBeenCalled()   // guard no estado pós-lock → não escreve 'paused' por cima do done
    expect(db.workOrder.update).not.toHaveBeenCalled() // sem write no item → sem recompute → pai fica done
    expect(out.state).toBe('idle')                  // turno ainda encerra
    expect(out.activeTaskId).toBeNull()
  })

  it('pauseJourney NÃO regride o item ativo se ele já está done', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', accumulatedSeconds: 30 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress' }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'done', accumulatedSeconds: 777 }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).pauseJourney('u1')
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
    expect(out.state).toBe('paused')                // turno pausa mesmo assim
  })

  it('resumeJourney NÃO regride o item ativo se ele já está done', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'paused', activeTaskId: 't1', accumulatedSeconds: 40 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'paused' }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'done', accumulatedSeconds: 777 }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).resumeJourney('u1')
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
    expect(out.state).toBe('ongoing')
  })

  // ---- #2: reabrir um item done é ação admin (Decisão C); worker não pode via start/cancel. ----
  it('startTask num item já done → 409 Conflict (não reabre o pai)', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'done' }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'done', accumulatedSeconds: 777 }))
    await expect(new JourneyService(db, media()).startTask('u1', 't1')).rejects.toThrow(/concluída|conflict/i)
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
  })

  it('cancelTask num item já done → 409 Conflict (não reabre o pai)', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'done' }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'done', accumulatedSeconds: 777 }))
    await expect(new JourneyService(db, media()).cancelTask('u1', 't1')).rejects.toThrow(/concluída|conflict/i)
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
  })

  // ---- #7: cancelar zera o progressPct (item volta a pending, não pode servir 45% velho). ----
  it('cancelTask zera o progressPct do item (pending não mostra progresso velho)', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'paused', accumulatedSeconds: 40, progressPct: 45 }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'paused', accumulatedSeconds: 40 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.task.findMany.mockResolvedValue([{ status: 'pending' }])
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1' }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).cancelTask('u1', 't1')
    expect(db.task.update.mock.calls[0][0].data.progressPct).toBe(0)
  })

  it('addTaskPhoto faz push atômico no PAI (WorkOrder.imageKeys), não no item, e presigna na volta', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow()) // orderId 'o1'; order.imageKeys ['order/a.jpg']
    const out = await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')
    // UPDATE único no pai, com a foto e o id da ordem como parâmetros (o SQL em si é provado no e2e).
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual(['task/b.jpg', expect.any(Date), 'o1', 'task/b.jpg'])
    expect(db.workOrder.update).not.toHaveBeenCalled()
    expect(db.task.update).not.toHaveBeenCalled()   // o item NÃO recebe imageKeys
    expect(out.images).toEqual(['signed:order/a.jpg']) // DTO presigna os anexos do pai
  })

  it('addTaskPhoto: item apagado durante o push (re-fetch null) → 404, não 500', async () => {
    const db = prisma()
    // 1ª busca (membership) acha; 2ª (re-fetch p/ DTO) volta null — cascade-delete concorrente.
    db.task.findFirst.mockResolvedValueOnce(taskRow()).mockResolvedValueOnce(null)
    await expect(new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')).rejects.toThrow(/não encontrada/i)
  })
})

// A jornada vira pelo dia de Brasília, e um turno aberto não é cortado pela
// virada. Antes o dia era o de UTC: às 21h de Brasília nascia uma jornada
// ociosa, o app lia "idle" e desligava o rastreio no meio do turno.
describe('JourneyService: virada do dia', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
  const at = (iso: string) => jest.setSystemTime(new Date(iso))
  const upsertKey = (db: any) => db.journey.upsert.mock.calls[0][0].where.workerId_date.date

  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }))
  afterEach(() => jest.useRealTimers())

  it('às 21h30 de Brasília a jornada é a do dia de Brasília, não a do dia UTC', async () => {
    at('2026-10-05T00:30:00.000Z') // 21h30 em Brasília; em UTC já é o dia seguinte
    const db = prisma(); db.journey.upsert.mockResolvedValue(journeyRow())
    await new JourneyService(db, media()).getJourney('u1')
    expect(upsertKey(db)).toEqual(day('2026-10-04'))
    expect(db.journey.upsert.mock.calls[0][0].create.date).toEqual(day('2026-10-04'))
  })

  it('turno iniciado às 20h segue na mesma jornada às 21h30', async () => {
    at('2026-10-04T23:00:00.000Z') // 20h em Brasília
    const started = prisma()
    started.task.findFirst.mockResolvedValue(taskRow())
    started.task.findUnique.mockResolvedValue(fresh())
    started.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    started.journey.upsert.mockResolvedValue(journeyRow())
    started.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(started, media()).startTask('u1', 't1')

    at('2026-10-05T00:30:00.000Z') // 21h30 em Brasília
    const later = prisma(); later.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1' }))
    await new JourneyService(later, media()).getJourney('u1')

    expect(upsertKey(later)).toEqual(upsertKey(started)) // mesma linha (worker, dia)
  })

  it('turno aberto ontem há menos de 14 h continua depois da meia-noite de Brasília', async () => {
    at('2026-10-05T03:30:00.000Z') // 00h30 em Brasília
    const db = prisma()
    db.journey.findFirst.mockResolvedValue(journeyRow({
      id: 'jOntem', date: day('2026-10-04'), state: 'ongoing', activeTaskId: 't1',
      startedAt: new Date('2026-10-04T23:00:00.000Z'), openedAt: new Date('2026-10-04T23:00:00.000Z'),
    }))
    const out = await new JourneyService(db, media()).getJourney('u1')

    expect(out.state).toBe('ongoing')
    expect(out.activeTaskId).toBe('t1')
    expect(db.journey.upsert).not.toHaveBeenCalled() // nenhuma jornada ociosa nova
    expect(db.journey.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'u1',
      date: { lt: day('2026-10-05') },
      state: { in: ['ongoing', 'paused'] },
      openedAt: { gt: new Date('2026-10-04T13:30:00.000Z') }, // agora menos 14 h
    })
  })

  // O corte das 14 h em si é aplicado pelo banco e fica provado no e2e.
  it('sem turno trazido de ontem, a jornada é a ociosa do dia de Brasília', async () => {
    at('2026-10-05T10:00:00.000Z') // 07h em Brasília
    const db = prisma(); db.journey.upsert.mockResolvedValue(journeyRow())
    const out = await new JourneyService(db, media()).getJourney('u1')
    expect(upsertKey(db)).toEqual(day('2026-10-05'))
    expect(out.state).toBe('idle')
  })

  it('encerrar às 06h encerra a jornada que veio de ontem e limpa openedAt', async () => {
    at('2026-10-05T09:00:00.000Z') // 06h em Brasília
    const db = prisma()
    db.journey.findFirst.mockResolvedValue(journeyRow({
      id: 'jOntem', date: day('2026-10-04'), state: 'ongoing',
      startedAt: new Date('2026-10-04T23:00:00.000Z'), openedAt: new Date('2026-10-04T23:00:00.000Z'),
    }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).endJourney('u1')

    expect(db.journey.update.mock.calls[0][0].where).toEqual({ id: 'jOntem' })
    expect(db.journey.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ state: 'idle', startedAt: null, accumulatedSeconds: 0, openedAt: null }),
    )
    expect(db.journey.upsert).not.toHaveBeenCalled()
    expect(out.state).toBe('idle')
  })

  it('iniciar a partir do ocioso grava openedAt com a hora de agora', async () => {
    at('2026-10-04T23:00:00.000Z')
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.findUnique.mockResolvedValue(fresh())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).startTask('u1', 't1')
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(new Date('2026-10-04T23:00:00.000Z'))
  })

  it('iniciar outra tarefa com o turno já aberto mantém o openedAt original', async () => {
    at('2026-10-05T01:00:00.000Z')
    const opened = new Date('2026-10-04T23:00:00.000Z')
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ id: 't2' }))
    db.task.findUnique.mockResolvedValue(fresh())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow({ id: 't2' }), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', startedAt: opened, openedAt: opened }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).startTask('u1', 't2')
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(opened)
  })

  it('pausar a partir do ocioso também abre a jornada (grava openedAt)', async () => {
    at('2026-10-04T23:00:00.000Z')
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).pauseJourney('u1')
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(new Date('2026-10-04T23:00:00.000Z'))
  })

  it('retomar a partir do ocioso também abre a jornada (grava openedAt)', async () => {
    at('2026-10-04T23:00:00.000Z')
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).resumeJourney('u1')
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(new Date('2026-10-04T23:00:00.000Z'))
  })

  it('jornada de hoje já aberta sem openedAt (gravada antes da coluna) ganha a hora na próxima ação', async () => {
    at('2026-10-04T23:00:00.000Z')
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', startedAt: new Date('2026-10-04T20:00:00.000Z'), openedAt: null }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    await new JourneyService(db, media()).pauseJourney('u1')
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(new Date('2026-10-04T23:00:00.000Z'))
  })

  const carriedRow = (over = {}) => journeyRow({
    id: 'jOntem', date: day('2026-10-04'), state: 'ongoing', activeTaskId: 't1',
    startedAt: new Date('2026-10-04T23:00:00.000Z'), openedAt: new Date('2026-10-04T23:00:00.000Z'), ...over,
  })

  it('turno trazido de ontem em pausa continua pausado, e retomar atua nele', async () => {
    at('2026-10-05T04:00:00.000Z') // 01h em Brasília
    const db = prisma()
    db.journey.findFirst.mockResolvedValue(carriedRow({ state: 'paused', activeTaskId: null, startedAt: null, accumulatedSeconds: 7200 }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...carriedRow(), ...data }))
    const svc = new JourneyService(db, media())

    expect((await svc.getJourney('u1')).state).toBe('paused')
    const resumed = await svc.resumeJourney('u1')

    expect(db.journey.update.mock.calls[0][0].where).toEqual({ id: 'jOntem' })
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(new Date('2026-10-04T23:00:00.000Z')) // mantém
    expect(resumed.accumulatedSeconds).toBe(7200)
    expect(db.journey.upsert).not.toHaveBeenCalled()
  })

  it.each(['completeTask', 'cancelTask'] as const)('%s no turno trazido de ontem limpa o activeTaskId dessa jornada', async (action) => {
    at('2026-10-05T04:00:00.000Z')
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date('2026-10-04T23:00:00.000Z') }))
    db.task.findUnique.mockResolvedValue(fresh({ status: 'in_progress', startedAt: new Date('2026-10-04T23:00:00.000Z') }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.findFirst.mockResolvedValue(carriedRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...carriedRow(), ...data }))
    const out = await new JourneyService(db, media())[action]('u1', 't1')

    expect(db.journey.update.mock.calls[0][0]).toEqual({ where: { id: 'jOntem' }, data: { activeTaskId: null } })
    expect(out.journey.state).toBe('ongoing') // o turno trazido segue aberto
    expect(db.journey.upsert).not.toHaveBeenCalled()
  })

  it('às 22h de Brasília a ordem que começa amanhã ainda não aparece', async () => {
    at('2026-10-05T01:00:00.000Z') // 22h em Brasília
    const db = prisma()
    await new JourneyService(db, media()).listTasks('u1')
    expect(db.task.findMany.mock.calls[0][0].where.order.OR).toEqual([
      { startDate: null },
      { startDate: { lte: day('2026-10-04') } },
    ])
  })
})
