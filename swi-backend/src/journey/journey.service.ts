import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { Prisma } from '@prisma/client'
import type { Journey, TaskStatus } from '@prisma/client'
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, progressPct, type Anchors } from './time-anchors'
import { carryOverSince, journeyDayOf } from './journey-day'
import { effectiveActionTime } from './action-time'
import { lockOrder, recomputeOrder } from '../work-orders/order-lock'
import { writeOnce } from '../idempotency/write-once'
import type { IdempotencyScope } from '../idempotency/idempotency-key'

type Db = PrismaService | Prisma.TransactionClient

/**
 * O que acompanha uma ação vinda da fila offline do app. Tudo opcional: sem
 * nada, a ação vale agora e não tem proteção contra repetição, como sempre.
 */
export interface JourneySend {
  /** Chave do envio, já lida por `parseIdempotencyKey`. */
  key?: string
  /** Hora do toque no relógio do aparelho. Entra no que identifica o envio. */
  occurredAt?: string | null
  /** Hora do envio no relógio do aparelho. Muda a cada tentativa. */
  sentAt?: string
}

// Item + o pai (WorkOrder) com os responsáveis e seus profiles — tudo que o
// taskToDto precisa (objetivo=summary, anexos=order.imageKeys, avatares dos
// responsáveis). Reusado em todos os finds/updates que devolvem um item.
const taskWithOrderInclude = {
  order: { include: { responsibles: { include: { profile: true } } } },
} satisfies Prisma.TaskInclude

type TaskWithOrder = Prisma.TaskGetPayload<{ include: typeof taskWithOrderInclude }>

type TaskAndJourney = { savedTask: TaskWithOrder; savedJourney: Journey }

@Injectable()
export class JourneyService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  // Dia de Brasília, não de UTC: pelo de UTC a jornada virava às 21h.
  private today(): Date {
    return journeyDayOf(new Date())
  }

  // A jornada de agora: um turno aberto num dia anterior, enquanto estiver
  // dentro do prazo de journey-day.ts, senão a do dia de Brasília. Sem isso a
  // virada do dia cortaria o turno de quem trabalha à noite.
  //
  // "Agora" é a hora em que a ação vale. Numa ação que esperou na fila do app
  // é a hora do toque: o "encerrar" de ontem enviado hoje acha a jornada de
  // ontem, e não a ociosa de hoje.
  private async getOrCreateCurrent(workerId: string, db: Db = this.prisma, nowMs: number = Date.now()): Promise<Journey> {
    const now = new Date(nowMs)
    const date = journeyDayOf(now)
    const carried = await db.journey.findFirst({
      where: { workerId, date: { lt: date }, state: { in: ['ongoing', 'paused'] }, openedAt: { gt: carryOverSince(now) } },
      orderBy: { openedAt: 'desc' },
    })
    if (carried) return carried
    return db.journey.upsert({
      where: { workerId_date: { workerId, date } },
      update: {},
      create: { workerId, date, state: 'idle', accumulatedSeconds: 0 },
    })
  }

  // Membership via pai: o item é "meu" se eu sou um dos responsáveis do WorkOrder.
  private async findMyTask(workerId: string, id: string, db: Db = this.prisma): Promise<TaskWithOrder | null> {
    return db.task.findFirst({
      where: { id, order: { responsibles: { some: { id: workerId } } } },
      include: taskWithOrderInclude,
    })
  }

  // Re-lê o estado de tempo/status vivo do item SOB a trava do pai. Fecha o
  // TOCTOU: o guard de idempotência e a matemática de âncoras partem do estado
  // pós-lock, não do snapshot pré-lock (velho) do findMyTask.
  private async freshUnder(taskId: string, tx: Prisma.TransactionClient) {
    const fresh = await tx.task.findUnique({
      where: { id: taskId },
      select: { status: true, startedAt: true, accumulatedSeconds: true },
    })
    if (!fresh) throw new NotFoundException('Tarefa não encontrada') // cascade-deleted sob nós
    return fresh
  }

  private actionTime(send: JourneySend): number {
    return effectiveActionTime(send.occurredAt, send.sentAt, Date.now())
  }

  // Aplica a transição uma vez só por chave de envio: a transição e a chave
  // são gravadas na mesma transação, e o reenvio relê o estado em vez de
  // aplicar de novo. Sem chave é a transação de sempre.
  //
  // O reenvio devolve o estado de AGORA, não o de quando a ação foi aplicada:
  // outras ações podem ter vindo depois dela.
  //
  // `run` recebe a hora em que a ação vale. Com chave, essa hora só é
  // calculada (e o teto de espera só é cobrado) quando a ação vai mesmo ser
  // aplicada: a nova tentativa de uma ação que já valeu devolve o estado, em
  // vez de ser recusada porque a espera cresceu até passar do teto.
  private async once<T>(
    workerId: string,
    send: JourneySend,
    scope: IdempotencyScope,
    target: { taskId?: string },
    run: (tx: Prisma.TransactionClient, now: number) => Promise<{ id: string; value: T }>,
    replay: () => Promise<T>,
  ): Promise<T> {
    if (!send.key) {
      const now = this.actionTime(send)
      return (await this.prisma.$transaction((tx) => run(tx, now))).value
    }
    const { value } = await writeOnce(this.prisma, {
      userId: workerId,
      key: send.key,
      scope,
      // A hora do envio fica de fora: ela muda a cada tentativa.
      request: { ...target, occurredAt: send.occurredAt ?? null },
      create: (tx) => run(tx, this.actionTime(send)),
      replay,
    })
    return value
  }

  private taskAction(
    workerId: string,
    taskId: string,
    send: JourneySend,
    scope: IdempotencyScope,
    run: (tx: Prisma.TransactionClient, now: number) => Promise<TaskAndJourney>,
  ): Promise<TaskAndJourney> {
    return this.once(
      workerId, send, scope, { taskId },
      async (tx, now) => ({ id: taskId, value: await run(tx, now) }),
      async () => {
        const task = await this.findMyTask(workerId, taskId)
        if (!task) throw new NotFoundException('Tarefa não encontrada')
        return { savedTask: task, savedJourney: await this.getOrCreateCurrent(workerId) }
      },
    )
  }

  private journeyAction(
    workerId: string,
    send: JourneySend,
    scope: IdempotencyScope,
    run: (tx: Prisma.TransactionClient, now: number) => Promise<Journey>,
  ): Promise<Journey> {
    return this.once(
      workerId, send, scope, {},
      async (tx, now) => {
        const saved = await run(tx, now)
        return { id: saved.id, value: saved }
      },
      () => this.getOrCreateCurrent(workerId),
    )
  }

  async getJourney(workerId: string) {
    return this.journeyToDto(await this.getOrCreateCurrent(workerId))
  }

  // Lista os itens dos WorkOrders onde eu sou responsável, o pai não está done e
  // a janela já abriu (startDate ≤ hoje ou null). Ordena por pai (createdAt) e
  // posição do item dentro do checklist.
  async listTasks(workerId: string) {
    const rows = await this.prisma.task.findMany({
      where: {
        order: {
          status: { not: 'done' },
          responsibles: { some: { id: workerId } },
          OR: [{ startDate: null }, { startDate: { lte: this.today() } }],
        },
      },
      orderBy: [{ order: { createdAt: 'asc' } }, { position: 'asc' }],
      include: taskWithOrderInclude,
    })
    return Promise.all(rows.map((t) => this.taskToDto(t)))
  }

  async getTask(workerId: string, id: string) {
    const t = await this.findMyTask(workerId, id)
    return t ? this.taskToDto(t) : null
  }

  async startTask(workerId: string, taskId: string, send: JourneySend = {}) {
    const { savedTask, savedJourney } = await this.taskAction(workerId, taskId, send, 'journey.task.start', async (tx, now) => {
      const task = await this.findMyTask(workerId, taskId, tx)
      if (!task) throw new NotFoundException('Tarefa não encontrada')
      await lockOrder(tx, task.orderId)
      // Re-lê o estado vivo do item SOB a trava — o snapshot pré-lock do
      // findMyTask pode estar velho (dois responsáveis no mesmo item), o que
      // re-bancaria o accumulatedSeconds. A âncora parte do estado pós-lock.
      const fresh = await this.freshUnder(task.id, tx)
      // #2: reabrir um item já concluído é ação de ADMIN (Decisão C, via PATCH
      // /work-orders). Um start (UI stale/replay) não pode ressuscitar o pai.
      if (fresh.status === 'done') throw new ConflictException('Tarefa já concluída')
      const ta = startAnchors(this.taskAnchors(fresh), now)
      const savedTask = await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
        include: taskWithOrderInclude,
      })
      await recomputeOrder(tx, task.orderId)
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      const ja = startAnchors(this.journeyAnchors(journey), now)
      const savedJourney = await tx.journey.update({
        where: { id: journey.id },
        data: {
          state: 'ongoing', activeTaskId: taskId, startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds,
          openedAt: this.openedAt(journey, now),
        },
      })
      return { savedTask, savedJourney }
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  // Decisão A: worker conclui o item explicitamente (marca done; NÃO encerra o
  // turno). Idempotente: um item já done não re-banca o tempo. Limpa o ponteiro
  // activeTaskId se era o ativo, mas deixa state/relógio do turno intactos.
  async completeTask(workerId: string, taskId: string, send: JourneySend = {}) {
    const { savedTask, savedJourney } = await this.taskAction(workerId, taskId, send, 'journey.task.complete', async (tx, now) => {
      const task = await this.findMyTask(workerId, taskId, tx)
      if (!task) throw new NotFoundException('Tarefa não encontrada')
      await lockOrder(tx, task.orderId)
      const fresh = await this.freshUnder(task.id, tx)
      let savedTask: TaskWithOrder
      if (fresh.status !== 'done') {
        const ta = endAnchors(this.taskAnchors(fresh), now)
        savedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: 'done', startedAt: null, accumulatedSeconds: ta.accumulatedSeconds, progressPct: 100 },
          include: taskWithOrderInclude,
        })
      } else {
        // Idempotente (outro responsável já concluiu): re-lê o item completo SOB a
        // trava — o DTO tem que trazer o pai fresh (imageKeys/responsáveis), não o
        // snapshot pré-lock do findMyTask. Fallback se o item sumiu (cascade concorrente).
        savedTask = (await tx.task.findUnique({ where: { id: task.id }, include: taskWithOrderInclude })) ?? { ...task, ...fresh }
      }
      await recomputeOrder(tx, task.orderId)
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      let savedJourney = journey
      if (journey.activeTaskId === taskId) {
        savedJourney = await tx.journey.update({ where: { id: journey.id }, data: { activeTaskId: null } })
      }
      return { savedTask, savedJourney }
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  // Decisão A: worker larga o item de volta pra pending mantendo o tempo bancado
  // (pauseAnchors). O turno segue correndo; só limpa activeTaskId se era o ativo.
  async cancelTask(workerId: string, taskId: string, send: JourneySend = {}) {
    const { savedTask, savedJourney } = await this.taskAction(workerId, taskId, send, 'journey.task.cancel', async (tx, now) => {
      const task = await this.findMyTask(workerId, taskId, tx)
      if (!task) throw new NotFoundException('Tarefa não encontrada')
      await lockOrder(tx, task.orderId)
      // Banking a partir do estado pós-lock (idem completeTask) — senão dois
      // responsáveis no mesmo item re-bancariam o accumulatedSeconds.
      const fresh = await this.freshUnder(task.id, tx)
      // #2: cancelar um item já done reabriria o pai (Decisão C: reabrir é ação admin).
      if (fresh.status === 'done') throw new ConflictException('Tarefa já concluída')
      const ta = pauseAnchors(this.taskAnchors(fresh), now)
      const savedTask = await tx.task.update({
        where: { id: task.id },
        // #7: volta a pending zera o progresso — um pending não pode servir o %
        // velho (que ficaria colado no DTO do mobile).
        data: { status: 'pending', startedAt: null, accumulatedSeconds: ta.accumulatedSeconds, progressPct: 0 },
        include: taskWithOrderInclude,
      })
      await recomputeOrder(tx, task.orderId)
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      let savedJourney = journey
      if (journey.activeTaskId === taskId) {
        savedJourney = await tx.journey.update({ where: { id: journey.id }, data: { activeTaskId: null } })
      }
      return { savedTask, savedJourney }
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  async pauseJourney(workerId: string, send: JourneySend = {}) {
    const saved = await this.journeyAction(workerId, send, 'journey.pause', async (tx, now) => {
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      if (journey.activeTaskId) {
        const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
        if (active) {
          // #1: o activeTaskId é POR-worker mas o item é COMPARTILHADO entre os
          // responsáveis do pai — pode apontar p/ um item que outro responsável já
          // concluiu. Trava o pai e re-lê SOB a trava; nunca regride um `done`.
          await lockOrder(tx, active.orderId)
          const fresh = await this.freshUnder(active.id, tx)
          if (fresh.status !== 'done') {
            const ta = pauseAnchors(this.taskAnchors(fresh), now)
            await tx.task.update({
              where: { id: active.id },
              data: {
                status: 'paused', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
                // ta.accumulatedSeconds já é o elapsed bancado em `now` (idem endJourney).
                progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
              },
            })
            await recomputeOrder(tx, active.orderId)
          }
        }
      }
      const ja = pauseAnchors(this.journeyAnchors(journey), now)
      return tx.journey.update({
        where: { id: journey.id },
        data: { state: 'paused', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds, openedAt: this.openedAt(journey, now) },
      })
    })
    return this.journeyToDto(saved)
  }

  async resumeJourney(workerId: string, send: JourneySend = {}) {
    const saved = await this.journeyAction(workerId, send, 'journey.resume', async (tx, now) => {
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      if (journey.activeTaskId) {
        const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
        if (active) {
          // #1: idem pauseJourney — trava + re-lê sob a trava; não ressuscita p/
          // in_progress um item que outro responsável concluiu enquanto isto pausava.
          await lockOrder(tx, active.orderId)
          const fresh = await this.freshUnder(active.id, tx)
          if (fresh.status !== 'done') {
            const ta = resumeAnchors(this.taskAnchors(fresh), now)
            await tx.task.update({
              where: { id: active.id },
              data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
            })
            await recomputeOrder(tx, active.orderId)
          }
        }
      }
      const ja = resumeAnchors(this.journeyAnchors(journey), now)
      return tx.journey.update({
        where: { id: journey.id },
        data: { state: 'ongoing', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds, openedAt: this.openedAt(journey, now) },
      })
    })
    return this.journeyToDto(saved)
  }

  async endJourney(workerId: string, send: JourneySend = {}) {
    const saved = await this.journeyAction(workerId, send, 'journey.end', async (tx, now) => {
      const journey = await this.getOrCreateCurrent(workerId, tx, now)
      if (journey.activeTaskId) {
        const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
        if (active) {
          // Trava o pai ANTES de mutar o item — uniformiza a ordem "pai→item" de
          // start/complete/cancel. Sem isso, endJourney (item→pai) + um complete
          // concorrente no mesmo item formariam um ciclo de deadlock (holds O
          // wants X vs holds X wants O) → Postgres abortaria uma das txns.
          await lockOrder(tx, active.orderId)
          // #1: re-lê o item SOB a trava (idem start/complete/cancel). O activeTaskId
          // pode apontar p/ um item que outro responsável já concluiu — encerrar o
          // turno NÃO pode regredir esse `done` de volta p/ `paused`.
          const fresh = await this.freshUnder(active.id, tx)
          if (fresh.status !== 'done') {
            // Decisão E: encerrar o turno NÃO conclui o item ativo — deixa `paused`
            // (retomável). O banking (endAnchors) e o snapshot de progresso ficam.
            const ta = endAnchors(this.taskAnchors(fresh), now)
            await tx.task.update({
              where: { id: active.id },
              data: {
                status: 'paused', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
                progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
              },
            })
            // O status do item mudou → recomputa o pai (paused conta como "começado").
            await recomputeOrder(tx, active.orderId)
          }
        }
      }
      // Turno encerrado zera o relógio, senão o tempo acumulado vaza pro
      // próximo turno. O acúmulo por task é preservado, já que cada task é seu
      // próprio objeto.
      return tx.journey.update({
        where: { id: journey.id },
        data: { state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0, openedAt: null },
      })
    })
    return this.journeyToDto(saved)
  }

  async addTaskPhoto(workerId: string, taskId: string, imageKey: string) {
    const task = await this.findMyTask(workerId, taskId)
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    // Decisão F: a foto pertence ao PAI (WorkOrder.imageKeys). Resolve item→pai e
    // faz array_append atômico no pai; re-busca o item pra montar o DTO.
    //
    // Só entra se ainda não estiver lá: a fila offline do app reenvia a mesma
    // foto quando a resposta do primeiro envio se perde. A condição vai no
    // próprio UPDATE, então dois envios iguais ao mesmo tempo gravam uma vez.
    // SQL direto porque a coluna é nula na ordem que nunca teve foto, e o
    // filtro de lista do Prisma não casa com nulo: a primeira foto não entraria.
    await this.prisma.$executeRaw`
      UPDATE "WorkOrder"
      SET "imageKeys" = array_append("imageKeys", ${imageKey}), "updatedAt" = ${new Date()}
      WHERE id = ${task.orderId}
        AND NOT (${imageKey} = ANY(COALESCE("imageKeys", ARRAY[]::text[])))`
    const fresh = await this.findMyTask(workerId, taskId)
    if (!fresh) throw new NotFoundException('Tarefa não encontrada') // order/task apagado no meio → 404, não 500
    return this.taskToDto(fresh)
  }

  // ---- Boundary: domínio (ISO + status/state) ↔ Anchors (epoch ms) ----
  private taskAnchors(t: { startedAt: Date | null; accumulatedSeconds: number; status: TaskStatus }): Anchors {
    return { startedAt: t.startedAt ? t.startedAt.getTime() : null, accumulatedSeconds: t.accumulatedSeconds, running: t.status === 'in_progress' }
  }
  private journeyAnchors(j: Journey): Anchors {
    return { startedAt: j.startedAt ? j.startedAt.getTime() : null, accumulatedSeconds: j.accumulatedSeconds, running: j.state === 'ongoing' }
  }
  private iso(ms: number | null): Date | null {
    return ms == null ? null : new Date(ms)
  }
  // Hora em que o turno abriu: nasce na saída do ocioso e vale até encerrar.
  // Jornada já aberta sem ela foi gravada antes da coluna existir; ganha a
  // hora da ação, para quem está em turno não ser cortado na virada. Só a
  // jornada de hoje chega aqui assim: as de dias anteriores sem a hora nunca
  // são trazidas de volta.
  private openedAt(j: Journey, nowMs: number): Date | null {
    return j.state === 'idle' ? new Date(nowMs) : (j.openedAt ?? new Date(nowMs))
  }

  private async taskToDto(t: TaskWithOrder) {
    // Presigns independentes em paralelo (relevante no path AWS, onde a resolução
    // de credencial via IAM pode ser round-trip de rede).
    const [images, responsibleAvatars] = await Promise.all([
      this.media.presignGetMany(t.order.imageKeys), // Decisão F: anexos vêm do pai
      // #5: index-parallel com responsibleNames/responsibleCount — o responsável sem
      // avatarKey vira '' (NÃO é filtrado), senão o índice desalinha nome↔avatar no
      // AvatarGroup do mobile e o "+N" do overflow fica errado.
      Promise.all(
        t.order.responsibles.map((u) => (u.profile?.avatarKey ? this.media.presignGet(u.profile.avatarKey) : Promise.resolve(''))),
      ),
    ])
    return {
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      objective: t.order.summary ?? '', // Decisão J: "Objetivo principal" = summary do pai
      estimatedMinutes: t.estimatedMinutes ?? 0,
      status: t.status,
      startedAt: t.startedAt ? t.startedAt.toISOString() : null,
      accumulatedSeconds: t.accumulatedSeconds,
      progressPct: t.progressPct ?? 0,
      images,
      responsibleCount: t.order.responsibles.length,
      responsibleNames: t.order.responsibles.map((u) => u.profile?.fullName ?? u.name),
      responsibleAvatars,
    }
  }

  private journeyToDto(j: Journey) {
    return {
      state: j.state,
      activeTaskId: j.activeTaskId,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      accumulatedSeconds: j.accumulatedSeconds,
    }
  }
}
