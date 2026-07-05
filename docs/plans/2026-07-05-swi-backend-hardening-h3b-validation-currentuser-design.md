# SWI Backend (container) — Hardening H3b (validação + @CurrentUser + paginação safety-cap + throttle test-env) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. **4ª fatia de hardening pré-produção** (pós H1 Auth #32,
> H2 correctness #33, H3a atomicidade+enum #34, os três em `main`). Fase: "hardening
> pré-produção" — código puro contra o Docker local, sem depender de deploy AWS.
>
> **H3 foi dividido em 2 fatias** (decisão do usuário): **H3a** (#34) = pure-backend, fechou
> atomicidade + enumeration. **H3b** (esta) = a 2ª metade — validação de data do Perfil +
> `@CurrentUser()` + `@MaxLength` no chat + paginação + media policy.

## Decisão de escopo (decisões do usuário, 2026-07-05)

Apesar de o H3b ter sido enquadrado como "a metade que toca o mobile", a auditoria do código
mostrou que **4 dos 6 itens são estritamente backend-only**; só paginação e media policy
*opcionalmente* tocam o contrato. Decisões:

1. **Escopo = backend-only, não-quebrante.** Fecha os itens SEM tocar o mobile. Fatia pure-backend
   igual H1/H2/H3a. As versões "de verdade" que quebram o contrato (cursor-envelope,
   presigned-POST multipart) ficam **diferidas** pra depois do H3.
2. **Media policy = diferida + documentada.** O fix real (presigned POST + `content-length-range`)
   é quebrante (mobile PUT→POST) → documentar e implementar numa fatia coordenada pós-H3.

Resultado: **5 fixes backend-only** + **1 diferido documentado**. Nenhum item muda o contrato REST
que o mobile consome (safety-cap devolve array cru; validação/`@MaxLength` só trocam 500→400 que o
`apiRequest` do mobile já trata via `.status`; `@CurrentUser` é refactor interno; throttle-bypass é
config de teste). Branch **`feat/backend-hardening-h3b`** de `main` (`0ebc57e`).

## Estado real auditado (código, não memória)

- `profile/dto.ts:6` — `@IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) birthDate?` valida **só o
  shape**; `2000-13-45` passa o regex → `profile.controller.ts:20` faz `new Date(dto.birthDate)`
  = `Invalid Date` → `profile.upsert` grava `birthDate: Invalid Date` → Prisma **500**.
- **20 métodos** em 6 controllers usam `@Req() req: any` + `req.user.userId` (chat 5, journey 8,
  notif 3, profile 2, reports 1, auth 1). `any` não-tipado, shape do JWT espalhado.
- `chat/dto.ts` — `SendMessageDto.body?` = `@IsOptional() @IsString()`, **sem `@MaxLength`**
  (body ilimitado). At-least-one (body **ou** imageKey) já é imposto no `chat.controller.ts:22`.
- Listas **ilimitadas** (`findMany` sem `take`): `reports.service.ts:17`, `notification.service.ts:21`,
  `chat.service.ts:30` (conversations) + `:39` (messages — thread longa devolve tudo).
- `app.module.ts:22` — `ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])` + `APP_GUARD`
  global. `chat.e2e` está no teto de **10 logins/min** → qualquer teste futuro que logue nesse
  arquivo dá 429.
- `media/media.service.ts:36` — `presignPut` assina **só Bucket+Key** via `PutObjectCommand` →
  o cliente PUTa qualquer tamanho. content-type **já** restrito no presign (`PresignDto` `IsIn`
  jpeg/png + extensão da key); só o **tamanho** fica solto.

## Decisões

### 1) Validação de data do Perfil (500 → 400)

Validador custom `@IsCalendarDate()` no `birthDate` do `UpdateProfileDto`, substituindo o `@Matches`
de shape. Faz round-trip pra provar que a data existe no calendário:

```ts
// profile/is-calendar-date.ts
const d = new Date(v)  // não-NaN E round-trip idêntico → rejeita 2000-13-45, 2000-02-30; aceita 2000-02-29
return !Number.isNaN(d.getTime()) && v === d.toISOString().slice(0, 10)
```

Vira **400** pelo `ValidationPipe` global (`app.module.ts:28`). Defense-in-depth: o controller
guarda `Invalid Date` antes do upsert (mas o DTO já barra).

### 2) `@CurrentUserId()` decorator (20 métodos)

Novo `src/auth/current-user.decorator.ts`:

```ts
export interface JwtUser { userId: string; /* ...claims futuros */ }
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtUser => ctx.switchToHttp().getRequest().user,
)
export const CurrentUserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().user.userId,
)
```

Como **todos os 20 sites** querem só o `userId`, o call site vira `@CurrentUserId() userId: string`
(minimal-diff) no lugar de `@Req() req: any` + `req.user.userId`. Remove o `any`, tipa o user,
single-source-of-truth do shape do JWT. `@CurrentUser()` fica disponível pra quem precisar do
payload completo depois. *(Alternativa: só `@CurrentUser() u: JwtUser` + `.userId` nos 20 sites —
mais verboso; descartada.)* Fonte inalterada: `req.user` é populado pela `JwtStrategy`/`JwtAuthGuard`,
mesma coisa que hoje; o `@UseGuards(JwtAuthGuard)` garante presença (401 antes) → sem novo modo de falha.

### 3) `@MaxLength` no `SendMessageDto`

`chat/dto.ts`: `body?` ganha `@MaxLength(4000)`. At-least-one continua no controller (já funciona).

### 4) Paginação safety-cap (não-quebrante)

`take: CAP` (**200**) server-side nos `findMany`. Devolve **array cru** → contrato do mobile inalterado.

- `reports.service.ts:17` (`orderBy createdAt desc`) → `take: 200` = 200 mais recentes. ✓
- `notification.service.ts:21` (`orderBy createdAt desc`) → `take: 200`. ✓
- `chat.service.ts:30` conversations (`orderBy lastMessageAt desc`) → `take: 200`. ✓
- `chat.service.ts:39` messages (`orderBy sentAt **asc**`) → **`take: -200`** (Prisma pega os
  **últimos** N mantendo o orderBy) = 200 **mais recentes** em ordem asc. `take: 200` puro pegaria
  as 200 mais **antigas** (esconde recentes = errado) → por isso o `-200`.

Sem query params (`?take=&cursor=`) — cursor real é o item **diferido**. O cap só bounda o pior caso.

### 5) Throttle bypass em test-env

`app.module.ts:22` migra da forma-array pra forma-objeto com `skipIf` (`@nestjs/throttler@^6.5.0`
suporta):

```ts
ThrottlerModule.forRoot({
  throttlers: [{ ttl: 60000, limit: 100 }],
  skipIf: () => process.env.NODE_ENV === 'test',
})
```

Desliga o `ThrottlerGuard` quando `NODE_ENV==='test'` → destrava escrever mais e2e no `chat.e2e`.
*(Alternativa: guard subclass com `shouldSkip` — mais código; `skipIf` é 1 opção.)* **Prova de
throttle existente não é neutralizada:** o H1 provou o throttle via **docker smoke** (forgot
200×5→429) + specs unit que não passam pelo guard real; nenhum e2e depende do 429 real. Confirmar
no plano rodando a suíte e2e com `NODE_ENV=test` (o jest-e2e seta) e checando que auth.e2e segue verde.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `swi-backend/src/profile/dto.ts` (+ novo `is-calendar-date.ts`) | `@IsCalendarDate()` no `birthDate` no lugar do `@Matches` de shape. |
| `swi-backend/src/profile/profile.controller.ts` | guarda `Invalid Date` (defense-in-depth) + `@CurrentUserId`. |
| `swi-backend/src/auth/current-user.decorator.ts` (novo) | `@CurrentUser()` + `@CurrentUserId()` + tipo `JwtUser`. |
| `swi-backend/src/{chat,journey,notifications,profile,reports,auth}/*.controller.ts` | `@Req() req: any`+`req.user.userId` → `@CurrentUserId() userId: string` (20 métodos). |
| `swi-backend/src/chat/dto.ts` | `@MaxLength(4000)` no `body`. |
| `swi-backend/src/reports/reports.service.ts` | `take: 200`. |
| `swi-backend/src/notifications/notification.service.ts` | `take: 200`. |
| `swi-backend/src/chat/chat.service.ts` | conversations `take: 200`; messages `take: -200`. |
| `swi-backend/src/app.module.ts` | `ThrottlerModule.forRoot({ throttlers, skipIf: test })`. |
| specs correspondentes + `test/*.e2e-spec.ts` | ver Testes. |

## Tratamento de erro

- **1 e 3:** falha de validação → **400** com corpo padrão do class-validator (mobile trata via
  `apiRequest` + `.status`). Substitui o **500** silencioso da data inválida por erro semântico.
- **2:** shape/status inalterados; `req.user` garantido pelo guard (401 antes). Sem novo modo de falha.
- **4 e 6:** sem novos caminhos de erro (cap é limite de leitura; `skipIf` é branch de config).
- **Princípio:** nenhuma falha nova engolida; nenhum fallback que mascare erro.

## Testes / gate

- **Unit:** DTO spec do Perfil (`2000-13-45`/`2000-02-30`→invalid, `2000-02-29`→valid,
  `2001-02-29`→invalid); DTO spec do chat (body > 4000 → invalid); asserts de `take`/`take:-200`
  nos `findMany` (reports/notif/chat conv+msg); unit do `@CurrentUserId()` (extrai `req.user.userId`).
- **e2e (Postgres vivo):** `PUT /profile/me` data inválida → **400**; chat send body longo → **400**;
  **chat.e2e com 2 logins** (o que hoje daria 429) → passa, provando o bypass; as rotas refatoradas
  pro `@CurrentUserId` seguem verdes (os e2e existentes já cobrem cada uma → comportamento inalterado).
- **Gate:** backend build 0 / unit verde / e2e verde. **Sem mobile** (confirmo diff zero-mobile).
- **Docker smoke (rebuild):** PUT data inválida→400, msg longa→400, listas respondendo capadas, as 6
  rotas verdes pós-refactor. Baseline atual: build 0 / unit **122** / e2e **37** → sobe com os novos.

## Não-objetivos / diferidos (implementar **após terminar o H3**, decisão do usuário)

1. **Media presigned-POST + `content-length-range`** — o fix real do limite de tamanho: trocar
   `presignPut` (PUT) por `createPresignedPost` com condições `content-length-range [0, MAX]` +
   `Content-Type`; mobile `services/api/uploadMedia.ts` migra de `fetch(url,{method:'PUT',body:blob})`
   pra **POST multipart/form-data** com os `fields` retornados. **Quebrante (backend+mobile coordenados).**
2. **Cursor pagination real** — envelope `{ items, nextCursor }` + query params `?take=&cursor=` +
   wiring de infinite-scroll no mobile (pode pedir Figma). O safety-cap do H3b bounda o pior caso; o
   cursor de verdade é isto. **Quebrante.**
3. **Fan-out de notif → fila** — `createForMany` síncrono no request path; escalabilidade, não
   correctness. Candidato a fatia própria pré-org-grande.
4. **Shape do 409 do signup** — mudar a mensagem 'E-mail já cadastrado' tocaria o mobile (herdado do H3a).

## Execução (subagent-driven)

1. **`is-calendar-date.ts` + `profile/dto.ts` + controller** — validação de data (+spec). TDD, isolado.
2. **`current-user.decorator.ts` + repoint dos 6 controllers** — `@CurrentUserId` (20 métodos). Task
   maior; os e2e existentes provam comportamento inalterado.
3. **`chat/dto.ts` `@MaxLength` + safety-cap** nos 3 services (reports/notif/chat) (+specs). TDD.
4. **`app.module.ts` throttle `skipIf`** + **e2e** (data inválida→400, body longo→400, chat 2-login)
   + **verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality). Commit local por task; **push/PR só com luz verde
explícita, sem rastros de IA**.
