# Fatia 6 (Clima) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) para implementar task-a-task. Cada task é TDD: teste falha → código mínimo → teste passa → commit.

**Goal:** Ligar o domínio Clima do backend container — `GET /weather` (números reais via Open-Meteo, fallback canned) + gatilho `clima → notif` (cron + dedup) — e trocar o stub `amplifyWeatherBackend` do mobile por `apiWeatherBackend`.

**Architecture:** `WeatherModule` (NestJS) com `OpenMeteoProvider` (fetch sem chave + coerção pura), `WeatherService` (fallback canned + alerta por flag `WEATHER_SCENARIO`), `WeatherController` (`GET /weather` JWT), e `WeatherAlertService` (`@Cron` 30min → alerta novo → `NotificationService.createForMany` a todos os workers aprovados, deduplicado por 1 tabela `WeatherAlertSeen`). Mobile só ganha o cliente REST + despin do seletor.

**Tech Stack:** NestJS 10, Prisma 5 (Postgres), `@nestjs/schedule` (nova dep), `fetch` global do Node 20, Jest/supertest/socket.io-client (e2e), Expo/React Native (mobile), Docker Compose.

**Design:** `docs/plans/2026-07-03-swi-backend-fatia6-clima-design.md`.

**Branch:** `feat/backend-clima` (já criada de `origin/main`, design doc já commitado em `fbff6bd`).

---

## Baselines (têm que continuar batendo no gate final)

- **Backend** (`cd swi-backend`): `npm run build` exit 0 · `npm test` verde (72 → ~+10) · `npm run test:e2e` verde (29 → +2).
- **Mobile** (`cd mobile`): `npx tsc --noEmit` **8 erros = baseline** (0 novos) · `npx jest` verde (170 net: +2 apiWeather, ±0 no getWeather) · `npx expo export --platform web` exit 0.
- **Docker smoke REAL obrigatório** no fim (o container roda código velho — rebuild).
- **Sem rastros de IA** em nenhum commit. Commit/PR **só com luz verde explícita**.

**Windows:** usar Git Bash pro `&&`. Prisma na host precisa de `DATABASE_URL` inline (o container tem via compose).

---

### Task 1: Types + provider Open-Meteo (coerção pura + fetch com fallback)

**Files:**
- Create: `swi-backend/src/weather/weather.types.ts`
- Create: `swi-backend/src/weather/weather.provider.ts`
- Test: `swi-backend/src/weather/weather.provider.spec.ts`

**Step 1: Escreva os types (sem lógica, sem teste).**

`swi-backend/src/weather/weather.types.ts`:
```ts
// Espelha o shape do seam mobile services/weather/types.ts (siblings isolados).
export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog'
export interface WeatherCurrent { tempC: number; condition: WeatherCondition; humidityPct: number; windKmh: number }
export interface WeatherDaily { minC: number; maxC: number }
export interface WeatherAlert { id: string; event: string; description: string; startsAt: string; endsAt: string }
export interface WeatherSnapshot { current: WeatherCurrent; daily: WeatherDaily; alerts: WeatherAlert[]; fetchedAt: string }

// Local fixo da obra (piloto SP) — mesmo centroide do SITE_LOCATION do mobile.
export const SITE_LOCATION = { lat: -23.55, lng: -46.63 }

// Números canned de fallback (paridade EXATA com o mockWeatherBackend do mobile).
export const CANNED_CURRENT: WeatherCurrent = { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 }
export const CANNED_DAILY: WeatherDaily = { minC: 19, maxC: 32 }
```

**Step 2: Escreva o teste que falha** — `swi-backend/src/weather/weather.provider.spec.ts`:
```ts
import { mapWeatherCode, coerceOpenMeteo, OpenMeteoProvider } from './weather.provider'

describe('mapWeatherCode (WMO → enum)', () => {
  it.each([[0, 'clear'], [2, 'clouds'], [45, 'fog'], [63, 'rain'], [81, 'rain'], [75, 'snow'], [95, 'storm']] as const)(
    'code %i → %s', (code, cond) => expect(mapWeatherCode(code)).toBe(cond),
  )
})

describe('coerceOpenMeteo', () => {
  const raw = {
    current: { temperature_2m: 21.6, relative_humidity_2m: 70.2, wind_speed_10m: 12.4, weather_code: 63 },
    daily: { temperature_2m_max: [28.1], temperature_2m_min: [18.9] },
  }
  it('mapeia + arredonda', () => {
    expect(coerceOpenMeteo(raw)).toEqual({
      current: { tempC: 22, condition: 'rain', humidityPct: 70, windKmh: 12 },
      daily: { maxC: 28, minC: 19 },
    })
  })
  it('lança se faltar current/daily', () => expect(() => coerceOpenMeteo({})).toThrow())
  it('lança se número essencial ausente', () =>
    expect(() => coerceOpenMeteo({ current: {}, daily: { temperature_2m_max: [1], temperature_2m_min: [1] } })).toThrow())
})

describe('OpenMeteoProvider.fetch', () => {
  afterEach(() => jest.restoreAllMocks())
  it('HTTP ok → coerce', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 65, weather_code: 63 },
        daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
      }),
    } as any)
    expect((await new OpenMeteoProvider().fetch()).current.tempC).toBe(17)
  })
  it('HTTP !ok → lança (caller faz fallback)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as any)
    await expect(new OpenMeteoProvider().fetch()).rejects.toThrow()
  })
})
```

**Step 3: Rode e veja falhar.** `cd swi-backend && npx jest src/weather/weather.provider.spec.ts` → FAIL (`Cannot find module './weather.provider'`).

**Step 4: Implemente** — `swi-backend/src/weather/weather.provider.ts`:
```ts
import { Injectable } from '@nestjs/common'
import type { WeatherCondition, WeatherCurrent, WeatherDaily } from './weather.types'
import { SITE_LOCATION } from './weather.types'

// Códigos WMO (Open-Meteo): 0 limpo · 1-3 nuvens · 45/48 névoa · 51-67 e 80-82
// chuva · 71-77 e 85-86 neve · 95-99 tempestade. Desconhecido → 'clouds' (neutro).
export function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code <= 3) return 'clouds'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return 'clouds'
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) throw new Error('open-meteo: número ausente/inválido')
  return n
}

// Coerção PURA payload Open-Meteo → nosso shape. Lança em payload incompleto
// (o WeatherService trata com fallback canned).
export function coerceOpenMeteo(raw: any): { current: WeatherCurrent; daily: WeatherDaily } {
  const c = raw?.current, d = raw?.daily
  if (!c || !d) throw new Error('open-meteo: payload sem current/daily')
  return {
    current: {
      tempC: Math.round(num(c.temperature_2m)),
      condition: mapWeatherCode(num(c.weather_code)),
      humidityPct: Math.round(num(c.relative_humidity_2m)),
      windKmh: Math.round(num(c.wind_speed_10m)),
    },
    daily: { maxC: Math.round(num(d.temperature_2m_max?.[0])), minC: Math.round(num(d.temperature_2m_min?.[0])) },
  }
}

@Injectable()
export class OpenMeteoProvider {
  // Sem chave. Unidades default do Open-Meteo já batem: °C, %, km/h.
  async fetch(loc = SITE_LOCATION): Promise<{ current: WeatherCurrent; daily: WeatherDaily }> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`)
    return coerceOpenMeteo(await res.json())
  }
}
```

**Step 5: Rode e veja passar.** `npx jest src/weather/weather.provider.spec.ts` → PASS.

**Step 6: Commit.**
```bash
git add swi-backend/src/weather/weather.types.ts swi-backend/src/weather/weather.provider.ts swi-backend/src/weather/weather.provider.spec.ts
git commit -m "feat(backend): OpenMeteoProvider (fetch sem chave + coercao WMO) + types de clima"
```

---

### Task 2: WeatherService (fallback canned + alerta por cenário)

**Files:**
- Create: `swi-backend/src/weather/weather.service.ts`
- Test: `swi-backend/src/weather/weather.service.spec.ts`

**Step 1: Teste que falha** — `swi-backend/src/weather/weather.service.spec.ts`:
```ts
import { WeatherService } from './weather.service'
import type { OpenMeteoProvider } from './weather.provider'
import { CANNED_CURRENT } from './weather.types'

const provider = (fetch: OpenMeteoProvider['fetch']) => ({ fetch } as OpenMeteoProvider)

describe('WeatherService.getSnapshot', () => {
  const orig = process.env.WEATHER_SCENARIO
  afterEach(() => { if (orig === undefined) delete process.env.WEATHER_SCENARIO; else process.env.WEATHER_SCENARIO = orig })

  it('provider ok → usa dado real', async () => {
    const svc = new WeatherService(provider(async () => ({ current: { tempC: 22, condition: 'clear', humidityPct: 50, windKmh: 10 }, daily: { minC: 15, maxC: 25 } })))
    expect((await svc.getSnapshot()).current.tempC).toBe(22)
  })
  it('provider falha → fallback canned (nunca quebra)', async () => {
    const svc = new WeatherService(provider(async () => { throw new Error('down') }))
    expect((await svc.getSnapshot()).current).toEqual(CANNED_CURRENT)
  })
  it('WEATHER_SCENARIO=alert → 1 alerta vigente (endsAt no futuro)', async () => {
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await new WeatherService(provider(async () => { throw new Error('x') })).getSnapshot()
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0].id).toBe('wx-0')
    expect(new Date(s.alerts[0].endsAt).getTime()).toBeGreaterThan(Date.now())
  })
  it('WEATHER_SCENARIO=normal → sem alerta (prod não fabrica)', async () => {
    process.env.WEATHER_SCENARIO = 'normal'
    expect((await new WeatherService(provider(async () => { throw new Error('x') })).getSnapshot()).alerts).toHaveLength(0)
  })
})
```

**Step 2: Rode e veja falhar.** `npx jest src/weather/weather.service.spec.ts` → FAIL.

**Step 3: Implemente** — `swi-backend/src/weather/weather.service.ts`:
```ts
import { Injectable } from '@nestjs/common'
import { OpenMeteoProvider } from './weather.provider'
import { CANNED_CURRENT, CANNED_DAILY } from './weather.types'
import type { WeatherAlert, WeatherSnapshot } from './weather.types'

const STORM_DESC =
  'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.'

// Alerta canned de demo (paridade com o mockWeatherBackend). Id 'wx-0' estável
// pro dedup do cron; startsAt/endsAt na hora → alerta SEMPRE vigente.
function stormAlert(now: Date): WeatherAlert {
  return {
    id: 'wx-0',
    event: 'Tempestade severa',
    description: STORM_DESC,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
}

@Injectable()
export class WeatherService {
  constructor(private readonly provider: OpenMeteoProvider) {}

  async getSnapshot(): Promise<WeatherSnapshot> {
    const now = new Date()
    let current = CANNED_CURRENT, daily = CANNED_DAILY
    try {
      const real = await this.provider.fetch()
      current = real.current; daily = real.daily
    } catch {
      // fallback canned — tela de segurança nunca pode quebrar
    }
    return { current, daily, alerts: this.alerts(now), fetchedAt: now.toISOString() }
  }

  // Alerta: dev via WEATHER_SCENARIO='alert'; prod → fonte real (ainda não
  // configurada = []). NUNCA fabrica alerta sem flag/fonte.
  private alerts(now: Date): WeatherAlert[] {
    return process.env.WEATHER_SCENARIO === 'alert' ? [stormAlert(now)] : []
  }
}
```

**Step 4: Rode e veja passar.** `npx jest src/weather/weather.service.spec.ts` → PASS.

**Step 5: Commit.**
```bash
git add swi-backend/src/weather/weather.service.ts swi-backend/src/weather/weather.service.spec.ts
git commit -m "feat(backend): WeatherService (fallback canned + alerta por WEATHER_SCENARIO)"
```

---

### Task 3: Controller + módulo + registro no app + e2e

**Files:**
- Create: `swi-backend/src/weather/weather.controller.ts`
- Create: `swi-backend/src/weather/weather.module.ts`
- Modify: `swi-backend/src/app.module.ts` (add `WeatherModule` — `ScheduleModule` entra na Task 5)
- Test: `swi-backend/test/weather.e2e-spec.ts`

**Step 1: Controller** — `swi-backend/src/weather/weather.controller.ts`:
```ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  get() {
    return this.weather.getSnapshot()
  }
}
```

**Step 2: Módulo (sem AlertService ainda — vem na Task 5)** — `swi-backend/src/weather/weather.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { WeatherController } from './weather.controller'
import { OpenMeteoProvider } from './weather.provider'

@Module({
  controllers: [WeatherController],
  providers: [WeatherService, OpenMeteoProvider],
})
export class WeatherModule {}
```

**Step 3: Registre no app** — `swi-backend/src/app.module.ts`: adicione o import e inclua `WeatherModule` no array `imports` (ao lado de `NotificationModule`):
```ts
import { WeatherModule } from './weather/weather.module'
// ... no imports: [...]:  ChatModule, RealtimeModule, NotificationModule, WeatherModule,
```

**Step 4: e2e que falha** — `swi-backend/test/weather.e2e-spec.ts`:
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

describe('Weather e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'weather-a@ex.com'
  const cleanup = async () => { await prisma.user.deleteMany({ where: { email } }) }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email, name: 'Weather A', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/weather').expect(401))

  it('com token → 200 + shape (dado real OU fallback canned)', async () => {
    const t = await login()
    const { body } = await request(app.getHttpServer()).get('/weather').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(typeof body.current.tempC).toBe('number')
    expect(typeof body.daily.maxC).toBe('number')
    expect(Array.isArray(body.alerts)).toBe(true)
    expect(typeof body.fetchedAt).toBe('string')
  })
})
```
> Nota: o e2e tolera rede off (o `getSnapshot` cai no fallback canned → shape continua válido); só assere shape, não valores.

**Step 5: Rode.** Precisa do Postgres de pé (`docker compose up -d db`). Depois:
```bash
cd swi-backend && npm run test:e2e -- weather.e2e-spec.ts
```
Expected: PASS (2 testes). Se falhar por build antes: `npm run build` pra pegar erro de tipo.

**Step 6: Commit.**
```bash
git add swi-backend/src/weather/weather.controller.ts swi-backend/src/weather/weather.module.ts swi-backend/src/app.module.ts swi-backend/test/weather.e2e-spec.ts
git commit -m "feat(backend): GET /weather (JWT) + WeatherModule + e2e"
```

---

### Task 4: Migração `WeatherAlertSeen` + pré-seed do id de demo

**Files:**
- Modify: `swi-backend/prisma/schema.prisma` (append model)
- Create: `swi-backend/prisma/migrations/<timestamp>_weather_alert_seen/migration.sql` (gerado)
- Modify: `swi-backend/prisma/seed.ts` (pré-seed idempotente)

**Step 1: Adicione o model** ao fim de `swi-backend/prisma/schema.prisma`:
```prisma
// Dedup do gatilho clima→notif: registra os alertas já notificados (o cron
// veria o mesmo alerta a cada tick → sem isto = spam). Único estado da fatia
// Clima (o clima em si é passthrough, sem persistência).
model WeatherAlertSeen {
  alertId    String   @id
  notifiedAt DateTime @default(now())
}
```

**Step 2: Gere a migração + client** (Postgres de pé). Na host, com `DATABASE_URL` inline:
```bash
cd swi-backend
DATABASE_URL=postgresql://swi:swi@localhost:5432/swi npx prisma migrate dev --name weather_alert_seen
```
Expected: cria a pasta de migração + roda + `prisma generate` (agora `prisma.weatherAlertSeen` existe no client TS).

**Step 3: Pré-seed** — em `swi-backend/prisma/seed.ts`, perto de onde as notificações do worker são semeadas (Fatia 5), adicione (idempotente):
```ts
// Pré-marca o alerta de demo (wx-0) como já notificado → o cron NÃO duplica a
// notificação 'weather' que este seed já cria. O smoke prova o gatilho ao vivo
// com um id fresco / truncando WeatherAlertSeen.
await prisma.weatherAlertSeen.upsert({ where: { alertId: 'wx-0' }, update: {}, create: { alertId: 'wx-0' } })
```

**Step 4: Rode o seed** e confirme idempotência:
```bash
DATABASE_URL=postgresql://swi:swi@localhost:5432/swi npm run prisma:seed   # 2x — sem erro
```

**Step 5: Commit.**
```bash
git add swi-backend/prisma/schema.prisma swi-backend/prisma/migrations swi-backend/prisma/seed.ts
git commit -m "feat(backend): model WeatherAlertSeen (dedup clima) + pre-seed do alerta de demo"
```

---

### Task 5: `clima → notif` — cron + dedup (WeatherAlertService)

**Files:**
- Add dep: `@nestjs/schedule`
- Create: `swi-backend/src/weather/weather-alert.service.ts`
- Test: `swi-backend/src/weather/weather-alert.service.spec.ts`
- Modify: `swi-backend/src/weather/weather.module.ts` (import `NotificationModule` + provide `WeatherAlertService`)
- Modify: `swi-backend/src/app.module.ts` (`ScheduleModule.forRoot()`)
- Modify: `swi-backend/docker-compose.yml` (env `WEATHER_SCENARIO`/`WEATHER_CRON`)

**Step 1: Instale a dep.**
```bash
cd swi-backend && npm install @nestjs/schedule
```

**Step 2: Teste que falha** — `swi-backend/src/weather/weather-alert.service.spec.ts`:
```ts
import { WeatherAlertService } from './weather-alert.service'

const snap = { alerts: [{ id: 'wx-9', event: 'Tempestade severa', description: 'x', startsAt: '', endsAt: '' }] }

function mk(seen: boolean) {
  const createForMany = jest.fn().mockResolvedValue([])
  const prisma = {
    weatherAlertSeen: { findUnique: jest.fn().mockResolvedValue(seen ? { alertId: 'wx-9' } : null), create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
  }
  const weather = { getSnapshot: jest.fn().mockResolvedValue(snap) }
  const svc = new WeatherAlertService(weather as any, prisma as any, { createForMany } as any)
  return { svc, createForMany, prisma }
}

describe('WeatherAlertService.pollAndNotify', () => {
  it('alerta novo → notifica todos os aprovados + grava seen', async () => {
    const { svc, createForMany, prisma } = mk(false)
    await svc.pollAndNotify()
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { role: 'WORKER', approvalStatus: 'APPROVED' }, select: { id: true } })
    expect(createForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ domain: 'weather', title: 'Alerta meteorológico', targetId: 'wx-9' }))
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({ data: { alertId: 'wx-9' } })
  })
  it('alerta já visto → dedup (não notifica, não grava)', async () => {
    const { svc, createForMany, prisma } = mk(true)
    await svc.pollAndNotify()
    expect(createForMany).not.toHaveBeenCalled()
    expect(prisma.weatherAlertSeen.create).not.toHaveBeenCalled()
  })
  it('erro no poll → swallow (best-effort, não relança)', async () => {
    const weather = { getSnapshot: jest.fn().mockRejectedValue(new Error('boom')) }
    const svc = new WeatherAlertService(weather as any, {} as any, {} as any)
    await expect(svc.pollAndNotify()).resolves.toBeUndefined()
  })
})
```

**Step 3: Rode e veja falhar.** `npx jest src/weather/weather-alert.service.spec.ts` → FAIL.

**Step 4: Implemente** — `swi-backend/src/weather/weather-alert.service.ts`:
```ts
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationService } from '../notifications/notification.service'
import { WeatherService } from './weather.service'

@Injectable()
export class WeatherAlertService {
  constructor(
    private readonly weather: WeatherService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Default 30min; override via WEATHER_CRON (|| pra tratar '' como ausente).
  @Cron(process.env.WEATHER_CRON || CronExpression.EVERY_30_MINUTES)
  async pollAndNotify(): Promise<void> {
    try {
      const snap = await this.weather.getSnapshot()
      for (const alert of snap.alerts) {
        const seen = await this.prisma.weatherAlertSeen.findUnique({ where: { alertId: alert.id } })
        if (seen) continue
        const workers = await this.prisma.user.findMany({
          where: { role: 'WORKER', approvalStatus: 'APPROVED' },
          select: { id: true },
        })
        await this.notifications.createForMany(workers.map((w) => w.id), {
          domain: 'weather',
          title: 'Alerta meteorológico',
          body: alert.event,
          targetId: alert.id,
        })
        await this.prisma.weatherAlertSeen.create({ data: { alertId: alert.id } })
      }
    } catch {
      // best-effort: falha de poll nunca derruba o app
    }
  }
}
```

**Step 5: Rode e veja passar.** `npx jest src/weather/weather-alert.service.spec.ts` → PASS.

**Step 6: Ligue no módulo** — `swi-backend/src/weather/weather.module.ts` (agora com Notification + AlertService):
```ts
import { Module } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { WeatherController } from './weather.controller'
import { OpenMeteoProvider } from './weather.provider'
import { WeatherAlertService } from './weather-alert.service'
import { NotificationModule } from '../notifications/notification.module'

@Module({
  imports: [NotificationModule],
  controllers: [WeatherController],
  providers: [WeatherService, OpenMeteoProvider, WeatherAlertService],
})
export class WeatherModule {}
```

**Step 7: Ative o scheduler** — `swi-backend/src/app.module.ts`: `import { ScheduleModule } from '@nestjs/schedule'` e adicione `ScheduleModule.forRoot()` no início do array `imports`.

**Step 8: Env no compose** — `swi-backend/docker-compose.yml`, no `environment:` do serviço `api`:
```yaml
      WEATHER_SCENARIO: ${WEATHER_SCENARIO:-alert}   # dev = tempestade (Figma); prod unset
      WEATHER_CRON: ${WEATHER_CRON:-}                # vazio → default 30min no código
```

**Step 9: Build + suite backend inteira** (garante que o Schedule/DI casa):
```bash
cd swi-backend && npm run build && npm test
```
Expected: build exit 0, unit verde.

**Step 10: Commit.**
```bash
git add swi-backend/src/weather/weather-alert.service.ts swi-backend/src/weather/weather-alert.service.spec.ts swi-backend/src/weather/weather.module.ts swi-backend/src/app.module.ts swi-backend/docker-compose.yml swi-backend/package.json swi-backend/package-lock.json
git commit -m "feat(backend): clima->notif via cron + dedup (WeatherAlertService) + @nestjs/schedule"
```

---

### Task 6: Mobile — cliente REST + despin + deletar amplify

**Files:**
- Create: `mobile/services/weather/apiWeatherBackend.ts`
- Create: `mobile/services/weather/apiWeatherBackend.test.ts`
- Modify: `mobile/services/weather/getWeatherBackend.ts`
- Modify: `mobile/services/weather/getWeatherBackend.test.ts`
- Delete: `mobile/services/weather/amplifyWeatherBackend.ts`

**Step 1: Cliente REST** — `mobile/services/weather/apiWeatherBackend.ts`:
```ts
import type { WeatherBackend, WeatherSnapshot } from './types';
import { apiRequest } from '../api/http';

// Backend devolve o WeatherSnapshot pronto (ISO nas datas). Sem args — o clima
// é do local fixo da obra (SITE_LOCATION vive no backend). Espelha apiNotificationBackend.
export const apiWeatherBackend: WeatherBackend = {
  getWeather() { return apiRequest<WeatherSnapshot>('/weather', { auth: true }); },
};
```

**Step 2: Teste do cliente** — `mobile/services/weather/apiWeatherBackend.test.ts`:
```ts
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
import { apiRequest } from '../api/http';
import { apiWeatherBackend } from './apiWeatherBackend';

describe('apiWeatherBackend', () => {
  it('getWeather → GET /weather autenticado, devolve o snapshot', async () => {
    const snap = { current: { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 }, daily: { minC: 19, maxC: 32 }, alerts: [], fetchedAt: '2026-07-03T00:00:00.000Z' };
    (apiRequest as jest.Mock).mockResolvedValue(snap);
    const out = await apiWeatherBackend.getWeather();
    expect(apiRequest).toHaveBeenCalledWith('/weather', { auth: true });
    expect(out).toBe(snap);
  });
});
```

**Step 3: Rode e veja passar** (cliente já existe do Step 1): `cd mobile && npx jest services/weather/apiWeatherBackend.test.ts` → PASS.

**Step 4: Despin do seletor** — reescreva `mobile/services/weather/getWeatherBackend.ts`:
```ts
import type { WeatherBackend } from './types';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiWeatherBackend } from './apiWeatherBackend';
import { mockWeatherBackend } from './mockWeatherBackend';

// Fatia Clima ligada: honra DATA_BACKEND (mock permanece p/ design review pixel-exato).
export function getWeatherBackend(): WeatherBackend {
  return DATA_BACKEND === 'api' ? apiWeatherBackend : mockWeatherBackend;
}
```

**Step 5: Atualize o teste do seletor** — reescreva `mobile/services/weather/getWeatherBackend.test.ts`:
```ts
// Fatia Clima migrou: o seletor honra DATA_BACKEND (troca o antigo "pinned em mock").
function loadWith(dataBackend: 'mock' | 'api') {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: dataBackend, WEATHER_SCENARIO: 'alert' }));
  const { getWeatherBackend } = require('./getWeatherBackend');
  const { apiWeatherBackend } = require('./apiWeatherBackend');
  const { mockWeatherBackend } = require('./mockWeatherBackend');
  return { getWeatherBackend, apiWeatherBackend, mockWeatherBackend };
}

describe('getWeatherBackend', () => {
  it('retorna mock com a flag em mock', () => {
    const { getWeatherBackend, mockWeatherBackend } = loadWith('mock');
    expect(getWeatherBackend()).toBe(mockWeatherBackend);
  });
  it('retorna api com a flag em api', () => {
    const { getWeatherBackend, apiWeatherBackend } = loadWith('api');
    expect(getWeatherBackend()).toBe(apiWeatherBackend);
  });
});
```

**Step 6: Delete o stub Amplify.**
```bash
cd mobile && git rm services/weather/amplifyWeatherBackend.ts
```

**Step 7: Rode o que muda + confirme sem novos erros de tipo.**
```bash
cd mobile
npx jest services/weather/
npx tsc --noEmit    # tem que continuar 8 erros baseline (0 novos)
```
Expected: jest verde; tsc = 8 (mesmos de sempre — dashboard/map/three).

**Step 8: Commit.**
```bash
git add mobile/services/weather/apiWeatherBackend.ts mobile/services/weather/apiWeatherBackend.test.ts mobile/services/weather/getWeatherBackend.ts mobile/services/weather/getWeatherBackend.test.ts
git commit -m "feat(mobile): apiWeatherBackend (REST) + despin getWeatherBackend; remove stub amplify"
```

---

### Task 7: Gate full-branch + docker smoke REAL + PR

**Step 1: Gate backend.**
```bash
cd swi-backend
npm run build            # exit 0
npm test                 # verde (~82)
docker compose up -d db  # se não estiver de pé
npm run test:e2e         # verde (31)
```

**Step 2: Gate mobile.**
```bash
cd mobile
npx tsc --noEmit                    # 8 baseline, 0 novos
npx jest                            # verde (~172)
npx expo export --platform web      # exit 0
```

**Step 3: Docker smoke REAL — feed + Open-Meteo ao vivo.**
```bash
cd swi-backend
docker compose up --build -d        # REBUILD (o container roda código velho)
# feed real:
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' -d '{"email":"worker@swi.local","password":"worker123"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).accessToken))')
curl -s localhost:3000/weather -H "Authorization: Bearer $TOKEN"   # números REAIS de SP (ou canned se rede off) + alerts (wx-0 se scenario=alert)
```
Expected: JSON com `current`/`daily` reais + `fetchedAt`.

**Step 4: Docker smoke REAL — prova `clima→notif` ao vivo (cron + dedup).**
- Limpe o dedup pra o alerta wx-0 poder disparar + suba o api com cron de 1min:
```bash
docker compose exec db psql -U swi -d swi -c "DELETE FROM \"WeatherAlertSeen\";"
WEATHER_CRON='* * * * *' docker compose up -d api   # recria o api com cron a cada minuto
```
- Rode um script temporário no `swi-backend/` que conecta um socket como o worker e espera o evento `notification` domain=weather (padrão do `tmp-notif-smoke.mjs` da F5):
```bash
node tmp-weather-smoke.mjs   # conecta socket + espera 'notification' domain=weather (~60-70s)
```
Expected: recebe `notification` com `domain='weather'`, `title='Alerta meteorológico'`. Espere +1 min → **não chega duplicata** (dedup: wx-0 agora em WeatherAlertSeen).
- Limpe: `mv tmp-weather-smoke.mjs "<scratchpad>/"` (NUNCA `rm -rf`) e volte o cron ao default (`docker compose up -d api`).

**Step 5: Review holística** (subagent) — contrato mobile↔backend, best-effort do cron, dedup, ownership do GET, fallback. 0 blockers antes do PR.

**Step 6: Commit final (se o smoke exigiu ajuste) + PR — SÓ COM LUZ VERDE.**
```bash
git push -u origin feat/backend-clima
# PR contra main; corpo descreve a fatia; SEM rastros de IA (sem Co-Authored-By, sem rodapé).
git log origin/main..HEAD | grep -iE 'claude|co-author|generated'   # tem que ser VAZIO
```

---

## Follow-ups deferidos (documentados no design, não bloqueiam)

- Fonte de aviso oficial de tempestade (INMET/OpenWeather One Call) = hard-block deploy.
- Provedor comercial de números (chave OpenWeather do cliente / Open-Meteo comercial).
- Consolidar sockets chat+notif; `targetId`→deep-link; push do SO (herdado F5).
