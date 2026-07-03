# Fatia 7 (Evacuação) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Design: `docs/plans/2026-07-03-swi-backend-fatia7-evacuacao-design.md`.
> **Commits e PR SÓ com luz verde explícita do usuário** ([[Commit only when approved]]) e **SEM rastros de IA** ([[No AI traces]]) — os passos de commit abaixo ficam prontos mas NÃO se executam sem o "pode commitar". Cada unidade é **two-gate** (spec + code-quality reviewer) via subagent-driven.

**Goal:** Ligar o backend real de Evacuação — `GET /evacuation/route` (passthrough OSRM keyless agora / Mapbox em prod, fallback canned) — e migrar o mobile do stub amplify pro cliente REST.

**Architecture:** Módulo Nest novo `swi-backend/src/evacuation/` (provider agnóstico + service com fallback + controller JWT), **sem persistência, sem cron, sem notif**. Mobile: `apiEvacuationBackend` + despin `getEvacuationBackend`, deletar o amplify stub. Seam mobile (`types`/`routeFormat`/`EvacuationProvider`/telas) intocado.

**Tech Stack:** NestJS 10, `fetch` global (Node 20), OSRM público (keyless) / Mapbox Directions, Jest + ts-jest, Supertest (e2e), Docker Compose.

**Baselines a preservar:** backend `build` 0 / `test` verde / `test:e2e` verde; mobile `tsc` **8 (0 novos)** / `jest` verde / `expo export --platform web` 0.

**Comandos (rodar de dentro da app):**
- Backend unit (1 arquivo): `cd swi-backend && npx jest evacuation.provider` · full: `npm test`
- Backend e2e: `cd swi-backend && npm run test:e2e`
- Mobile (1 arquivo): `cd mobile && npx jest services/evacuation/apiEvacuationBackend` · full: `npx jest`

---

## Task 1: Types + rota canned

**Files:**
- Create: `swi-backend/src/evacuation/evacuation.types.ts`

Sem teste próprio (só constantes/tipos; exercitados pelo provider/service specs). Espelha `mobile/services/evacuation/types.ts` + a canned do `mockEvacuationBackend.ts` (paridade exata).

**Step 1: Escrever o arquivo**

```ts
// Espelha o shape do seam mobile services/evacuation/types.ts (siblings isolados).
export interface RouteSnapshot {
  waypoints: [number, number][]   // [lng, lat] (convenção maplibre/GeoJSON)
  durationSec: number
  distanceM: number
  fetchedAt: string               // ISO datetime
}

export interface Directions { waypoints: [number, number][]; durationSec: number; distanceM: number }

// Rota fixa do site (piloto SP) — mesma SITE_ROUTE do seam mobile. [lng, lat].
export const SITE_ROUTE: { origin: [number, number]; destination: [number, number] } = {
  origin: [-46.632, -23.552],
  destination: [-46.62, -23.544],
}

// Rota canned de fallback — paridade EXATA com o mockEvacuationBackend do mobile
// (curva crível, ~23 min / 1500 m do Figma). Servida quando o roteador falha.
export const CANNED_ROUTE: Directions = {
  waypoints: [
    SITE_ROUTE.origin,
    [-46.6295, -23.5505],
    [-46.627, -23.549],
    [-46.6242, -23.5472],
    SITE_ROUTE.destination,
  ],
  durationSec: 1380,
  distanceM: 1500,
}
```

**Step 2: Typecheck** — `cd swi-backend && npx tsc --noEmit -p tsconfig.json` → sem erro novo.

**Step 3: Commit** (com luz verde)
```bash
git add swi-backend/src/evacuation/evacuation.types.ts
git commit -m "feat(backend): tipos + rota canned da fatia evacuacao (paridade c/ mock)"
```

---

## Task 2: RouteProvider + coerção pura (TDD)

**Files:**
- Create: `swi-backend/src/evacuation/evacuation.provider.ts`
- Test: `swi-backend/src/evacuation/evacuation.provider.spec.ts`

Espelha `weather.provider.ts`/`.spec.ts` (coerção pura + seleção de URL + `fetch` mockado).

**Step 1: Escrever o teste que falha**

```ts
import { coerceDirections, RouteProvider } from './evacuation.provider'

const geojson = (coords: [number, number][], duration = 1234, distance = 1600) => ({
  routes: [{ geometry: { coordinates: coords }, duration, distance }],
})

describe('coerceDirections', () => {
  it('mapeia routes[0] → waypoints/duration/distance', () => {
    expect(coerceDirections(geojson([[-46.6, -23.5], [-46.5, -23.4]]))).toEqual({
      waypoints: [[-46.6, -23.5], [-46.5, -23.4]], durationSec: 1234, distanceM: 1600,
    })
  })
  it('lança se routes vazio / geometria ausente', () => {
    expect(() => coerceDirections({ routes: [] })).toThrow()
    expect(() => coerceDirections({ routes: [{ duration: 1, distance: 1 }] })).toThrow()
  })
  it('lança se duration/distance ausentes (não-numéricos)', () =>
    expect(() => coerceDirections({ routes: [{ geometry: { coordinates: [[-46.6, -23.5]] } }] })).toThrow())
})

describe('RouteProvider.fetch (seleção de URL + fetch mockado)', () => {
  const origToken = process.env.MAPBOX_TOKEN
  afterEach(() => { jest.restoreAllMocks(); if (origToken === undefined) delete process.env.MAPBOX_TOKEN; else process.env.MAPBOX_TOKEN = origToken })

  it('sem MAPBOX_TOKEN → OSRM keyless + coerce', async () => {
    delete process.env.MAPBOX_TOKEN
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => geojson([[-46.632, -23.552], [-46.62, -23.544]]) } as any)
    const out = await new RouteProvider().fetch()
    expect(out.waypoints.length).toBe(2)
    const url = spy.mock.calls[0][0] as string
    expect(url).toContain('router.project-osrm.org')
    expect(url).toContain('-46.632,-23.552;-46.62,-23.544')
    expect(url).toContain('geometries=geojson')
  })
  it('com MAPBOX_TOKEN → URL Mapbox walking com token', async () => {
    process.env.MAPBOX_TOKEN = 'pk.test'
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => geojson([[-46.632, -23.552], [-46.62, -23.544]]) } as any)
    await new RouteProvider().fetch()
    const url = spy.mock.calls[0][0] as string
    expect(url).toContain('api.mapbox.com/directions/v5/mapbox/walking')
    expect(url).toContain('access_token=pk.test')
  })
  it('HTTP !ok → lança (caller faz fallback)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as any)
    await expect(new RouteProvider().fetch()).rejects.toThrow()
  })
})
```

**Step 2: Rodar → falha** — `cd swi-backend && npx jest evacuation.provider` → FAIL (módulo não existe).

**Step 3: Implementar o mínimo**

```ts
import { Injectable } from '@nestjs/common'
import { SITE_ROUTE } from './evacuation.types'
import type { Directions } from './evacuation.types'

type LngLat = [number, number]
const isLngLat = (p: any): p is LngLat =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number'

// Coerção PURA de um payload Directions (Mapbox/OSRM, ambos com geometries=geojson)
// → nosso shape. Lança em payload incompleto (EvacuationService trata com canned).
export function coerceDirections(raw: any): Directions {
  const r = raw?.routes?.[0]
  const coords = r?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length === 0 || !coords.every(isLngLat))
    throw new Error('directions: geometria ausente/inválida')
  if (typeof r.duration !== 'number' || typeof r.distance !== 'number')
    throw new Error('directions: duration/distance ausente')
  return { waypoints: coords, durationSec: r.duration, distanceM: r.distance }
}

@Injectable()
export class RouteProvider {
  // Com MAPBOX_TOKEN → Mapbox Directions (walking, premium). Sem token → OSRM
  // público keyless (perfil driving; foot não está no server demo). Mesma coerção.
  async fetch(route = SITE_ROUTE): Promise<Directions> {
    const o = route.origin, d = route.destination
    const coords = `${o[0]},${o[1]};${d[0]},${d[1]}`
    const token = process.env.MAPBOX_TOKEN
    const url = token
      ? `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${token}`
      : `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`directions: HTTP ${res.status}`)
    return coerceDirections(await res.json())
  }
}
```

**Step 4: Rodar → passa** — `npx jest evacuation.provider` → PASS.

**Step 5: Commit** (com luz verde)
```bash
git add swi-backend/src/evacuation/evacuation.provider.ts swi-backend/src/evacuation/evacuation.provider.spec.ts
git commit -m "feat(backend): RouteProvider evacuacao (OSRM keyless / Mapbox por token) + coercao pura"
```

---

## Task 3: EvacuationService + fallback canned (TDD)

**Files:**
- Create: `swi-backend/src/evacuation/evacuation.service.ts`
- Test: `swi-backend/src/evacuation/evacuation.service.spec.ts`

Espelha `weather.service.ts`/`.spec.ts` (provider injetado como stub; real→snapshot, throw→canned+warn).

**Step 1: Escrever o teste que falha**

```ts
import { EvacuationService } from './evacuation.service'
import type { RouteProvider } from './evacuation.provider'
import { CANNED_ROUTE } from './evacuation.types'

const provider = (fetch: RouteProvider['fetch']) => ({ fetch } as RouteProvider)

describe('EvacuationService.getRoute', () => {
  it('provider ok → usa rota real + fetchedAt ISO', async () => {
    const real = { waypoints: [[-46.6, -23.5], [-46.5, -23.4]] as [number, number][], durationSec: 900, distanceM: 1200 }
    const s = await new EvacuationService(provider(async () => real)).getRoute()
    expect(s.waypoints).toEqual(real.waypoints)
    expect(s.durationSec).toBe(900)
    expect(typeof s.fetchedAt).toBe('string')
    expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false)
  })
  it('provider falha → fallback canned (nunca quebra)', async () => {
    const s = await new EvacuationService(provider(async () => { throw new Error('down') })).getRoute()
    expect(s.waypoints).toEqual(CANNED_ROUTE.waypoints)
    expect(s.durationSec).toBe(CANNED_ROUTE.durationSec)
    expect(s.distanceM).toBe(CANNED_ROUTE.distanceM)
  })
})
```

**Step 2: Rodar → falha** — `npx jest evacuation.service` → FAIL.

**Step 3: Implementar o mínimo**

```ts
import { Injectable, Logger } from '@nestjs/common'
import { RouteProvider } from './evacuation.provider'
import { CANNED_ROUTE } from './evacuation.types'
import type { RouteSnapshot } from './evacuation.types'

@Injectable()
export class EvacuationService {
  private readonly logger = new Logger(EvacuationService.name)

  constructor(private readonly provider: RouteProvider) {}

  async getRoute(): Promise<RouteSnapshot> {
    const now = new Date()
    let route = CANNED_ROUTE
    try {
      route = await this.provider.fetch()
    } catch (err) {
      // fallback canned — tela de segurança nunca pode quebrar
      this.logger.warn(`roteador indisponível, servindo rota canned: ${err}`)
    }
    return { waypoints: route.waypoints, durationSec: route.durationSec, distanceM: route.distanceM, fetchedAt: now.toISOString() }
  }
}
```

**Step 4: Rodar → passa** — `npx jest evacuation.service` → PASS.

**Step 5: Commit** (com luz verde)
```bash
git add swi-backend/src/evacuation/evacuation.service.ts swi-backend/src/evacuation/evacuation.service.spec.ts
git commit -m "feat(backend): EvacuationService real->fallback canned (rota nunca quebra)"
```

---

## Task 4: Controller + módulo + wiring + compose + e2e

**Files:**
- Create: `swi-backend/src/evacuation/evacuation.controller.ts`
- Create: `swi-backend/src/evacuation/evacuation.module.ts`
- Create: `swi-backend/test/evacuation.e2e-spec.ts`
- Modify: `swi-backend/src/app.module.ts` (import + imports array)
- Modify: `swi-backend/docker-compose.yml` (env `MAPBOX_TOKEN`)

**Step 1: Controller**
```ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { EvacuationService } from './evacuation.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('evacuation')
@UseGuards(JwtAuthGuard)
export class EvacuationController {
  constructor(private readonly evacuation: EvacuationService) {}

  @Get('route')
  getRoute() {
    return this.evacuation.getRoute()
  }
}
```

**Step 2: Módulo**
```ts
import { Module } from '@nestjs/common'
import { EvacuationController } from './evacuation.controller'
import { EvacuationService } from './evacuation.service'
import { RouteProvider } from './evacuation.provider'

@Module({
  controllers: [EvacuationController],
  providers: [EvacuationService, RouteProvider],
})
export class EvacuationModule {}
```

**Step 3: Wire no `app.module.ts`** — adicionar após a linha do import do `WeatherModule`:
```ts
import { EvacuationModule } from './evacuation/evacuation.module'
```
e no array `imports`, após `WeatherModule,`:
```ts
    ..., NotificationModule, WeatherModule, EvacuationModule,
```

**Step 4: Compose** — em `swi-backend/docker-compose.yml`, no bloco `api.environment` (após `WEATHER_CRON`):
```yaml
      # STACK DEV/DEMO SÓ. Vazio → RouteProvider usa OSRM público (keyless) = rota real no container.
      # PRODUÇÃO (AWS ECS) injeta o token Mapbox do cliente aqui (perfil walking premium).
      MAPBOX_TOKEN: ${MAPBOX_TOKEN:-}
```

**Step 5: e2e** (`test/evacuation.e2e-spec.ts`) — espelha `weather.e2e-spec.ts`:
```ts
// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init().
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Evacuation e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'evac-a@ex.com'
  const cleanup = async () => { await prisma.user.deleteMany({ where: { email } }) }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Evac A', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/evacuation/route').expect(401))

  it('com token → 200 + shape (rota real OU canned)', async () => {
    const t = await login()
    const { body } = await request(app.getHttpServer()).get('/evacuation/route').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(Array.isArray(body.waypoints)).toBe(true)
    expect(body.waypoints.length).toBeGreaterThan(0)
    expect(Array.isArray(body.waypoints[0])).toBe(true)
    expect(typeof body.waypoints[0][0]).toBe('number')
    expect(typeof body.durationSec).toBe('number')
    expect(typeof body.distanceM).toBe('number')
    expect(typeof body.fetchedAt).toBe('string')
  })
})
```

**Step 6: Verificar** — `cd swi-backend && npm run build` (exit 0), `npm test` (verde, +2 suites novas), `npm run test:e2e` (verde, +1 suite; precisa do Postgres vivo — `docker compose up -d db`).

**Step 7: Commit** (com luz verde)
```bash
git add swi-backend/src/evacuation/evacuation.controller.ts swi-backend/src/evacuation/evacuation.module.ts swi-backend/test/evacuation.e2e-spec.ts swi-backend/src/app.module.ts swi-backend/docker-compose.yml
git commit -m "feat(backend): GET /evacuation/route (JWT) + wiring + MAPBOX_TOKEN no compose + e2e"
```

---

## Task 5: Mobile — cliente REST + despin + delete amplify (TDD)

**Files:**
- Create: `mobile/services/evacuation/apiEvacuationBackend.ts`
- Create: `mobile/services/evacuation/apiEvacuationBackend.test.ts`
- Modify: `mobile/services/evacuation/getEvacuationBackend.ts`
- Modify: `mobile/services/evacuation/getEvacuationBackend.test.ts`
- Delete: `mobile/services/evacuation/amplifyEvacuationBackend.ts`

**Step 1: Teste do apiEvacuationBackend (falha)** — espelha `apiWeatherBackend.test.ts`:
```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from '../api/http';
import { apiEvacuationBackend } from './apiEvacuationBackend';

describe('apiEvacuationBackend', () => {
  it('getRoute → GET /evacuation/route autenticado, devolve o snapshot', async () => {
    const snap = { waypoints: [[-46.632, -23.552], [-46.62, -23.544]], durationSec: 1380, distanceM: 1500, fetchedAt: '2026-07-03T00:00:00.000Z' };
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    const out = await apiEvacuationBackend.getRoute();
    expect(apiRequest).toHaveBeenCalledWith('/evacuation/route', { auth: true });
    expect(out).toBe(snap);
  });
});
```

**Step 2: Rodar → falha** — `cd mobile && npx jest services/evacuation/apiEvacuationBackend` → FAIL.

**Step 3: Implementar `apiEvacuationBackend.ts`**
```ts
import type { EvacuationBackend, RouteSnapshot } from './types';
import { apiRequest } from '../api/http';

// Backend devolve o RouteSnapshot pronto (ISO em fetchedAt). Sem args — a rota é
// do site fixo (SITE_ROUTE vive no backend). Espelha apiWeatherBackend.
export const apiEvacuationBackend: EvacuationBackend = {
  getRoute() { return apiRequest<RouteSnapshot>('/evacuation/route', { auth: true }); },
};
```

**Step 4: Rodar → passa.**

**Step 5: Despinar `getEvacuationBackend.ts`**
```ts
import type { EvacuationBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiEvacuationBackend } from './apiEvacuationBackend';
import { mockEvacuationBackend } from './mockEvacuationBackend';

// Fatia Evacuação ligada: honra DATA_BACKEND (mock permanece p/ design review pixel-exato).
export function getEvacuationBackend(): EvacuationBackend {
  return DATA_BACKEND === 'api' ? apiEvacuationBackend : mockEvacuationBackend;
}
```

**Step 6: Atualizar `getEvacuationBackend.test.ts`** — trocar o teste "pinado em mock" pela asserção do switch (espelha `getWeatherBackend.test.ts`). Substituir o corpo inteiro:
```ts
// Fatia Evacuação migrou: o seletor honra DATA_BACKEND (troca o antigo "pinned em mock").
// EVACUATION_SCENARIO entra no factory porque mockEvacuationBackend lê essa flag.
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, EVACUATION_SCENARIO: 'normal' }));
  const { getEvacuationBackend } = require('./getEvacuationBackend');
  const { apiEvacuationBackend } = require('./apiEvacuationBackend');
  const { mockEvacuationBackend } = require('./mockEvacuationBackend');
  return { getEvacuationBackend, apiEvacuationBackend, mockEvacuationBackend };
}

describe('getEvacuationBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getEvacuationBackend, mockEvacuationBackend } = loadWith('mock');
    expect(getEvacuationBackend()).toBe(mockEvacuationBackend);
  });
  it('retorna api com a flag em api', () => {
    const { getEvacuationBackend, apiEvacuationBackend } = loadWith('api');
    expect(getEvacuationBackend()).toBe(apiEvacuationBackend);
  });
});
```

**Step 7: Confirmar 0 refs ao amplify e deletar** — `cd mobile && npx jest services/evacuation` (verde). Confirmar nenhum import de `amplifyEvacuationBackend` fora dele mesmo:
```bash
grep -rn "amplifyEvacuationBackend" mobile/ --include=*.ts --include=*.tsx
```
Esperado: 0 hits (ou só o próprio arquivo). Então:
```bash
git rm mobile/services/evacuation/amplifyEvacuationBackend.ts
```
(NUNCA `rm -rf`; usar `git rm` — restrição do Fact-Forcing Gate.)

**Step 8: Verificar mobile** — `cd mobile && npx tsc --noEmit` (**8 baseline, 0 novos**), `npx jest` (verde), `npx expo export --platform web` (exit 0).

**Step 9: Commit** (com luz verde)
```bash
git add mobile/services/evacuation/apiEvacuationBackend.ts mobile/services/evacuation/apiEvacuationBackend.test.ts mobile/services/evacuation/getEvacuationBackend.ts mobile/services/evacuation/getEvacuationBackend.test.ts
git commit -m "feat(mobile): apiEvacuationBackend (REST) + despin getEvacuationBackend; remove stub amplify"
```

---

## Task 6: Gate full-branch + docker smoke REAL + PR (controller = eu)

Não é subagent — eu (o orquestrador) rodo o gate e o smoke.

**Step 1: Gate full-branch** — reconfirmar TODOS os baselines: backend `build`/`test`/`test:e2e`; mobile `tsc` (8, 0 novos) / `jest` / `expo export`.

**Step 2: Docker smoke REAL** (o que tsc/jest não provam):
```bash
cd swi-backend && docker compose up --build -d      # REBUILD obrigatório (container roda código velho)
# logar como worker (worker@swi.local/worker123 do seed) → pegar accessToken
# GET /evacuation/route com Bearer → esperar waypoints de uma rota OSRM REAL de SP
#   (deve DIFERIR da canned: nº de pontos > 5 e coords ≠ CANNED_ROUTE.waypoints)
# checar log: NÃO deve haver "roteador indisponível" (senão caiu no canned → rede/OSRM off)
docker compose down    # ou deixar de pé se for seguir pro merge
```
Evidência a capturar: status 200, `waypoints.length` real (tipicamente dezenas de pontos com `overview=full`), e ausência do warn de fallback. Se a rede/OSRM estiver fora, documentar que caiu no canned (shape ainda válido) — não é falha do código.

**Step 3: Review holística** — subagent lê o diff inteiro da branch vs `main`: contrato mobile↔backend (RouteSnapshot idêntico, `[lng,lat]`), prod-safety (fallback nunca 5xx; sem token → OSRM, nunca crash), JWT no controller, 0 refs órfãs ao amplify, baselines. READY TO MERGE / 0 Critical.

**Step 4: Finishing-branch + PR** (SÓ com luz verde explícita, SEM rastros de IA):
```bash
git push -u origin feat/backend-evacuacao
```
Corpo do PR em `<scratchpad>/pr-body-evacuacao.md`; usuário abre/mergeia. Verificar `git log origin/main..HEAD | grep -iE 'claude|co-author|generated'` = VAZIO.

**Step 5: Atualizar memória** — `project_swi_aws_backend.md`: Fatia 7 (Evacuação) pushada = **fim do roadmap de domínios não-saúde**.

---

## Pós-plano (fora desta fatia)

- **Deploy-gated real:** token Mapbox (perfil walking premium). Em dev = OSRM keyless.
- **Roadmap de domínios COMPLETO** após esta fatia (Fundação→Perfil→Relatórios→Jornada→Chat→Notif→Clima→**Evacuação**). Próximo horizonte = deploy AWS real (ECS/RDS) + os hard-blocks acumulados (fonte oficial de tempestade, chaves comerciais, push SO, saúde/smartband).
