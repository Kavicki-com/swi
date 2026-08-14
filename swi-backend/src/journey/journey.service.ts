import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { Prisma } from '@prisma/client'
import type { Journey, TaskStatus } from '@prisma/client'
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, progressPct, type Anchors } from './time-anchors'
import { lockOrder, recomputeOrder } from '../work-orders/order-lock'

type Db = PrismaService | Prisma.TransactionClient

// Item + o pai (WorkOrder) com os responsáveis e seus profiles — tudo que o
// taskToDto precisa (objetivo=summary, anexos=order.imageKeys, avatares dos
// responsáveis). Reusado em todos os finds/updates que devolvem um item.
const taskWithOrderInclude = {
  order: { include: { responsibles: { include: { profile: true } } } },
} satisfies Prisma.TaskInclude

type TaskWithOrder = Prisma.TaskGetPayload<{ include: typeof taskWithOrderInclude }>

@Injectable()
export class JourneyService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  // Data-só em UTC-midnight (paridade com o mock: new Date().toISOString().slice(0,10)).
  private today(): Date {
    const n = new Date()
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
  }

  private async getOrCreateToday(workerId: string, db: Db = this.prisma): Promise<Journey> {
    const date = this.today()
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

  async getJourney(workerId: string) {
    return this.journeyToDto(await this.getOrCreateToday(workerId))
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

  async startTask(workerId: string, taskId: string) {
    const now = Date.now()
    const { savedTask, savedJourney } = await this.prisma.$transaction(async (tx) => {
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
      const journey = await this.getOrCreateToday(workerId, tx)
      const ja = startAnchors(this.journeyAnchors(journey), now)
      const savedJourney = await tx.journey.update({
        where: { id: journey.id },
        data: { state: 'ongoing', activeTaskId: taskId, startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
      })
      return { savedTask, savedJourney }
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  // Decisão A: worker conclui o item explicitamente (marca done; NÃO encerra o
  // turno). Idempotente: um item já done não re-banca o tempo. Limpa o ponteiro
  // activeTaskId se era o ativo, mas deixa state/relógio do turno intactos.
  async completeTask(workerId: string, taskId: string) {
    const now = Date.now()
    const { savedTask, savedJourney } = await this.prisma.$transaction(async (tx) => {
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
      const journey = await this.getOrCreateToday(workerId, tx)
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
  async cancelTask(workerId: string, taskId: string) {
    const now = Date.now()
    const { savedTask, savedJourney } = await this.prisma.$transaction(async (tx) => {
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
      const journey = await this.getOrCreateToday(workerId, tx)
      let savedJourney = journey
      if (journey.activeTaskId === taskId) {
        savedJourney = await tx.journey.update({ where: { id: journey.id }, data: { activeTaskId: null } })
      }
      return { savedTask, savedJourney }
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  async pauseJourney(workerId: string) {
    const now = Date.now()
    const saved = await this.prisma.$transaction(async (tx) => {
      const journey = await this.getOrCreateToday(workerId, tx)
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
        data: { state: 'paused', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
      })
    })
    return this.journeyToDto(saved)
  }

  async resumeJourney(workerId: string) {
    const now = Date.now()
    const saved = await this.prisma.$transaction(async (tx) => {
      const journey = await this.getOrCreateToday(workerId, tx)
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
        data: { state: 'ongoing', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
      })
    })
    return this.journeyToDto(saved)
  }

  async endJourney(workerId: string) {
    const now = Date.now()
    const saved = await this.prisma.$transaction(async (tx) => {
      const journey = await this.getOrCreateToday(workerId, tx)
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
        data: { state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 },
      })
    })
    return this.journeyToDto(saved)
  }

  async addTaskPhoto(workerId: string, taskId: string, imageKey: string) {
    const task = await this.findMyTask(workerId, taskId)
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    // Decisão F: a foto pertence ao PAI (WorkOrder.imageKeys). Resolve item→pai e
    // faz array_append atômico no pai; re-busca o item pra montar o DTO.
    await this.prisma.workOrder.update({
      where: { id: task.orderId },
      data: { imageKeys: { push: imageKey } },
    })
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
