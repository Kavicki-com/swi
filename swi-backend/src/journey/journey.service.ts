import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { Prisma } from '@prisma/client'
import type { Journey, Task } from '@prisma/client'
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, progressPct, type Anchors } from './time-anchors'

type Db = PrismaService | Prisma.TransactionClient

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

  private async findMyTask(workerId: string, id: string, db: Db = this.prisma): Promise<Task | null> {
    return db.task.findFirst({ where: { id, assignedTo: workerId } })
  }

  async getJourney(workerId: string) {
    return this.journeyToDto(await this.getOrCreateToday(workerId))
  }

  async listTasks(workerId: string) {
    const rows = await this.prisma.task.findMany({
      where: { assignedTo: workerId, scheduledDate: this.today() },
      orderBy: { createdAt: 'asc' },
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
      const ta = startAnchors(this.taskAnchors(task), now)
      const savedTask = await tx.task.update({
        where: { id: task.id },
        data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
      })
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

  async pauseJourney(workerId: string) {
    const now = Date.now()
    const saved = await this.prisma.$transaction(async (tx) => {
      const journey = await this.getOrCreateToday(workerId, tx)
      if (journey.activeTaskId) {
        const active = await this.findMyTask(workerId, journey.activeTaskId, tx)
        if (active) {
          const ta = pauseAnchors(this.taskAnchors(active), now)
          await tx.task.update({
            where: { id: active.id },
            data: {
              status: 'paused', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
              // ta.accumulatedSeconds já é o elapsed bancado em `now` (idem endJourney).
              progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
            },
          })
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
          const ta = resumeAnchors(this.taskAnchors(active), now)
          await tx.task.update({
            where: { id: active.id },
            data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
          })
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
          const ta = endAnchors(this.taskAnchors(active), now)
          await tx.task.update({
            where: { id: active.id },
            data: {
              status: 'done', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
              progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0),
            },
          })
        }
      }
      // Turno encerrado zera o relógio (refino 2026-06-23: banked vazaria pro
      // próximo turno). Banking por-task é preservado (cada task é seu objeto).
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
    const saved = await this.prisma.task.update({
      where: { id: task.id },
      data: { imageKeys: { push: imageKey } },   // array_append atômico (era [...task.imageKeys, imageKey])
    })
    return this.taskToDto(saved)
  }

  // ---- Boundary: domínio (ISO + status/state) ↔ Anchors (epoch ms) ----
  private taskAnchors(t: Task): Anchors {
    return { startedAt: t.startedAt ? t.startedAt.getTime() : null, accumulatedSeconds: t.accumulatedSeconds, running: t.status === 'in_progress' }
  }
  private journeyAnchors(j: Journey): Anchors {
    return { startedAt: j.startedAt ? j.startedAt.getTime() : null, accumulatedSeconds: j.accumulatedSeconds, running: j.state === 'ongoing' }
  }
  private iso(ms: number | null): Date | null {
    return ms == null ? null : new Date(ms)
  }

  private async taskToDto(t: Task) {
    // Presigns independentes em paralelo (relevante no path AWS, onde a resolução
    // de credencial via IAM pode ser round-trip de rede).
    const [images, interestedAvatars] = await Promise.all([
      this.media.presignGetMany(t.imageKeys),
      this.media.presignGetMany(t.interestedAvatarKeys),
    ])
    return {
      id: t.id,
      assignedTo: t.assignedTo,
      title: t.title,
      description: t.description ?? '',
      objective: t.objective ?? '',
      estimatedMinutes: t.estimatedMinutes ?? 0,
      status: t.status,
      startedAt: t.startedAt ? t.startedAt.toISOString() : null,
      accumulatedSeconds: t.accumulatedSeconds,
      progressPct: t.progressPct ?? 0,
      scheduledDate: t.scheduledDate ? t.scheduledDate.toISOString().slice(0, 10) : '',
      images,
      interestedCount: t.interestedCount ?? 0,
      interestedAvatars,
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
