# Fatia 1 — Perfil Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou subagent-driven-development) task-by-task.

**Goal:** Ligar as telas de perfil ao backend real: `ProfileModule` REST no NestJS + `apiProfileBackend` no mobile atrás do seam `DATA_BACKEND==='api'`.

**Architecture:** Ver `docs/plans/2026-07-02-swi-backend-perfil-design.md`. Backend espelha `src/users/`+`src/auth/`. Mobile extrai um helper HTTP compartilhado do `apiAuthBackend` e escreve o `apiProfileBackend` sobre ele. Telas/provider intocados (o seam absorve). Model `Profile` já existe (Fatia 0), sem migration nova.

**Tech Stack:** NestJS + Prisma (backend), Expo/RN + Jest (mobile). Sem dependência nova.

**Branch:** `feat/backend-perfil` a partir de `main` (`fc8d3d8`, já contém a Fatia 0).

**Baselines:** mobile jest 123, tsc 8 baseline (0 novos), expo export web exit 0; backend build 0, unit 20, e2e 2. Docker smoke obrigatório.

**Identidade:** JWT payload `{sub, role}`; a `JwtStrategy.validate` expõe `req.user = { userId: payload.sub, role }`. Usar `req.user.userId` como `Profile.userId`.

---

### Task 1: branch

```bash
cd /c/Users/Gabriel/Documents/SWI-mobile
git fetch origin && git checkout -b feat/backend-perfil origin/main
```

---

### Task 2: ProfileService (TDD, Prisma mockado)

**Files:** Create `swi-backend/src/profile/profile.service.ts` + `.spec.ts`.

**Step 1 — teste falhando** (`profile.service.spec.ts`, estilo `users.service.spec.ts`):

```ts
import { ProfileService } from './profile.service'

const prisma = () => ({ profile: { findUnique: jest.fn(), upsert: jest.fn() } }) as any

describe('ProfileService', () => {
  it('getByUserId retorna o profile do usuário', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue({ userId: 'u1', fullName: 'Ana' })
    const r = await new ProfileService(db).getByUserId('u1')
    expect(db.profile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(r?.fullName).toBe('Ana')
  })

  it('getByUserId retorna null quando não existe', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue(null)
    expect(await new ProfileService(db).getByUserId('nope')).toBeNull()
  })

  it('upsert cria quando não existe (create carrega userId)', async () => {
    const db = prisma()
    db.profile.upsert.mockResolvedValue({ userId: 'u1', city: 'SP' })
    await new ProfileService(db).upsert('u1', { city: 'SP' })
    expect(db.profile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', city: 'SP' },
      update: { city: 'SP' },
    })
  })
})
```

**Step 2:** `npx jest src/profile/profile.service.spec.ts` → FAIL (módulo não existe).

**Step 3 — implementar** (`profile.service.ts`, estilo `users.service.ts`):

```ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma, Profile } from '@prisma/client'

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  getByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } })
  }

  upsert(userId: string, patch: Prisma.ProfileUpdateInput): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...(patch as Prisma.ProfileCreateInput) },
      update: patch,
    })
  }
}
```

**Step 4:** `npx jest src/profile/profile.service.spec.ts` → PASS (3/3).

---

### Task 3: DTO + Controller + Module

**Files:** Create `swi-backend/src/profile/dto.ts`, `profile.controller.ts`, `profile.module.ts`. Modify `swi-backend/src/app.module.ts` (registrar `ProfileModule`).

**Step 1 — DTO** (`dto.ts`, estilo `auth/dto.ts`, one-liner house style):

```ts
import { IsOptional, IsString, IsDateString, Length } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional() @IsString() fullName?: string
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() cpf?: string
  @IsOptional() @IsDateString() birthDate?: string        // ISO YYYY-MM-DD (cliente converte do BR)
  @IsOptional() @IsString() cep?: string
  @IsOptional() @IsString() street?: string
  @IsOptional() @IsString() number?: string
  @IsOptional() @IsString() complement?: string
  @IsOptional() @IsString() neighborhood?: string
  @IsOptional() @IsString() city?: string
  @IsOptional() @IsString() @Length(2, 2) uf?: string
}
```

Nota: `birthDate` chega ISO e o Prisma `@db.Date` aceita `DateTime`. Converter `new Date(dto.birthDate)` no controller antes do upsert (feito no Step 2). Validar no e2e.

**Step 2 — Controller** (`profile.controller.ts`):

```ts
import { Body, Controller, Get, NotFoundException, Put, Req, UseGuards } from '@nestjs/common'
import { ProfileService } from './profile.service'
import { UpdateProfileDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  async me(@Req() req: any) {
    const p = await this.profile.getByUserId(req.user.userId)
    if (!p) throw new NotFoundException('Perfil ainda não preenchido')
    return p
  }

  @Put('me')
  update(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const data = { ...dto, ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}) }
    return this.profile.upsert(req.user.userId, data)
  }
}
```

**Step 3 — Module** (`profile.module.ts`, estilo `users.module.ts`) + registrar em `app.module.ts` (adicionar `ProfileModule` ao array `imports`).

**Step 4:** `npm run build` → exit 0; `npm test` → 23 (20 + 3 novos).

---

### Task 4: e2e do fluxo de perfil

**Files:** Create `swi-backend/test/profile.e2e-spec.ts` (estilo `test/auth.e2e-spec.ts`; login do worker seedado pra pegar token).

**Step 1 — teste** (fluxo: login worker → GET 404 → PUT subset → GET = subset → PUT outro subset → GET = merge; sem token → 401):

```ts
// Espelha a montagem do app de auth.e2e-spec.ts (Nest app + ValidationPipe).
// worker@swi.local/worker123 é seedado APPROVED+verificado.
it('perfil: 404 → upsert → merge (patch)', async () => {
  const { body } = await request(app.getHttpServer()).post('/auth/login')
    .send({ email: 'worker@swi.local', password: 'worker123' }).expect(200)
  const auth = { Authorization: `Bearer ${body.accessToken}` }

  await request(app.getHttpServer()).get('/profile/me').set(auth).expect(404)
  await request(app.getHttpServer()).put('/profile/me').set(auth).send({ city: 'São Paulo' }).expect(200)
  const g1 = await request(app.getHttpServer()).get('/profile/me').set(auth).expect(200)
  expect(g1.body.city).toBe('São Paulo')
  await request(app.getHttpServer()).put('/profile/me').set(auth).send({ uf: 'SP' }).expect(200)
  const g2 = await request(app.getHttpServer()).get('/profile/me').set(auth).expect(200)
  expect(g2.body.city).toBe('São Paulo')   // merge preservou o campo anterior
  expect(g2.body.uf).toBe('SP')
})

it('perfil sem token → 401', () =>
  request(app.getHttpServer()).get('/profile/me').expect(401))
```

Atenção: o e2e roda contra o Postgres real (db up + `prisma migrate deploy`). O worker seedado pode já ter profile (do seed) → o GET inicial não daria 404. **Limpar o profile do worker no beforeAll** (`prisma.profile.deleteMany({ where: { user: { email: 'worker@swi.local' } } })`), como o auth e2e limpa os usuários de teste.

**Step 2:** `docker compose up -d db` (se preciso) + `npm run test:e2e` → 3 (2 + 1 arquivo novo com 2 casos).

**Step 3 — seed** (`prisma/seed.ts`): após criar o worker, `prisma.profile.upsert` um profile básico pra ele (idempotente). Rodar `npm run prisma:seed` e confirmar sem erro. (O e2e já limpa esse profile no beforeAll, então não conflita.)

---

### Task 5 (mobile): extrair `services/api/http.ts` (refactor puro)

**Files:** Create `mobile/services/api/http.ts` + `.test.ts`. Modify `mobile/services/auth/apiAuthBackend.ts`.

**Step 1 — teste** (`http.test.ts`): fetch mockado + expo-secure-store mockado; asserta método, header `Bearer` quando `auth:true`, e que `!res.ok` lança com `data.message`.

**Step 2:** rodar → FAIL (módulo não existe).

**Step 3 — implementar** `http.ts` extraindo o `req()` do `apiAuthBackend` (assinatura: `apiRequest(path, { method?, body?, auth? })` com `method` default derivado como hoje — `body ? 'POST' : 'GET'` — mas aceitando override explícito pra `PUT`; base `API_URL` de `../auth/apiConfig`; token key `'swi.auth.token'`). Depois refatorar `apiAuthBackend.ts` pra chamar `apiRequest` no lugar do `req()` local (remover o `req` interno). **Comportamento idêntico.**

**Step 4:** `npx jest services/auth services/api` → verde (os testes existentes do auth provam a equivalência do refactor).

---

### Task 6 (mobile): `apiProfileBackend` + despin do selector (TDD)

**Files:** Create `mobile/services/profile/apiProfileBackend.ts` + `.test.ts`. Delete `mobile/services/profile/amplifyProfileBackend.ts`. Modify `getProfileBackend.ts` + `getProfileBackend.test.ts`.

**Step 1 — teste** (`apiProfileBackend.test.ts`): mock do `apiRequest`; casos:
- `get()` chama `GET /profile/me` e devolve o profile com `birthDate` convertido ISO→DD/MM/YYYY;
- `get()` mapeia **404 → null** (apiRequest lança; o backend trata);
- `save({birthDate:'25/12/1990', ...})` envia `PUT /profile/me` com `birthDate:'1990-12-25'` (BR→ISO) e devolve com birthDate BR de volta;
- helpers `brToIso`/`isoToBr` com `undefined` → `undefined`.

**Step 2:** rodar → FAIL.

**Step 3 — implementar** `apiProfileBackend.ts` (usa `apiRequest`; `get()` try/catch mapeando 404→null — seguir o padrão do auth `getCurrentUser`: try→null). Helpers de data puros e exportados pros testes. `birthDate` do backend pode vir como ISO datetime (`1990-12-25T00:00:00.000Z`) — o `isoToBr` deve fatiar os 10 primeiros chars antes de converter.

**Step 4 — despin** `getProfileBackend.ts`:

```ts
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ProfileBackend } from './types';
import { mockProfileBackend } from './mockProfileBackend';
import { apiProfileBackend } from './apiProfileBackend';

export function getProfileBackend(): ProfileBackend {
  return DATA_BACKEND === 'api' ? apiProfileBackend : mockProfileBackend;
}
```

E `getProfileBackend.test.ts`: o caso `'api'` passa a esperar `apiProfileBackend` (imports + asserção). Deletar `amplifyProfileBackend.ts`.

**Step 5:** `npx tsc --noEmit` (8 baseline) + `npx jest` (verde). `git grep "amplifyProfileBackend" -- mobile/` → vazio.

---

### Task 7: docker smoke + tripé + verificação final

**Step 1 — smoke:**
```bash
cd swi-backend && docker compose up --build -d && sleep 6
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}' | grep -o '"accessToken":"[^"]*"' | sed 's/.*:"//;s/"//')
curl -s -o /dev/null -w 'PUT=%{http_code}\n' -X PUT localhost:3000/profile/me -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"city":"São Paulo","uf":"SP","birthDate":"1990-12-25"}'
curl -s localhost:3000/profile/me -H "Authorization: Bearer $TOKEN"
```
Expected: PUT=200; GET devolve `{city:"São Paulo", uf:"SP", birthDate:"1990-12-25T..."}`.

**Step 2 — tripé mobile:** `cd mobile && npx tsc --noEmit` (8) `; npx jest` (verde) `; npx expo export --platform web` (exit 0).

**Step 3 — push + PR** (com luz verde): `git push -u origin feat/backend-perfil` + PR contra `main`.

---

## Fora do escopo (YAGNI)

- Avatar/upload (Fatia 2, MinIO); `user-info` (Fatia 4); health/step-3 (mock permanente).
- Deletar `amplify*Backend.ts` dos outros domínios / dep `aws-amplify` (fim da rodada).
