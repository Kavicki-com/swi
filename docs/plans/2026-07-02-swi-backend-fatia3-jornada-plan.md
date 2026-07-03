# Fatia 3 — Jornada / Tarefas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) task-by-task.

**Goal:** Ligar as telas de Jornada/Tarefas ao backend real: `JourneyModule` (lifecycle start/pause/resume/end + fotos) no NestJS reusando o `MediaModule` da Fatia 2 + `apiJourneyBackend` no mobile atrás do seam `DATA_BACKEND==='api'`.

**Architecture:** Ver `docs/plans/2026-07-02-swi-backend-fatia3-jornada-design.md`. Backend espelha `src/reports/`. Servidor **persiste âncoras de tempo** nas transições (não roda relógio); o `progress.ts` do cliente ticka o display ao vivo a partir de `startedAt` absoluto + `accumulatedSeconds`. Fotos reusam o presign do `MediaService` (prefixo `task/`). Models `Journey`/`Task` já existem (Fatia 0) — **sem migration nova, sem infra nova**.

**Tech Stack:** NestJS + Prisma + `@aws-sdk/*` (já instalados na Fatia 2); Expo/RN + Jest (mobile, sem dep nova — reusa `uploadImage`).

**⚠️ Pré-requisito de branch:** esta fatia **reusa a fundação de mídia da Fatia 2** (`MediaModule`, `uploadImage`), que vive no PR #26 (ainda aberto contra `main`). Duas opções:
- **(preferida)** Mergear #26 → `main` primeiro, depois `git switch main && git pull && git switch -c feat/backend-jornada`.
- **(stack)** Se for tocar antes do merge: `git switch -c feat/backend-jornada feat/backend-relatorios` (empilha na Fatia 2); reabrir o PR contra `main` (ou retarget) **após** #26 mergear. Decisão do usuário no handoff.

**Baselines (pós-Relatórios):** backend build 0, unit 30, e2e 12; mobile jest 144, tsc 8 (0 novos), expo export web exit 0. Docker smoke obrigatório (com MinIO real).

**Identidade:** `req.user.userId` (do JWT) como `Journey.workerId` / `Task.assignedTo`. Worker lê/atua **só nas suas** tasks → 404 pras de outro.

**Contrato mobile (intocado):** `JourneyBackend` (8 métodos) em `mobile/services/journey/types.ts`. **Sem CRUD de task.**

---

### Task 1: branch

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git fetch origin
# opção preferida (após #26 mergear):
git switch main && git pull && git switch -c feat/backend-jornada
# OU opção stack (antes do merge):
# git switch -c feat/backend-jornada feat/backend-relatorios
```
Confirmar que `src/media/media.service.ts` e `mobile/services/api/uploadMedia.ts` existem na base (senão a base está errada).

---

### Task 2: `time-anchors.ts` no backend (TDD — porta pura do `progress.ts`)

**Files:** Create `swi-backend/src/journey/time-anchors.ts` + `time-anchors.spec.ts`.

**Step 1 — teste falhando** (`time-anchors.spec.ts`):

```ts
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, elapsedSeconds, progressPct, type Anchors } from './time-anchors'

const A: Anchors = { startedAt: null, accumulatedSeconds: 0, running: false }
const T0 = 1_000_000_000_000

describe('time-anchors (porta pura do progress.ts mobile)', () => {
  it('elapsed parado = accumulated', () => {
    expect(elapsedSeconds({ ...A, accumulatedSeconds: 42 }, T0)).toBe(42)
  })
  it('elapsed rodando soma o segmento atual', () => {
    expect(elapsedSeconds({ startedAt: T0, accumulatedSeconds: 10, running: true }, T0 + 5000)).toBe(15)
  })
  it('start → pause banca o segmento; resume → end acumula', () => {
    const s = startAnchors(A, T0)                       // running, startedAt=T0
    const p = pauseAnchors(s, T0 + 30_000)              // banca 30s, para
    expect(p).toEqual({ startedAt: null, accumulatedSeconds: 30, running: false })
    const r = resumeAnchors(p, T0 + 60_000)             // running de novo
    const e = endAnchors(r, T0 + 60_000 + 10_000)       // +10s
    expect(e.accumulatedSeconds).toBe(40)
    expect(e.running).toBe(false)
  })
  it('progressPct clampa em 100 e trata estimated<=0', () => {
    expect(progressPct(1800, 60)).toBe(50)              // 30min de 60min
    expect(progressPct(999999, 60)).toBe(100)
    expect(progressPct(10, 0)).toBe(0)
  })
})
```

**Step 2:** `cd swi-backend && npx jest src/journey/time-anchors.spec.ts` → FAIL (módulo não existe).

**Step 3 — implementar** (`time-anchors.ts`, cópia fiel de `mobile/services/journey/progress.ts` sem `formatDuration`, que é display-only do cliente):

```ts
// Matemática PURA de âncoras de tempo — porta de mobile/services/journey/progress.ts.
// Servidor grava nas transições; cliente ticka o display. Tempos em segundos;
// startedAt/nowMs em epoch ms (determinístico, injetável em teste).
export interface Anchors {
  startedAt: number | null
  accumulatedSeconds: number
  running: boolean
}

export function elapsedSeconds(a: Anchors, nowMs: number): number {
  if (!a.running || a.startedAt == null) return a.accumulatedSeconds
  return a.accumulatedSeconds + Math.max(0, Math.floor((nowMs - a.startedAt) / 1000))
}

export function progressPct(elapsedSec: number, estimatedMinutes: number): number {
  if (estimatedMinutes <= 0) return 0
  return Math.min(100, (elapsedSec / (estimatedMinutes * 60)) * 100)
}

export function startAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
export function pauseAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false }
}
export function resumeAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
export function endAnchors(a: Anchors, nowMs: number): Anchors {
  return { startedAt: null, accumulatedSeconds: elapsedSeconds(a, nowMs), running: false }
}
```

**Step 4:** `npx jest src/journey/time-anchors.spec.ts` → PASS (4/4).

**Step 5 — commit** (só com luz verde da rodada; ver nota no fim):
```bash
git add swi-backend/src/journey/time-anchors.ts swi-backend/src/journey/time-anchors.spec.ts
git commit -m "feat(backend): time-anchors puro (porta do progress.ts) para a Jornada"
```

---

### Task 3: `JourneyService` (TDD — Prisma + MediaService mockados)

**Files:** Create `swi-backend/src/journey/journey.service.ts` + `journey.service.spec.ts`.

**Step 1 — teste falhando** (`journey.service.spec.ts`). Cobre: get-or-create idempotente, escopo minhas/hoje, `toDto` presign, lifecycle e single-active-task não auto-pausa:

```ts
import { JourneyService } from './journey.service'

const media = () => ({
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
}) as any

const prisma = () => ({
  journey: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  task: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
}) as any

const taskRow = (over = {}) => ({
  id: 't1', assignedTo: 'u1', title: 'Inspeção', description: 'd', objective: 'o',
  estimatedMinutes: 120, status: 'pending', startedAt: null, accumulatedSeconds: 0,
  progressPct: 0, scheduledDate: new Date('2026-07-02'), imageKeys: ['task/a.jpg'],
  interestedCount: 18, interestedAvatarKeys: ['interested/worker-1.png'], ...over,
})
const journeyRow = (over = {}) => ({
  id: 'j1', workerId: 'u1', date: new Date('2026-07-02'), state: 'idle',
  activeTaskId: null, startedAt: null, accumulatedSeconds: 0, ...over,
})

describe('JourneyService', () => {
  it('getJourney faz get-or-create do turno de hoje e devolve o shape mobile', async () => {
    const db = prisma(); db.journey.upsert.mockResolvedValue(journeyRow())
    const out = await new JourneyService(db, media()).getJourney('u1')
    expect(db.journey.upsert).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 })
  })

  it('listTasks escopa em assignedTo + hoje e presigna imagens/avatares', async () => {
    const db = prisma(); db.task.findMany.mockResolvedValue([taskRow()])
    const out = await new JourneyService(db, media()).listTasks('u1')
    const where = db.task.findMany.mock.calls[0][0].where
    expect(where.assignedTo).toBe('u1')
    expect(where.scheduledDate).toBeInstanceOf(Date)
    expect(out[0].images).toEqual(['signed:task/a.jpg'])
    expect(out[0].interestedAvatars).toEqual(['signed:interested/worker-1.png'])
    expect(out[0].scheduledDate).toBe('2026-07-02')
    expect(out[0].description).toBe('d')
  })

  it('getTask de outro worker (findFirst null) → null', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    expect(await new JourneyService(db, media()).getTask('u1', 'alheia')).toBeNull()
  })

  it('startTask liga a task + o turno e devolve os dois', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow())
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.upsert.mockResolvedValue(journeyRow())
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).startTask('u1', 't1')
    expect(out.task.status).toBe('in_progress')
    expect(typeof out.task.startedAt).toBe('string')     // ISO
    expect(out.journey.state).toBe('ongoing')
    expect(out.journey.activeTaskId).toBe('t1')
  })

  it('startTask de task inexistente → NotFound', async () => {
    const db = prisma(); db.task.findFirst.mockResolvedValue(null)
    await expect(new JourneyService(db, media()).startTask('u1', 'nope')).rejects.toThrow(/não encontrada/i)
  })

  it('endJourney zera o turno (idle, 0s) e marca a task done', async () => {
    const db = prisma()
    db.journey.upsert.mockResolvedValue(journeyRow({ state: 'ongoing', activeTaskId: 't1', startedAt: new Date(), accumulatedSeconds: 100 }))
    db.task.findFirst.mockResolvedValue(taskRow({ status: 'in_progress', startedAt: new Date(), accumulatedSeconds: 50 }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(), ...data }))
    const out = await new JourneyService(db, media()).endJourney('u1')
    expect(out.state).toBe('idle')
    expect(out.activeTaskId).toBeNull()
    expect(out.accumulatedSeconds).toBe(0)
    expect(db.task.update.mock.calls[0][0].data.status).toBe('done')
  })

  it('addTaskPhoto faz append da key e presigna na volta', async () => {
    const db = prisma()
    db.task.findFirst.mockResolvedValue(taskRow({ imageKeys: ['task/a.jpg'] }))
    db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(), ...data }))
    const out = await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')
    expect(db.task.update.mock.calls[0][0].data.imageKeys).toEqual(['task/a.jpg', 'task/b.jpg'])
    expect(out.images).toEqual(['signed:task/a.jpg', 'signed:task/b.jpg'])
  })
})
```

**Step 2:** `npx jest src/journey/journey.service.spec.ts` → FAIL.

**Step 3 — implementar** (`journey.service.ts`):

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import type { Journey, Task } from '@prisma/client'
import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, elapsedSeconds, progressPct, type Anchors } from './time-anchors'

@Injectable()
export class JourneyService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  // Data-só em UTC-midnight (paridade com o mock: new Date().toISOString().slice(0,10)).
  private today(): Date {
    const n = new Date()
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
  }

  private async getOrCreateToday(workerId: string): Promise<Journey> {
    const date = this.today()
    return this.prisma.journey.upsert({
      where: { workerId_date: { workerId, date } },
      update: {},
      create: { workerId, date, state: 'idle', accumulatedSeconds: 0 },
    })
  }

  private async findMyTask(workerId: string, id: string): Promise<Task | null> {
    return this.prisma.task.findFirst({ where: { id, assignedTo: workerId } })
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
    const task = await this.findMyTask(workerId, taskId)
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    const now = Date.now()

    const ta = startAnchors(this.taskAnchors(task), now)
    const savedTask = await this.prisma.task.update({
      where: { id: task.id },
      data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
    })

    const journey = await this.getOrCreateToday(workerId)
    const ja = startAnchors(this.journeyAnchors(journey), now)
    const savedJourney = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { state: 'ongoing', activeTaskId: taskId, startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
    return { journey: this.journeyToDto(savedJourney), task: await this.taskToDto(savedTask) }
  }

  async pauseJourney(workerId: string) {
    const journey = await this.getOrCreateToday(workerId)
    const now = Date.now()
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId)
      if (active) {
        const ta = pauseAnchors(this.taskAnchors(active), now)
        await this.prisma.task.update({
          where: { id: active.id },
          data: { status: 'paused', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
                   progressPct: progressPct(elapsedSeconds(this.taskAnchors(active), now), active.estimatedMinutes ?? 0) },
        })
      }
    }
    const ja = pauseAnchors(this.journeyAnchors(journey), now)
    const saved = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { state: 'paused', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
    return this.journeyToDto(saved)
  }

  async resumeJourney(workerId: string) {
    const journey = await this.getOrCreateToday(workerId)
    const now = Date.now()
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId)
      if (active) {
        const ta = resumeAnchors(this.taskAnchors(active), now)
        await this.prisma.task.update({
          where: { id: active.id },
          data: { status: 'in_progress', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds },
        })
      }
    }
    const ja = resumeAnchors(this.journeyAnchors(journey), now)
    const saved = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { state: 'ongoing', startedAt: this.iso(ja.startedAt), accumulatedSeconds: ja.accumulatedSeconds },
    })
    return this.journeyToDto(saved)
  }

  async endJourney(workerId: string) {
    const journey = await this.getOrCreateToday(workerId)
    const now = Date.now()
    if (journey.activeTaskId) {
      const active = await this.findMyTask(workerId, journey.activeTaskId)
      if (active) {
        const ta = endAnchors(this.taskAnchors(active), now)
        await this.prisma.task.update({
          where: { id: active.id },
          data: { status: 'done', startedAt: this.iso(ta.startedAt), accumulatedSeconds: ta.accumulatedSeconds,
                   progressPct: progressPct(ta.accumulatedSeconds, active.estimatedMinutes ?? 0) },
        })
      }
    }
    // Turno encerrado zera o relógio (refino 2026-06-23: banked vazaria pro
    // próximo turno). Banking por-task é preservado (cada task é seu objeto).
    const saved = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 },
    })
    return this.journeyToDto(saved)
  }

  async addTaskPhoto(workerId: string, taskId: string, imageKey: string) {
    const task = await this.findMyTask(workerId, taskId)
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    const saved = await this.prisma.task.update({
      where: { id: task.id },
      data: { imageKeys: [...task.imageKeys, imageKey] },
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
      images: await this.media.presignGetMany(t.imageKeys),
      interestedCount: t.interestedCount ?? 0,
      interestedAvatars: await this.media.presignGetMany(t.interestedAvatarKeys),
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
```

**Step 4:** `npx jest src/journey/journey.service.spec.ts` → PASS (7/7).

**Step 5 — commit:**
```bash
git add swi-backend/src/journey/journey.service.ts swi-backend/src/journey/journey.service.spec.ts
git commit -m "feat(backend): JourneyService (lifecycle + toDto presign)"
```

---

### Task 4: Journey DTO + Controller + Module + registro

**Files:** Create `swi-backend/src/journey/dto.ts`, `journey.controller.ts`, `journey.module.ts`. Modify `swi-backend/src/app.module.ts`.

**Step 1 — DTO** (`dto.ts`; regex idêntica ao Reports mas prefixo `task/` — anti-abuso):
```ts
import { IsString, Matches } from 'class-validator'
export class AddTaskPhotoDto {
  @IsString()
  @Matches(/^task\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey!: string
}
```

**Step 2 — Controller** (`journey.controller.ts`; rotas resource-style, `req.user.userId` como worker):
```ts
import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { AddTaskPhotoDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('journey')
@UseGuards(JwtAuthGuard)
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get()
  getJourney(@Req() req: any) {
    return this.journey.getJourney(req.user.userId)
  }

  @Get('tasks')
  listTasks(@Req() req: any) {
    return this.journey.listTasks(req.user.userId)
  }

  @Get('tasks/:id')
  async getTask(@Req() req: any, @Param('id') id: string) {
    const t = await this.journey.getTask(req.user.userId, id)
    if (!t) throw new NotFoundException('Tarefa não encontrada')
    return t
  }

  @Post('tasks/:id/start')
  startTask(@Req() req: any, @Param('id') id: string) {
    return this.journey.startTask(req.user.userId, id)
  }

  @Post('pause')
  pause(@Req() req: any) {
    return this.journey.pauseJourney(req.user.userId)
  }

  @Post('resume')
  resume(@Req() req: any) {
    return this.journey.resumeJourney(req.user.userId)
  }

  @Post('end')
  end(@Req() req: any) {
    return this.journey.endJourney(req.user.userId)
  }

  @Post('tasks/:id/photo')
  addPhoto(@Req() req: any, @Param('id') id: string, @Body() dto: AddTaskPhotoDto) {
    return this.journey.addTaskPhoto(req.user.userId, id, dto.imageKey)
  }
}
```

> **Ordem de rota:** `@Get('tasks')` precisa vir **antes** de `@Get('tasks/:id')` — o Nest casa na ordem de declaração (acima já está certo). E `@Get()` (raiz `/journey`) não colide com `tasks`.

**Step 3 — Module** (`journey.module.ts`, importa `MediaModule` pra injetar `MediaService`):
```ts
import { Module } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { JourneyController } from './journey.controller'
import { MediaModule } from '../media/media.module'

@Module({ imports: [MediaModule], providers: [JourneyService], controllers: [JourneyController] })
export class JourneyModule {}
```

**Step 4 — registrar** `JourneyModule` em `app.module.ts` (array `imports`, ao lado de `ReportsModule`).

**Step 5:** `npm run build` → exit 0; `npm test` → 41 (30 + 4 anchors + 7 service). Confirmar a contagem real e ajustar.

**Step 6 — commit:**
```bash
git add swi-backend/src/journey swi-backend/src/app.module.ts
git commit -m "feat(backend): JourneyModule (dto+controller+module) + registro"
```

---

### Task 5: seed — 4 tasks de hoje + upload dos 5 avatares "interested" no MinIO

**Files:** Modify `swi-backend/prisma/seed.ts`. Create `swi-backend/prisma/fixtures/interested/worker-{1..5}.png` (cópia dos assets do mobile — mantém o swi-backend self-contained, sem ler cross-sibling).

**Step 1 — copiar os 5 avatares** pro swi-backend (fixtures de seed):
```bash
mkdir -p swi-backend/prisma/fixtures/interested
cp mobile/assets/avatars/worker-1.png mobile/assets/avatars/worker-2.png \
   mobile/assets/avatars/worker-3.png mobile/assets/avatars/worker-4.png \
   mobile/assets/avatars/worker-5.png swi-backend/prisma/fixtures/interested/
```

**Step 2 — estender `seed.ts`** (append no `main()`, depois do `worker`/`profile`). Sobe os avatares pro bucket via o mesmo S3 client do `MediaService` e semeia as 4 tasks de hoje:

```ts
// ...imports no topo:
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { join } from 'path'

// dentro do main(), após criar worker+profile:

// UTC-midnight de hoje (paridade com o mock e o service.today()).
const now = new Date()
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

// Sobe os 5 avatares demo "interested" pro MinIO; guard: se o bucket não
// estiver acessível, loga e segue com keys vazias (asset decorativo).
let interestedKeys: string[] = []
try {
  const s3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
    forcePathStyle: true,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    },
  })
  const bucket = process.env.MINIO_BUCKET ?? 'swi-media'
  interestedKeys = await Promise.all(
    [1, 2, 3, 4, 5].map(async (n) => {
      const key = `interested/worker-${n}.png`
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key,
        Body: readFileSync(join(__dirname, 'fixtures', 'interested', `worker-${n}.png`)),
        ContentType: 'image/png',
      }))
      return key
    }),
  )
} catch (e) {
  console.warn('[seed] upload dos avatares interested falhou (bucket up?); tasks entram sem avatares:', (e as Error).message)
}

const SEED_TASKS = [
  { title: 'Inspeção de Equipamentos',
    description: 'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
    objective: 'Garantir que cada equipamento esteja em condições seguras de operação, identificando desgastes antes que virem falhas.' },
  { title: 'Manutenção Preventiva',
    description: 'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
    objective: 'Prolongar a vida útil dos equipamentos e minimizar paradas não planejadas executando a manutenção dentro do cronograma.' },
  { title: 'Diagnóstico de Falhas',
    description: 'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
    objective: 'Determinar com precisão a causa-raiz de cada mau funcionamento para direcionar o reparo correto.' },
  { title: 'Reparo de Componentes',
    description: 'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
    objective: 'Restaurar o funcionamento pleno dos equipamentos substituindo ou consertando as peças defeituosas identificadas.' },
]

// Re-seed limpo: apaga as tasks de hoje do worker e recria (idempotente).
await prisma.task.deleteMany({ where: { assignedTo: worker.id, scheduledDate: today } })
for (const t of SEED_TASKS) {
  await prisma.task.create({
    data: {
      assignedTo: worker.id, title: t.title, description: t.description, objective: t.objective,
      estimatedMinutes: 120, status: 'pending', accumulatedSeconds: 0, progressPct: 0,
      scheduledDate: today, imageKeys: [], interestedCount: 18, interestedAvatarKeys: interestedKeys,
    },
  })
}
```

> As telas navegam por `Task.id` real (`uuid`, default do schema) via `listTasks`/`getTask` — o seed não fixa ids.

**Step 3 — rodar** (com a stack up pra o upload funcionar): `docker compose up -d && npm run prisma:seed` → sem erro; log de bucket-ready; 4 tasks criadas.

**Step 4 — commit:**
```bash
git add swi-backend/prisma/seed.ts swi-backend/prisma/fixtures
git commit -m "feat(backend): seed de 4 tasks de hoje + avatares interested no MinIO"
```

---

### Task 6: e2e journey (supertest vs Postgres real, worker throwaway)

**Files:** Create `swi-backend/test/journey.e2e-spec.ts` (espelha `test/reports.e2e-spec.ts` — mesmo cabeçalho `process.env.MINIO_* ??=` antes de montar o app).

**Step 1 — teste.** Cria um worker throwaway + 1 task de hoje direto no Prisma (não há endpoint de criar task), depois exercita o lifecycle:

```ts
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Journey e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'journey-e2e@ex.com'
  let workerId: string, taskId: string
  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) }
  const cleanup = async () => {
    await prisma.task.deleteMany({ where: { assignee: { email } } })
    await prisma.journey.deleteMany({ where: { worker: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService); await cleanup()
    const bcrypt = await import('bcrypt')
    const u = await prisma.user.create({ data: { email, name: 'Journey E2E', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
    workerId = u.id
    const t = await prisma.task.create({ data: { assignedTo: workerId, title: 'T1', estimatedMinutes: 120, scheduledDate: today() } })
    taskId = t.id
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('journey sem token → 401', () => request(app.getHttpServer()).get('/journey').expect(401))

  it('getJourney cria idle e é idempotente no dia', async () => {
    const auth = await login()
    const { body: a } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
    expect(a.state).toBe('idle')
    await request(app.getHttpServer()).get('/journey').set(auth).expect(200) // 2ª leitura não duplica (@@unique)
  })

  it('listTasks devolve a task de hoje', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).get('/journey/tasks').set(auth).expect(200)
    expect(body.map((t: any) => t.id)).toContain(taskId)
  })

  it('getTask inexistente → 404', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/journey/tasks/nao-existe').set(auth).expect(404)
  })

  it('lifecycle: start → pause → resume → end', async () => {
    const auth = await login()
    const { body: s } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/start`).set(auth).expect(201)
    expect(s.journey.state).toBe('ongoing')
    expect(s.journey.activeTaskId).toBe(taskId)
    expect(s.task.status).toBe('in_progress')
    const { body: p } = await request(app.getHttpServer()).post('/journey/pause').set(auth).expect(201)
    expect(p.state).toBe('paused')
    const { body: r } = await request(app.getHttpServer()).post('/journey/resume').set(auth).expect(201)
    expect(r.state).toBe('ongoing')
    const { body: e } = await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
    expect(e.state).toBe('idle')
    expect(e.activeTaskId).toBeNull()
    expect(e.accumulatedSeconds).toBe(0)
    const { body: done } = await request(app.getHttpServer()).get(`/journey/tasks/${taskId}`).set(auth).expect(200)
    expect(done.status).toBe('done')
  })

  it('photo rejeita imageKey de outro prefixo → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/photo`).set(auth).send({ imageKey: 'reports/x.jpg' }).expect(400)
  })

  it('photo com key task/ válida faz append', async () => {
    const auth = await login()
    const key = `task/${'0'.repeat(8)}-0000-0000-0000-000000000000.jpg`
    const { body } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/photo`).set(auth).send({ imageKey: key }).expect(201)
    expect(body.images.length).toBeGreaterThan(0) // presigned (objeto não precisa existir pra assinar)
  })
})
```

**Step 2:** `docker compose up -d db` (se preciso) + `npm run test:e2e` → 19 (12 + 7 journey). MinIO **não** precisa estar up (presign é puro).

**Step 3 — commit:**
```bash
git add swi-backend/test/journey.e2e-spec.ts
git commit -m "test(backend): e2e do lifecycle da Jornada + ownership + bad-key"
```

---

### Task 7 (mobile): `apiJourneyBackend` + despin do selector (TDD)

**Files:** Create `mobile/services/journey/apiJourneyBackend.ts` + `apiJourneyBackend.test.ts`. Delete `mobile/services/journey/amplifyJourneyBackend.ts`. Modify `getJourneyBackend.ts` + `getJourneyBackend.test.ts`, e `mobile/services/api/uploadMedia.ts` (+test) + `swi-backend/src/media/dto.ts` + `media.controller.ts` (prefixo).

**Step 1 — teste** (`apiJourneyBackend.test.ts`; mock de `../api/http` e `../api/uploadMedia`):

```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }))
import { apiRequest } from '../api/http'
import { uploadImage } from '../api/uploadMedia'
import { apiJourneyBackend } from './apiJourneyBackend'

describe('apiJourneyBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); (uploadImage as jest.Mock).mockReset() })

  it('getJourney → GET /journey', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 })
    const out = await apiJourneyBackend.getJourney()
    expect(apiRequest).toHaveBeenCalledWith('/journey', { auth: true })
    expect(out.state).toBe('idle')
  })

  it('listTasks → GET /journey/tasks', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 't1' }])
    const out = await apiJourneyBackend.listTasks()
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks', { auth: true })
    expect(out[0].id).toBe('t1')
  })

  it('getTask 404 → null; não-404 propaga', async () => {
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
    expect(await apiJourneyBackend.getTask('x')).toBeNull()
    ;(apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    await expect(apiJourneyBackend.getTask('x')).rejects.toThrow('boom')
  })

  it('startTask → POST /journey/tasks/:id/start', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ journey: { state: 'ongoing' }, task: { id: 't1' } })
    await apiJourneyBackend.startTask('t1')
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/start', { method: 'POST', auth: true })
  })

  it('pause/resume/end → POST sem corpo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ state: 'paused' })
    await apiJourneyBackend.pauseJourney()
    expect(apiRequest).toHaveBeenCalledWith('/journey/pause', { method: 'POST', auth: true })
    await apiJourneyBackend.resumeJourney()
    expect(apiRequest).toHaveBeenCalledWith('/journey/resume', { method: 'POST', auth: true })
    await apiJourneyBackend.endJourney()
    expect(apiRequest).toHaveBeenCalledWith('/journey/end', { method: 'POST', auth: true })
  })

  it('addTaskPhoto: sobe a imagem (prefixo task) e POSTa a key', async () => {
    (uploadImage as jest.Mock).mockResolvedValue('task/k.jpg')
    ;(apiRequest as jest.Mock).mockResolvedValue({ id: 't1' })
    await apiJourneyBackend.addTaskPhoto('t1', 'file:///a/b.jpg')
    expect(uploadImage).toHaveBeenCalledWith('file:///a/b.jpg', 'task')
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/photo', { method: 'POST', body: { imageKey: 'task/k.jpg' }, auth: true })
  })
})
```

**Step 2:** `cd mobile && npx jest services/journey/apiJourneyBackend.test.ts` → FAIL.

**Step 3 — dar suporte a prefixo no `uploadImage`.** O `uploadImage` da Fatia 2 tem prefixo fixo `reports/` no server. Estender pra o cliente pedir o prefixo (default `'reports'` — não quebra a Fatia 2):

- `mobile/services/api/uploadMedia.ts`:
  ```ts
  export async function uploadImage(uri: string, prefix = 'reports'): Promise<string> {
    const contentType = contentTypeFor(uri);
    const { url, key } = await apiRequest<{ url: string; key: string }>('/media/presign', {
      method: 'POST', body: { contentType, prefix }, auth: true,
    });
    const blob = await (await fetch(uri)).blob();
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob as any });
    if (!put.ok) throw new Error(`Falha ao subir imagem (${put.status})`);
    return key;
  }
  ```
  Atualizar `uploadMedia.test.ts`: o body do presign no caso default agora inclui `prefix: 'reports'`.
- `swi-backend/src/media/dto.ts` (`PresignDto`) + `media.controller.ts`: aceitar `prefix` opcional restrito a `['reports','task']` e repassar a `presignPut(contentType, prefix)`:
  ```ts
  // dto.ts
  import { IsIn, IsOptional, IsString } from 'class-validator'
  export class PresignDto {
    @IsString() @IsIn(['image/jpeg', 'image/png']) contentType!: string
    @IsOptional() @IsString() @IsIn(['reports', 'task']) prefix?: string
  }
  // controller
  @Post('presign')
  presign(@Body() dto: PresignDto) {
    return this.media.presignPut(dto.contentType, dto.prefix ?? 'reports')
  }
  ```
  Rodar `npx jest src/media` + `npm run test:e2e -t Reports` — se algo assertava o shape exato do body, ajustar (o default `'reports'` preserva o comportamento).

**Step 4 — implementar** (`apiJourneyBackend.ts`):
```ts
import type { JourneyBackend, JourneySession, Task } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// O backend já devolve o shape mobile pronto (URLs presigned, ISO), então sem fromApi.
export const apiJourneyBackend: JourneyBackend = {
  getJourney() {
    return apiRequest<JourneySession>('/journey', { auth: true });
  },
  listTasks() {
    return apiRequest<Task[]>('/journey/tasks', { auth: true });
  },
  async getTask(id) {
    try {
      return await apiRequest<Task>(`/journey/tasks/${id}`, { auth: true });
    } catch (e) {
      if ((e as any).status === 404) return null;
      throw e;
    }
  },
  startTask(taskId) {
    return apiRequest<{ journey: JourneySession; task: Task }>(`/journey/tasks/${taskId}/start`, { method: 'POST', auth: true });
  },
  pauseJourney() {
    return apiRequest<JourneySession>('/journey/pause', { method: 'POST', auth: true });
  },
  resumeJourney() {
    return apiRequest<JourneySession>('/journey/resume', { method: 'POST', auth: true });
  },
  endJourney() {
    return apiRequest<JourneySession>('/journey/end', { method: 'POST', auth: true });
  },
  async addTaskPhoto(taskId, uri) {
    const imageKey = await uploadImage(uri, 'task');
    return apiRequest<Task>(`/journey/tasks/${taskId}/photo`, { method: 'POST', body: { imageKey }, auth: true });
  },
};
```

**Step 5 — despin** `getJourneyBackend.ts`:
```ts
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { JourneyBackend } from './types';
import { mockJourneyBackend } from './mockJourneyBackend';
import { apiJourneyBackend } from './apiJourneyBackend';

export function getJourneyBackend(): JourneyBackend {
  return DATA_BACKEND === 'api' ? apiJourneyBackend : mockJourneyBackend;
}
```
E `getJourneyBackend.test.ts`: o 2º caso passa a esperar `apiJourneyBackend` com a flag em `api` (espelha `getReportsBackend.test`):
```ts
it('retorna apiJourneyBackend com a flag em api', () => {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'api' }));
  const { getJourneyBackend } = require('./getJourneyBackend');
  const { apiJourneyBackend } = require('./apiJourneyBackend');
  expect(getJourneyBackend()).toBe(apiJourneyBackend);
});
```
Deletar `amplifyJourneyBackend.ts`.

**Step 6:** `npx tsc --noEmit` (8 baseline, 0 novos) + `npx jest services/journey services/api` (verde). `git grep "amplifyJourneyBackend" -- mobile/` → vazio.

**Step 7 — commit:**
```bash
git add mobile/services/journey mobile/services/api/uploadMedia.ts mobile/services/api/uploadMedia.test.ts \
        swi-backend/src/media/dto.ts swi-backend/src/media/media.controller.ts
git rm mobile/services/journey/amplifyJourneyBackend.ts
git commit -m "feat(mobile): apiJourneyBackend + prefixo task/ no uploadMedia; liga o seam de jornada ao real"
```

---

### Task 8: docker smoke (MinIO real) + tripé mobile + PR

**Step 1 — smoke** (prova o round-trip real que tsc/jest não provam):
```bash
cd swi-backend && docker compose up --build -d && sleep 8 && npm run prisma:seed
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}' | grep -o '"accessToken":"[^"]*"' | sed 's/.*:"//;s/"//')
# journey get-or-create + lista
curl -s -o /dev/null -w 'JOURNEY=%{http_code}\n' localhost:3000/journey -H "Authorization: Bearer $TOKEN"
TASK=$(curl -s localhost:3000/journey/tasks -H "Authorization: Bearer $TOKEN" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
echo "task=$TASK"
# start
curl -s -o /dev/null -w 'START=%{http_code}\n' -X POST localhost:3000/journey/tasks/$TASK/start -H "Authorization: Bearer $TOKEN"
# foto: presign task/ → PUT → photo
PRE=$(curl -s -X POST localhost:3000/media/presign -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"contentType":"image/png","prefix":"task"}')
PUT_URL=$(echo "$PRE" | grep -o '"url":"[^"]*"' | sed 's/.*:"//;s/"//;s/\\u0026/\&/g'); KEY=$(echo "$PRE" | grep -o '"key":"[^"]*"' | sed 's/.*:"//;s/"//')
printf 'x' > /tmp/pt.png && curl -s -o /dev/null -w 'PUT=%{http_code}\n' -X PUT --upload-file /tmp/pt.png "$PUT_URL"
curl -s -o /dev/null -w 'PHOTO=%{http_code}\n' -X POST localhost:3000/journey/tasks/$TASK/photo -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"imageKey\":\"$KEY\"}"
curl -s -o /dev/null -w 'END=%{http_code}\n' -X POST localhost:3000/journey/end -H "Authorization: Bearer $TOKEN"
# a foto volta pela presigned GET
IMG=$(curl -s localhost:3000/journey/tasks/$TASK -H "Authorization: Bearer $TOKEN" | grep -o '"images":\[[^]]*\]')
GET_URL=$(echo "$IMG" | grep -o 'http[^"]*' | head -1 | sed 's/\\u0026/\&/g')
curl -s -o /dev/null -w 'IMG_GET=%{http_code}\n' "$GET_URL"
```
Expected: `JOURNEY=200`; `task=<uuid>`; `START=201`; `PUT=200`; `PHOTO=201`; `END=201`; `IMG_GET=200`. Confirmar também no `/journey/tasks` que os `interestedAvatars` do seed voltam como URLs http (upload do seed funcionou).

**Step 2 — tripé mobile:** `cd mobile && npx tsc --noEmit` (8) `; npx jest` (verde, 144 + novos) `; npx expo export --platform web` (exit 0).

**Step 3 — two-gate + holística:** review spec (bate no design) + quality por metade (backend, mobile); review holística da fatia inteira. Corrigir legítimos/no-escopo e re-verificar verde.

**Step 4 — push + PR** (SÓ com luz verde explícita): `git push -u origin feat/backend-jornada` + PR contra `main` (REST API — sem `gh`; corpo em arquivo no scratchpad; **sem rodapé de IA**). Se empilhado na Fatia 2, retarget/rebase após #26 mergear.

---

## Fora do escopo (YAGNI)

- CRUD de task (criar/editar/apagar — atribuição é externa; seedada nesta fase).
- Feature real de "interesse" (count + avatares são seed decorativo).
- Paginação do `listTasks`; auto-pause da task anterior no `startTask`.
- Saúde/vitals (mock permanente até a smartband).
- Deploy AWS (MinIO→S3, bucket via IaC, secrets SSM; upload de avatares vira fixture/IaC) — herança da rodada.
- Migração dos outros domínios (chat/notif/clima/evacuação) — fatias seguintes.

---

## Nota de commits

A rodada commita **por task** mas **só com luz verde explícita do usuário** (regra do projeto: aprovar plano ≠ autorizar commit). Os blocos `git commit` acima são o ponto de corte sugerido; executá-los depende do OK.
