# Fatia 2 — Relatórios + MinIO Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) task-by-task.

**Goal:** Ligar as telas de Relatórios ao backend real: `ReportsModule` + `MediaModule` (presigned URLs) no NestJS + MinIO no compose + `apiReportsBackend` no mobile atrás do seam `DATA_BACKEND==='api'`.

**Architecture:** Ver `docs/plans/2026-07-02-swi-backend-fatia2-relatorios-design.md`. Backend espelha `src/profile/`. `MediaService` **só presigna** (computação pura, zero rede em runtime); o cliente RN faz PUT/GET direto no MinIO. Bucket criado por um sidecar `minio/mc` (em AWS = IaC), então o e2e sobe o `AppModule` inteiro sem MinIO up. Telas/provider intocados (o seam absorve). Model `Report` já existe (Fatia 0), sem migration nova.

**Tech Stack:** NestJS + Prisma + `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (backend, **deps novas**); Expo/RN + Jest (mobile, **sem dep nova** — upload por `fetch().blob() → PUT`).

**Branch:** `feat/backend-relatorios` a partir de `main` (`1776f8c`, contém Fatias 0+1). **Já criada.**

**Baselines (pós-Perfil):** backend build 0, unit 23, e2e 5; mobile jest 137, tsc 8 (0 novos), expo export web exit 0. Docker smoke obrigatório (com MinIO real).

**Identidade:** `req.user.userId` (do JWT) como `Report.authorId`. Denorm de exibição vem do `Profile` do autor (`fullName`/`avatarKey`/`sector`), fallback `user.name`.

**Contrato mobile (intocado):** `ReportsBackend = { list(): Report[]; get(id): Report|null; create(input): Report }`. `Report`/`ReportInput` em `mobile/services/reports/types.ts`. **Sem update/delete.**

---

### Task 1: branch (feita)

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git switch feat/backend-relatorios   # já criada a partir de main 1776f8c
```

---

### Task 2: deps + docker-compose (MinIO + sidecar) + env

**Files:** Modify `swi-backend/package.json` (via npm), `swi-backend/docker-compose.yml`, `swi-backend/.env` (local, gitignored).

**Step 1 — deps:**
```bash
cd swi-backend && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```
Expected: `package.json` + `package-lock.json` atualizados, `npm run build` ainda exit 0.

**Step 2 — compose:** adicionar dois serviços + volume, e env do `api`. `docker-compose.yml`:

```yaml
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["swi_minio:/data"]

  minio-init:
    image: minio/mc
    depends_on:
      minio: { condition: service_started }
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 minioadmin minioadmin; do echo waiting-minio; sleep 1; done;
      mc mb --ignore-existing local/swi-media;
      echo bucket-ready; exit 0;
      "
```

No serviço `api`, acrescentar ao bloco `environment:`:
```yaml
      MINIO_PUBLIC_URL: ${MINIO_PUBLIC_URL:-http://localhost:9000}
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY:-minioadmin}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY:-minioadmin}
      MINIO_BUCKET: ${MINIO_BUCKET:-swi-media}
      MINIO_REGION: ${MINIO_REGION:-us-east-1}
```
E no bloco `volumes:` do fim do arquivo, adicionar `swi_minio:` ao lado de `swi_pgdata:`.

Nota QA: `MINIO_PUBLIC_URL` default `http://localhost:9000` serve iOS-sim/web na mesma máquina. Android emu → `http://10.0.2.2:9000`. Device físico sobre ngrok → domínio do túnel do MinIO. O host da URL presigned tem que ser alcançável pelo device.

**Step 3 — verificar compose:** `docker compose config` → sem erro de parse. (Não subir ainda; smoke é a Task 10.)

---

### Task 3: MediaService (TDD, `getSignedUrl` mockado)

**Files:** Create `swi-backend/src/media/media.service.ts` + `media.service.spec.ts`.

**Step 1 — teste falhando** (`media.service.spec.ts`):

```ts
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/obj?sig=1'),
}))
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MediaService } from './media.service'

describe('MediaService', () => {
  beforeEach(() => (getSignedUrl as jest.Mock).mockClear())

  it('presignPut gera key namespaced reports/<uuid>.<ext> e devolve url', async () => {
    const { url, key } = await new MediaService().presignPut('image/png')
    expect(url).toBe('https://signed.example/obj?sig=1')
    expect(key).toMatch(/^reports\/[0-9a-f-]{36}\.png$/)
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('presignPut default jpg pra content-type não-png', async () => {
    const { key } = await new MediaService().presignPut('image/jpeg')
    expect(key).toMatch(/\.jpg$/)
  })

  it('presignGetMany assina cada key', async () => {
    const urls = await new MediaService().presignGetMany(['reports/a.jpg', 'reports/b.jpg'])
    expect(urls).toEqual(['https://signed.example/obj?sig=1', 'https://signed.example/obj?sig=1'])
    expect(getSignedUrl).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2:** `npx jest src/media/media.service.spec.ts` → FAIL (módulo não existe).

**Step 3 — implementar** (`media.service.ts`):

```ts
import { Injectable } from '@nestjs/common'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const PUT_TTL = 300 // 5 min pra subir
const GET_TTL = 3600 // 1 h pra ler

@Injectable()
export class MediaService {
  // endpoint unset em AWS → SDK usa o S3 real; forcePathStyle só contra MinIO.
  private readonly s3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_URL || undefined,
    forcePathStyle: !!process.env.MINIO_PUBLIC_URL,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  })
  private readonly bucket = process.env.MINIO_BUCKET ?? 'swi-media'

  private ext(contentType: string): string {
    return contentType === 'image/png' ? 'png' : 'jpg'
  }

  // Assina só Bucket+Key (não constrange content-type) → o cliente PUTa o blob
  // sem risco de signature-mismatch de header.
  async presignPut(contentType: string, prefix = 'reports'): Promise<{ url: string; key: string }> {
    const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: PUT_TTL })
    return { url, key }
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: GET_TTL })
  }

  presignGetMany(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.presignGet(k)))
  }
}
```

**Step 4:** `npx jest src/media/media.service.spec.ts` → PASS (3/3).

---

### Task 4: Media DTO + Controller + Module + registro

**Files:** Create `swi-backend/src/media/dto.ts`, `media.controller.ts`, `media.module.ts`. Modify `swi-backend/src/app.module.ts`.

**Step 1 — DTO** (`dto.ts`):
```ts
import { IsIn, IsString } from 'class-validator'
export class PresignDto {
  @IsString() @IsIn(['image/jpeg', 'image/png']) contentType!: string
}
```

**Step 2 — Controller** (`media.controller.ts`):
```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { MediaService } from './media.service'
import { PresignDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign')
  presign(@Body() dto: PresignDto) {
    return this.media.presignPut(dto.contentType)
  }
}
```

**Step 3 — Module** (`media.module.ts`, **exporta** MediaService pro ReportsModule):
```ts
import { Module } from '@nestjs/common'
import { MediaService } from './media.service'
import { MediaController } from './media.controller'

@Module({ providers: [MediaService], controllers: [MediaController], exports: [MediaService] })
export class MediaModule {}
```

**Step 4 — registrar** em `app.module.ts`: importar `MediaModule` e adicionar ao array `imports`.

**Step 5:** `npm run build` → exit 0; `npm test` → 26 (23 + 3 do media).

---

### Task 5: ReportsService (TDD, Prisma + MediaService mockados)

**Files:** Create `swi-backend/src/reports/reports.service.ts` + `reports.service.spec.ts`.

**Step 1 — teste falhando** (`reports.service.spec.ts`):

```ts
import { ReportsService } from './reports.service'

const media = () => ({
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
}) as any

const prisma = () => ({
  report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn() },
}) as any

const row = (over = {}) => ({
  id: 'r1', title: 'T', summary: null, status: 'pending', statusLabel: 'Em Revisão',
  authorName: 'Ana', authorAvatarKey: 'reports/av.jpg', creationDate: new Date('2026-01-02T00:00:00Z'),
  sector: null, responsibles: ['Ana'], details: null, imageKeys: ['reports/x.jpg'], activities: [], ...over,
})

describe('ReportsService', () => {
  it('list ordena por createdAt desc e mapeia keys→urls presigned', async () => {
    const db = prisma(); db.report.findMany.mockResolvedValue([row()])
    const out = await new ReportsService(db, media()).list()
    expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } })
    expect(out[0].images).toEqual(['signed:reports/x.jpg'])
    expect(out[0].authorAvatarUri).toBe('signed:reports/av.jpg')
    expect(out[0].creationDate).toBe('02/01/2026')
    expect(out[0].summary).toBe('')       // null → '' (telas exigem string)
  })

  it('get inexistente → null', async () => {
    const db = prisma(); db.report.findUnique.mockResolvedValue(null)
    expect(await new ReportsService(db, media()).get('nope')).toBeNull()
  })

  it('create seta authorId do JWT, denorm do profile e defaults', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg', sector: 'Noroeste' } })
    db.report.create.mockResolvedValue(row({ authorName: 'Ana Perfil' }))
    await new ReportsService(db, media()).create('u1', { title: 'T', responsibles: [], imageKeys: ['reports/x.jpg'] } as any)
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
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', profile: null })
    db.report.create.mockResolvedValue(row())
    await new ReportsService(db, media()).create('u1', { title: 'T' } as any)
    expect(db.report.create.mock.calls[0][0].data.authorName).toBe('Fallback')
  })
})
```

**Step 2:** `npx jest src/reports/reports.service.spec.ts` → FAIL.

**Step 3 — implementar** (`reports.service.ts`):

```ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import type { Report } from '@prisma/client'
import type { CreateReportDto } from './dto'

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  async list() {
    const rows = await this.prisma.report.findMany({ orderBy: { createdAt: 'desc' } })
    return Promise.all(rows.map((r) => this.toDto(r)))
  }

  async get(id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } })
    return r ? this.toDto(r) : null
  }

  async create(authorId: string, dto: CreateReportDto) {
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, include: { profile: true } })
    const r = await this.prisma.report.create({
      data: {
        authorId,
        title: dto.title,
        summary: dto.summary,
        details: dto.details,
        responsibles: dto.responsibles ?? [],
        imageKeys: dto.imageKeys ?? [],
        status: 'pending',
        statusLabel: 'Em Revisão',
        authorName: author?.profile?.fullName ?? author?.name ?? null,
        authorAvatarKey: author?.profile?.avatarKey ?? null,
        sector: author?.profile?.sector ?? null,
        activities: [],
      },
    })
    return this.toDto(r)
  }

  // Devolve exatamente o shape mobile `Report` (keys→urls presigned, date
  // dd/mm/yyyy, null→'' nos campos string que as telas exigem).
  private async toDto(r: Report) {
    return {
      id: r.id,
      title: r.title,
      summary: r.summary ?? '',
      status: r.status,
      statusLabel: r.statusLabel ?? '',
      authorName: r.authorName ?? '',
      authorAvatarUri: r.authorAvatarKey ? await this.media.presignGet(r.authorAvatarKey) : '',
      creationDate: this.formatDate(r.creationDate),
      sector: r.sector ?? '',
      responsibles: r.responsibles,
      details: r.details ?? '',
      images: await this.media.presignGetMany(r.imageKeys),
      activities: (r.activities as unknown) ?? [],
    }
  }

  private formatDate(d: Date): string {
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${d.getUTCFullYear()}`
  }
}
```

**Step 4:** `npx jest src/reports/reports.service.spec.ts` → PASS (4/4).

---

### Task 6: Reports DTO + Controller + Module + registro

**Files:** Create `swi-backend/src/reports/dto.ts`, `reports.controller.ts`, `reports.module.ts`. Modify `swi-backend/src/app.module.ts`.

**Step 1 — DTO** (`dto.ts`; whitelist global já descarta extras → cliente não seta `status`/`authorId`):
```ts
import { IsArray, IsOptional, IsString } from 'class-validator'
export class CreateReportDto {
  @IsString() title!: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @IsString({ each: true }) responsibles?: string[]
  @IsOptional() @IsArray() @IsString({ each: true }) imageKeys?: string[]
}
```

**Step 2 — Controller** (`reports.controller.ts`):
```ts
import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CreateReportDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.list()
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const r = await this.reports.get(id)
    if (!r) throw new NotFoundException('Relatório não encontrado')
    return r
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateReportDto) {
    return this.reports.create(req.user.userId, dto)
  }
}
```

**Step 3 — Module** (`reports.module.ts`, importa MediaModule pra injetar MediaService):
```ts
import { Module } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { ReportsController } from './reports.controller'
import { MediaModule } from '../media/media.module'

@Module({ imports: [MediaModule], providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
```

**Step 4 — registrar** `ReportsModule` em `app.module.ts` (array `imports`).

**Step 5:** `npm run build` → exit 0; `npm test` → 30 (26 + 4 do reports).

---

### Task 7: e2e reports + presign (supertest vs Postgres real, usuário throwaway)

**Files:** Create `swi-backend/test/reports.e2e-spec.ts` (espelha `test/profile.e2e-spec.ts`).

**Step 1 — teste.** Cabeçalho seta MINIO_* dummy ANTES de montar o app (o `S3Client` é construído na instanciação do `MediaService`; presign é puro, não faz rede):

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

describe('Reports e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'reports-e2e@ex.com'
  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }
  const cleanup = async () => {
    await prisma.report.deleteMany({ where: { author: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService); await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Reports E2E', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('reports sem token → 401', () => request(app.getHttpServer()).get('/reports').expect(401))

  it('media presign devolve url + key namespaced', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'image/jpeg' }).expect(201)
    expect(typeof body.url).toBe('string')
    expect(body.key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  it('presign rejeita content-type inválido → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'application/pdf' }).expect(400)
  })

  it('create → list newest-first + get by id', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R1' }).expect(201)
    const { body: r2 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R2', responsibles: ['Ana'] }).expect(201)
    const { body: list } = await request(app.getHttpServer()).get('/reports').set(auth).expect(200)
    expect(list[0].title).toBe('R2')     // mais recente primeiro
    expect(list[1].title).toBe('R1')
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r2.id}`).set(auth).expect(200)
    expect(one.title).toBe('R2')
    expect(one.responsibles).toEqual(['Ana'])
  })

  it('get inexistente → 404', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/reports/nao-existe').set(auth).expect(404)
  })

  it('whitelist descarta status/authorId (anti mass-assignment)', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'Hack', status: 'accept', authorId: 'outro' }).expect(201)
    expect(body.status).toBe('pending')   // default do server, não o enviado
  })
})
```

**Step 2:** `docker compose up -d db` (se preciso) + `npm run test:e2e` → 11 (5 + 6 do reports). MinIO **não** precisa estar up (presign é puro).

---

### Task 8 (mobile): `services/api/uploadMedia.ts` (TDD)

**Files:** Create `mobile/services/api/uploadMedia.ts` + `uploadMedia.test.ts`.

**Step 1 — teste** (`uploadMedia.test.ts`): mock de `./http` (apiRequest) + `global.fetch`.

```ts
jest.mock('./http', () => ({ apiRequest: jest.fn() }))
import { apiRequest } from './http'
import { contentTypeFor, uploadImage } from './uploadMedia'

describe('uploadMedia', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset()
    ;(global as any).fetch = jest.fn()
  })

  it('contentTypeFor infere png/jpeg pela extensão', () => {
    expect(contentTypeFor('file:///a/b.png')).toBe('image/png')
    expect(contentTypeFor('file:///a/b.jpg')).toBe('image/jpeg')
    expect(contentTypeFor('file:///a/b')).toBe('image/jpeg') // default
  })

  it('uploadImage: presign → PUT do blob → devolve key', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://minio/put?sig=1', key: 'reports/k.jpg' })
    const blob = { size: 3 }
    ;(global as any).fetch
      .mockResolvedValueOnce({ blob: async () => blob })          // fetch(file://)
      .mockResolvedValueOnce({ ok: true, status: 200 })           // PUT presigned
    const key = await uploadImage('file:///a/b.jpg')
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg' }, auth: true })
    const putCall = (global as any).fetch.mock.calls[1]
    expect(putCall[0]).toBe('https://minio/put?sig=1')
    expect(putCall[1].method).toBe('PUT')
    expect(putCall[1].body).toBe(blob)
    expect(key).toBe('reports/k.jpg')
  })

  it('uploadImage propaga falha de PUT', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'k' })
    ;(global as any).fetch
      .mockResolvedValueOnce({ blob: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/500/)
  })
})
```

**Step 2:** `npx jest services/api/uploadMedia.test.ts` → FAIL.

**Step 3 — implementar** (`uploadMedia.ts`):

```ts
import { apiRequest } from './http';

// Infere content-type da extensão (default jpeg — cobre uris sem extensão do picker).
export function contentTypeFor(uri: string): string {
  return /\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg';
}

// Sobe um arquivo local (file://) numa URL presigned via PUT. Retorna a key
// que o backend guarda. Fundação de mídia — o Chat (Fatia 4) reusa.
export async function uploadImage(uri: string): Promise<string> {
  const contentType = contentTypeFor(uri);
  const { url, key } = await apiRequest<{ url: string; key: string }>('/media/presign', {
    method: 'POST', body: { contentType }, auth: true,
  });
  const blob = await (await fetch(uri)).blob();
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob as any });
  if (!put.ok) throw new Error(`Falha ao subir imagem (${put.status})`);
  return key;
}
```

**Step 4:** `npx jest services/api/uploadMedia.test.ts` → PASS (3/3).

> Fallback (se o teste manual no dev build mostrar upload vazio/corrompido): trocar o `fetch().blob()→PUT` por `expo-file-system/legacy` `uploadAsync(url, uri, { httpMethod:'PUT', uploadType: BINARY_CONTENT, headers })` (`npx expo install expo-file-system`). Documentado; não implementar preventivamente (YAGNI).

---

### Task 9 (mobile): `apiReportsBackend` + despin do selector (TDD)

**Files:** Create `mobile/services/reports/apiReportsBackend.ts` + `apiReportsBackend.test.ts`. Delete `mobile/services/reports/amplifyReportsBackend.ts`. Modify `getReportsBackend.ts` + `getReportsBackend.test.ts`.

**Step 1 — teste** (`apiReportsBackend.test.ts`): mock de `../api/http` e `../api/uploadMedia`.

```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }))
import { apiRequest } from '../api/http'
import { uploadImage } from '../api/uploadMedia'
import { apiReportsBackend } from './apiReportsBackend'

describe('apiReportsBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); (uploadImage as jest.Mock).mockReset() })

  it('list → GET /reports (o server já devolve o shape pronto)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 'r1', title: 'T' }])
    const out = await apiReportsBackend.list()
    expect(apiRequest).toHaveBeenCalledWith('/reports', { auth: true })
    expect(out[0].id).toBe('r1')
  })

  it('get inexistente (404) → null', async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    expect(await apiReportsBackend.get('x')).toBeNull()
  })

  it('get propaga erro não-404', async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await expect(apiReportsBackend.get('x')).rejects.toThrow('boom')
  })

  it('create: sobe cada imagem e POSTa com imageKeys', async () => {
    (uploadImage as jest.Mock).mockResolvedValueOnce('reports/a.jpg').mockResolvedValueOnce('reports/b.jpg')
    ;(apiRequest as jest.Mock).mockResolvedValue({ id: 'novo', title: 'T' })
    await apiReportsBackend.create({ title: 'T', summary: 'S', details: 'D', responsibles: ['Ana'], imageUris: ['file://a', 'file://b'] })
    expect(uploadImage).toHaveBeenCalledTimes(2)
    expect(apiRequest).toHaveBeenCalledWith('/reports', {
      method: 'POST',
      body: { title: 'T', summary: 'S', details: 'D', responsibles: ['Ana'], imageKeys: ['reports/a.jpg', 'reports/b.jpg'] },
      auth: true,
    })
  })
})
```

**Step 2:** rodar → FAIL.

**Step 3 — implementar** (`apiReportsBackend.ts`):

```ts
import type { Report, ReportInput, ReportsBackend } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// O backend já devolve o shape mobile `Report` pronto (imagens como URLs
// presigned, creationDate dd/mm/yyyy, null→'' coalescido), então não há fromApi.
export const apiReportsBackend: ReportsBackend = {
  list() {
    return apiRequest<Report[]>('/reports', { auth: true });
  },
  async get(id) {
    try {
      return await apiRequest<Report>(`/reports/${id}`, { auth: true });
    } catch (e) {
      if ((e as any).status === 404) return null; // 404 esperado; 500/rede propaga
      throw e;
    }
  },
  async create(input: ReportInput) {
    const imageKeys: string[] = [];
    for (const uri of input.imageUris) imageKeys.push(await uploadImage(uri));
    return apiRequest<Report>('/reports', {
      method: 'POST',
      body: {
        title: input.title, summary: input.summary, details: input.details,
        responsibles: input.responsibles, imageKeys,
      },
      auth: true,
    });
  },
};
```

**Step 4 — despin** `getReportsBackend.ts`:
```ts
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ReportsBackend } from './types';
import { mockReportsBackend } from './mockReportsBackend';
import { apiReportsBackend } from './apiReportsBackend';

export function getReportsBackend(): ReportsBackend {
  return DATA_BACKEND === 'api' ? apiReportsBackend : mockReportsBackend;
}
```

E `getReportsBackend.test.ts`: o caso `'api'` passa a esperar `apiReportsBackend` (não mais o mock). Substituir o 2º teste:
```ts
it('retorna apiReportsBackend com a flag em api', () => {
  jest.resetModules()
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'api' }))
  const { getReportsBackend } = require('./getReportsBackend')
  const { apiReportsBackend } = require('./apiReportsBackend')
  expect(getReportsBackend()).toBe(apiReportsBackend)
})
```
Deletar `amplifyReportsBackend.ts`.

**Step 5:** `npx tsc --noEmit` (8 baseline, 0 novos) + `npx jest services/reports services/api` (verde). `git grep "amplifyReportsBackend" -- mobile/` → vazio.

---

### Task 10: docker smoke (MinIO real) + tripé mobile + PR

**Step 1 — smoke** (prova o round-trip real que tsc/jest não provam):
```bash
cd swi-backend && docker compose up --build -d && sleep 8
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}' | grep -o '"accessToken":"[^"]*"' | sed 's/.*:"//;s/"//')
# presign
PRE=$(curl -s -X POST localhost:3000/media/presign -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"contentType":"image/png"}')
echo "$PRE"
PUT_URL=$(echo "$PRE" | grep -o '"url":"[^"]*"' | sed 's/.*:"//;s/"//;s/\\u0026/\&/g')
KEY=$(echo "$PRE" | grep -o '"key":"[^"]*"' | sed 's/.*:"//;s/"//')
# PUT de 1 byte na presigned
printf 'x' > /tmp/px.png && curl -s -o /dev/null -w 'PUT=%{http_code}\n' -X PUT --upload-file /tmp/px.png "$PUT_URL"
# create com a key + list + get imagem
curl -s -o /dev/null -w 'CREATE=%{http_code}\n' -X POST localhost:3000/reports -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"title\":\"Smoke\",\"imageKeys\":[\"$KEY\"]}"
IMG=$(curl -s localhost:3000/reports -H "Authorization: Bearer $TOKEN" | grep -o '"images":\[[^]]*\]' | head -1)
echo "images=$IMG"
GET_URL=$(echo "$IMG" | grep -o 'http[^"]*' | head -1 | sed 's/\\u0026/\&/g')
curl -s -o /dev/null -w 'IMG_GET=%{http_code}\n' "$GET_URL"
```
Expected: presign devolve url+key; `PUT=200`; `CREATE=201`; `images=[...http...]`; `IMG_GET=200` (a foto volta pela URL presigned). Nota: `localhost:9000` na PUT/GET funciona porque o smoke roda no host (mesma máquina do MinIO).

**Step 2 — tripé mobile:** `cd mobile && npx tsc --noEmit` (8) `; npx jest` (verde, ~137 + novos) `; npx expo export --platform web` (exit 0).

**Step 3 — two-gate + holística:** review spec (bate no design) + quality por metade (backend, mobile); review holística da fatia inteira.

**Step 4 — push + PR** (SÓ com luz verde explícita): `git push -u origin feat/backend-relatorios` + PR contra `main` (REST API — sem `gh`; corpo em arquivo no scratchpad; **sem rodapé de IA**).

---

## Fora do escopo (YAGNI)

- Update/delete de relatório (contrato mobile não tem).
- Geração de `activities` (sem UI admin) — persistem `[]`.
- Proxy de mídia / cache / thumbnails; upload de avatar (concern do Profile).
- Deploy AWS (MinIO→S3, bucket via IaC, secrets SSM) — herança da rodada.
- Migração dos outros domínios (jornada/chat/notif/clima/evacuação) — fatias 3-7.
