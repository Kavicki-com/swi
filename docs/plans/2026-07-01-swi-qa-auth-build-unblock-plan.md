# QA Auth Build Unblock — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cortar uma build de QA (APK) que valida o vertical de auth de ponta a ponta contra o backend real via túnel, incluindo admin aprovar/rejeitar.

**Architecture:** Backend NestJS/Prisma ganha descoberta de pendentes + rejeição + throttle + JWT secret via env. Mobile ganha chave própria `AUTH_BACKEND` (auth→real, resto→mock) e um perfil de build `qa`. Um runbook amarra Docker + túnel + `eas build`.

**Tech Stack:** NestJS 10, Prisma 5, Postgres 16, @nestjs/throttler, Expo/EAS, ngrok.

**Baselines a preservar:** mobile `tsc` = 8 erros; mobile `jest` = 111 (vira 112 com o teste novo do seam); backend `jest` unit = 14 (vira 16 com listPending+reject); backend e2e = 1 (vira 2 com o teste pending/reject).

**Regra de commit:** só commitar com luz verde explícita do usuário. Os passos "Commit" abaixo só rodam após esse ok.

---

### Task 0: Criar a branch

**Step 1:** a partir de `feat/mobile-login`, criar `feat/backend-qa-auth-build`.

Run: `git checkout -b feat/backend-qa-auth-build`
Expected: "Switched to a new branch 'feat/backend-qa-auth-build'"

---

### Task 1: `UsersService.listPending()` + `reject()` (TDD)

**Files:**
- Modify: `swi-backend/src/users/users.service.ts`
- Test: `swi-backend/src/users/users.service.spec.ts`

**Step 1: Escrever os testes que falham** — anexar ao `describe('UsersService', ...)`:

```ts
  it('listPending() retorna só os PENDING com campos selecionados', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0) }])
    const r = await new UsersService(db).listPending()
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(r).toHaveLength(1)
  })

  it('reject() vira approvalStatus p/ REJECTED', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'REJECTED' })
    const r = await new UsersService(db).reject('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'REJECTED' } })
    expect(r.approvalStatus).toBe('REJECTED')
  })

  it('reject() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db).reject('nope')).rejects.toBeInstanceOf(NotFoundException)
  })
```

Nota: o helper `prisma()` no topo do arquivo precisa expor `findMany`. Trocar a linha
`const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn() } }) as any`
por
`const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } }) as any`

**Step 2: Rodar e ver falhar**

Run: `cd swi-backend && npx jest users.service`
Expected: FAIL ("listPending is not a function" / "reject is not a function")

**Step 3: Implementar** — em `users.service.ts`, dentro da classe, após `approve`:

```ts
  listPending() {
    return this.prisma.user.findMany({
      where: { approvalStatus: 'PENDING' },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async reject(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u) throw new NotFoundException('Usuário não encontrado')
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'REJECTED' } })
  }
```

**Step 4: Rodar e ver passar**

Run: `cd swi-backend && npx jest users.service`
Expected: PASS (5 testes: approve×2 + listPending + reject×2)

**Step 5: Commit** (após luz verde)

```bash
git add swi-backend/src/users/users.service.ts swi-backend/src/users/users.service.spec.ts
git commit -m "feat(backend): UsersService.listPending + reject (descoberta p/ aprovação)"
```

---

### Task 2: Endpoints `GET /users/pending` + `POST /users/:id/reject` + e2e

**Files:**
- Modify: `swi-backend/src/users/users.controller.ts`
- Test: `swi-backend/test/auth.e2e-spec.ts`

**Step 1: Implementar o controller** — substituir o corpo da classe `UsersController` por:

```ts
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get('pending')
  listPending() { return this.users.listPending() }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string) { const u = await this.users.approve(id); return { id: u.id, approvalStatus: u.approvalStatus } }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/reject') @HttpCode(200)
  async reject(@Param('id') id: string) { const u = await this.users.reject(id); return { id: u.id, approvalStatus: u.approvalStatus } }
```

Adicionar `Get` ao import de `@nestjs/common`:
`import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'`

**Nota de rota:** `@Get('pending')` deve vir declarado **antes** de qualquer `@Get(':id')` — aqui não há `@Get(':id')`, então sem conflito. Manter `pending` como primeiro método é a salvaguarda.

**Step 2: Estender o e2e** — no `auth.e2e-spec.ts`, após o passo que aprova e faz login 200, adicionar um teste que:
1. faz login do admin (`admin@swi.local`/`admin123`) → pega `accessToken`;
2. `GET /users/pending` com `Authorization: Bearer <adminToken>` → 200, array;
3. cadastra um 2º worker, `POST /users/:id/reject` (id vindo do pending) → 200 `{ approvalStatus: 'REJECTED' }`.

Esqueleto (ajustar aos helpers já existentes no arquivo):

```ts
it('admin lista pendentes e rejeita', async () => {
  const admin = await request(app.getHttpServer()).post('/auth/login')
    .send({ email: 'admin@swi.local', password: 'admin123' }).expect(200)
  const token = admin.body.accessToken

  await request(app.getHttpServer()).post('/auth/signup')
    .send({ email: 'reject-me@swi.local', password: 'secret123', name: 'RejectMe' }).expect(201)

  const pending = await request(app.getHttpServer()).get('/users/pending')
    .set('Authorization', `Bearer ${token}`).expect(200)
  const target = pending.body.find((u: any) => u.email === 'reject-me@swi.local')
  expect(target).toBeTruthy()

  const r = await request(app.getHttpServer()).post(`/users/${target.id}/reject`)
    .set('Authorization', `Bearer ${token}`).expect(200)
  expect(r.body.approvalStatus).toBe('REJECTED')
})
```

**Step 3: Rodar o e2e** (Docker/Postgres de pé)

Run: `cd swi-backend && npm run test:e2e`
Expected: PASS (2 testes)

**Step 4: Commit** (após luz verde)

```bash
git add swi-backend/src/users/users.controller.ts swi-backend/test/auth.e2e-spec.ts
git commit -m "feat(backend): GET /users/pending + POST /users/:id/reject (admin) + e2e"
```

---

### Task 3: Throttle leve (`@nestjs/throttler`)

**Files:**
- Modify: `swi-backend/package.json` (dependency)
- Modify: `swi-backend/src/app.module.ts`
- Modify: `swi-backend/src/auth/auth.controller.ts`

**Step 1: Instalar**

Run: `cd swi-backend && npm install @nestjs/throttler@^6`
Expected: adiciona `@nestjs/throttler` às dependencies

**Step 2: Guard global** — reescrever `app.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { HealthController } from './health.controller'

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule, AuthModule, UsersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

**Step 3: Throttle apertado no login** — em `auth.controller.ts`, importar e decorar só o login:

```ts
import { Throttle } from '@nestjs/throttler'
// ...
  @Throttle({ default: { limit: 10, ttl: 60000 } }) @Post('login') @HttpCode(200)
  login(@Body() b: LoginDto) { return this.auth.login(b) }
```

**Step 4: Verificar build + e2e ainda verdes**

Run: `cd swi-backend && npm run build && npm run test:e2e`
Expected: build OK; e2e 2/2 PASS (o fluxo faz < 10 logins/min por IP)

**Step 5: Commit** (após luz verde)

```bash
git add swi-backend/package.json swi-backend/package-lock.json swi-backend/src/app.module.ts swi-backend/src/auth/auth.controller.ts
git commit -m "feat(backend): throttle global + login rate-limit (@nestjs/throttler)"
```

---

### Task 4: JWT secret via `.env` (sem fallback fixo no compose)

**Files:**
- Modify: `swi-backend/docker-compose.yml:27`
- Modify/Create: `swi-backend/.env.example`
- Local (não versionado): `swi-backend/.env`

**Step 1:** trocar a linha do compose
`      JWT_SECRET: dev-secret-change-in-prod`
por
`      JWT_SECRET: ${JWT_SECRET:?defina JWT_SECRET no .env}`

**Step 2:** garantir no `.env.example` (criar se não houver):

```
DATABASE_URL=postgresql://swi:swi@localhost:5432/swi
JWT_SECRET=troque-por-um-segredo-forte-openssl-rand-hex-32
```

**Step 3:** gerar e gravar um segredo real no `.env` local (não versionado):

Run: `cd swi-backend && node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(32).toString('hex'))" >> .env`
Expected: linha `JWT_SECRET=<hex>` anexada ao `.env` (conferir que não duplicou)

**Step 4:** validar que o compose exige o env

Run: `cd swi-backend && docker compose config >/dev/null && echo OK`
Expected: `OK` (com `.env` presente); se faltar JWT_SECRET, erro explícito.

**Step 5: Commit** (após luz verde — `.env` fica fora)

```bash
git add swi-backend/docker-compose.yml swi-backend/.env.example
git commit -m "chore(backend): JWT_SECRET obrigatório via .env (sem fallback fixo no compose)"
```

---

### Task 5: Seam do mobile — chave própria `AUTH_BACKEND` (TDD)

**Files:**
- Modify: `mobile/lib/featureFlags.ts`
- Modify: `mobile/services/auth/getAuthBackend.ts`
- Test: `mobile/services/auth/getAuthBackend.test.ts`

**Step 1: Reescrever o teste** (`getAuthBackend.test.ts`) pra cobrir os dois ramos:

```ts
jest.mock('expo-secure-store', () => ({}));

function loadWith(authBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ AUTH_BACKEND: authBackend, DATA_BACKEND: 'mock' }));
  const { getAuthBackend } = require('./getAuthBackend');
  const { mockAuthBackend } = require('./mockAuthBackend');
  const { apiAuthBackend } = require('./apiAuthBackend');
  return { getAuthBackend, mockAuthBackend, apiAuthBackend };
}

it('returns the mock backend when AUTH_BACKEND is mock', () => {
  const { getAuthBackend, mockAuthBackend } = loadWith('mock');
  expect(getAuthBackend()).toBe(mockAuthBackend);
});

it('returns the api backend when AUTH_BACKEND is api', () => {
  const { getAuthBackend, apiAuthBackend } = loadWith('api');
  expect(getAuthBackend()).toBe(apiAuthBackend);
});
```

**Step 2: Rodar e ver falhar**

Run: `cd mobile && npx jest getAuthBackend`
Expected: FAIL (o `getAuthBackend` atual lê `DATA_BACKEND`, não `AUTH_BACKEND`)

**Step 3: Implementar**

Em `featureFlags.ts`, após o bloco de `DATA_BACKEND`, adicionar:

```ts
// Chave PRÓPRIA do auth, independente de DATA_BACKEND: permite o auth ir no
// backend real (container) enquanto os outros 9 domínios seguem em mock.
// 'api' seleciona apiAuthBackend; default 'mock'. Setada no build via
// EXPO_PUBLIC_AUTH_BACKEND (ver eas.json perfil `qa`).
export type AuthBackendKind = 'mock' | 'api';
export const AUTH_BACKEND: AuthBackendKind =
  (process.env.EXPO_PUBLIC_AUTH_BACKEND as AuthBackendKind) ?? 'mock';
```

Em `getAuthBackend.ts`, trocar o corpo:

```ts
import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { AuthBackend } from './types';
import { mockAuthBackend } from './mockAuthBackend';
import { apiAuthBackend } from './apiAuthBackend';

export function getAuthBackend(): AuthBackend {
  return AUTH_BACKEND === 'api' ? apiAuthBackend : mockAuthBackend;
}
```

**Step 4: Rodar e ver passar**

Run: `cd mobile && npx jest getAuthBackend`
Expected: PASS (2 testes)

**Step 5: Commit** (após luz verde)

```bash
git add mobile/lib/featureFlags.ts mobile/services/auth/getAuthBackend.ts mobile/services/auth/getAuthBackend.test.ts
git commit -m "feat(mobile): AUTH_BACKEND — chave própria do auth (real) sem afetar os outros domínios"
```

---

### Task 6: Perfil de build `qa` (`mobile/eas.json`)

**Files:**
- Modify: `mobile/eas.json`

**Step 1:** adicionar o perfil `qa` dentro de `"build"` (após `preview`), com a URL do túnel como placeholder a preencher:

```json
    "qa": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "ios": { "simulator": false },
      "env": {
        "EXPO_PUBLIC_AUTH_BACKEND": "api",
        "EXPO_PUBLIC_API_URL": "https://REPLACE-WITH-STATIC-TUNNEL.ngrok-free.app"
      }
    },
```

**Step 2:** validar JSON

Run: `cd mobile && node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8')); console.log('ok')"`
Expected: `ok`

**Step 3: Commit** (após luz verde)

```bash
git add mobile/eas.json
git commit -m "chore(mobile): perfil de build qa (APK, auth→api, URL do túnel)"
```

---

### Task 7: Runbook

**Files:**
- Create: `docs/runbooks/2026-07-01-qa-auth-build.md`

**Step 1:** escrever o runbook com:
- **Dev:** (1) `cd swi-backend && docker compose up -d`; (2) túnel API estável `ngrok http 3000 --domain=<estático>.ngrok-free.app`; (3) túnel MailHog `ngrok http 8025` (ou cloudflared); (4) gravar a URL estática no `eas.json` perfil `qa`; (5) `cd mobile && eas build --profile qa --platform android`; (6) distribuir o link do APK ao QA.
- **QA:** instalar APK; credenciais seedadas (`worker@swi.local`/`worker123` aprovado; `admin@swi.local`/`admin123`); testar signup → abrir a URL do MailHog pra ler o código → confirmar → login → gate → reset; admin: login → `GET /users/pending` → `POST /users/:id/approve|reject`.
- **Troubleshooting:** túnel caiu / URL trocou (rebuild ou domínio estático), `docker compose logs api`, seed re-run.

**Step 2: Commit** (após luz verde)

```bash
git add docs/runbooks/2026-07-01-qa-auth-build.md docs/plans/2026-07-01-swi-qa-auth-build-unblock-*.md
git commit -m "docs: runbook da build de QA do auth + design/plano da fatia"
```

---

### Task 8: Verificação final (a tríade + docker smoke + smoke pelo túnel)

**Backend:**
- `cd swi-backend && npm run build` → sem erro
- `npx jest` → 16 unit PASS
- `npm run test:e2e` → 2 PASS
- **Docker smoke:** `docker compose up --build -d`; então:
  - `curl -s localhost:3000/health` → `{"status":"ok"}`
  - login worker seedado → 200 + accessToken
  - login admin → pega token; `GET /users/pending` com Bearer → 200
  - signup novo → 201; ver e-mail no MailHog (`localhost:8025/api/v2/messages`)
- **Smoke pelo túnel:** com o `ngrok http 3000` de pé, `curl -s https://<estático>.ngrok-free.app/health` → `{"status":"ok"}` (prova o atravessamento de fora).

**Mobile:**
- `cd mobile && npx tsc --noEmit` → 8 erros (baseline, 0 novos)
- `npx jest` → 112 PASS
- `npx expo export --platform web` → exit 0 (parar o container `api` antes se faltar memória: `docker compose stop api`)

**Nenhum commit aqui** — é verificação. Se algo falhar, voltar à task correspondente.

---

## Ordem e dependências
- Task 0 primeiro. Tasks 1→2 em sequência (2 usa 1). Tasks 3, 4, 5, 6, 7 são independentes entre si. Task 8 por último.
- Tasks 2 e 8 (e2e/docker smoke) exigem **Docker Desktop de pé**.

## O que precisa de você (fora do código)
- Conta ngrok (domínio estático) e rodar os túneis.
- Conta Expo/EAS e rodar `eas build --profile qa`.
- Os comandos exatos estão no runbook (Task 7).
