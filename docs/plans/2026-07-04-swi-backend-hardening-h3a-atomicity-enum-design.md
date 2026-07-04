# SWI Backend (container) — Hardening H3a (atomicidade restante + enumeration timing) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. **3ª fatia de hardening pré-produção** (pós H1 Auth #32 e
> H2 correctness #33, ambos em `main`). Fase: "hardening pré-produção" — código puro contra
> o Docker local, sem depender de deploy AWS.
>
> **H3 foi dividido em 2 fatias** (decisão do usuário): **H3a** (esta) = pure-backend, fecha
> os temas do H1/H2 sem tocar o contrato do mobile. **H3b** (futura) = validação de data do
> Perfil + `@MaxLength` no body do chat + decorator `@CurrentUser()` + paginação/media policy
> (inclui o que toca o mobile).

## Contexto

H1 fechou segurança do Auth, H2 fechou os 3 races de concorrência. **H3a fecha o "trabalho
inacabado" das duas:** a atomicidade que sobrou (mesma classe do H2) + o timing de enumeração
deferido do H1. **Fatia pure-backend**: só `swi-backend/src/{chat,journey,auth}/`, **zero
mobile, sem mudança de schema**. Branch **`feat/backend-hardening-h3a`** de `main` (`84ba005`).

### Estado real auditado (código, não memória)

- `chat.service.ts:76-81` (`sendMessage`) e `:104-107` (`markRead`) — read-modify-write do
  mapa `unreadByJson` a partir de um snapshot stale (`conv` lido em `:55-56`) → 2 sends
  concorrentes perdem um incremento; `markRead` correndo com send clobbera.
- `journey.service.ts:148-156` (`addTaskPhoto`) — RMW do array `imageKeys` **sem** `$transaction`
  (o H2 transacionou start/pause/resume/end, mas o photo ficou de fora). Mesma classe.
- `auth.service.ts` — `confirm` (`:51`) e `resetPassword` (`:82`) short-circuitam **antes** do
  bcrypt compare quando user/code-hash ausente (leak por timing; shape já idêntico 400 'Código
  inválido'); `forgotPassword` (`:71`) `if (!u) return` sem trabalho equivalente; `signup`
  (`:22`) leak de **shape** no 409 + **sem `@Throttle`** (só o global 100/min).

## Decisões

### A) Atomicidade

**A1. `unreadByJson` — `$executeRaw` atômico (jsonb_set).** O Prisma **não** tem increment
atômico de jsonb → SQL raw é inevitável. Conversa é **2-party** → exatamente **1 destinatário**
por mensagem (o participante ≠ remetente). `sendMessage` troca o `conversation.update` por um
`UPDATE` atômico único (dobra o bump de `lastMessage*` no mesmo statement):

```ts
await this.prisma.$executeRaw`
  UPDATE "Conversation"
  SET "lastMessageBody" = ${lastBody},
      "lastMessageAt"   = ${now},
      "unreadByJson"    = jsonb_set(
        COALESCE("unreadByJson", '{}'::jsonb),
        ARRAY[${recipientId}],
        to_jsonb(COALESCE(("unreadByJson"->>${recipientId})::int, 0) + 1),
        true)
  WHERE id = ${convId}`
```

`markRead` idem, zerando o meu contador:

```ts
await this.prisma.$executeRaw`
  UPDATE "Conversation"
  SET "unreadByJson" = jsonb_set(COALESCE("unreadByJson", '{}'::jsonb), ARRAY[${userId}], '0'::jsonb, true)
  WHERE id = ${convId}`
```

`$executeRaw` (tagged template) **parametriza** os valores → sem injection (o `recipientId`/`userId`
vem de `conv.participants`, já validado). `lastMessageBody`/`lastMessageAt` seguem last-write-wins
(aceitável); só o **contador** acumula. `message.create` fica fora (linha própria, sem race).
`lastBody` = `dto.body || (dto.imageKey ? '📷 Imagem' : '')` (paridade com o atual).

**A1b. `addTaskPhoto` — Prisma `push` nativo (array_append atômico).** Aqui o Prisma **tem**
suporte nativo: `{ imageKeys: { push: imageKey } }` compila pra `array_append` atômico. Sem raw.
Mantém o `findMyTask` (checagem de ownership → 404; o dono de uma task nunca muda, read stale é ok);
só o **append** vira atômico:

```ts
const task = await this.findMyTask(workerId, taskId)
if (!task) throw new NotFoundException('Tarefa não encontrada')
const saved = await this.prisma.task.update({
  where: { id: task.id },
  data: { imageKeys: { push: imageKey } },   // array_append atômico (era [...task.imageKeys, imageKey])
})
return this.taskToDto(saved)
```

### B) Enumeration timing

Espelha o fix de login do H1 (sempre 1 bcrypt compare via `DUMMY_HASH`, já em `codes.ts`).

- **`confirm` / `resetPassword`:** sempre 1 `verifyHash(code, hash ?? DUMMY_HASH)` — não
  short-circuitar antes do compare quando o user/hash está ausente. Shape já é idêntico
  (400 'Código inválido'), só o **custo** passa a ser constante.
- **`forgotPassword`:** quando o user não existe, roda **trabalho dummy equivalente** (1
  `bcrypt.hash` do código gerado, descartado) pra igualar o custo do caminho real (que hasheia
  o reset code). Resposta já é sempre 200/void.
- **`signup`:** adiciona **`@Throttle({ default: { limit: 5, ttl: 60_000 } })`** no controller
  (hoje só o global 100/min). O leak de **shape** do 409 ('E-mail já cadastrado') é inerente e
  **mudar a mensagem tocaria o mobile → fica no H3b**; throttle é a mitigação pure-backend.

**Nota honesta (defense-in-depth):** `confirm`/`reset`/`forgot` **já têm** `@Throttle 5/min` +
shape silencioso — o oráculo de timing residual é fraco (5 probes/min, variância do bcrypt). A
equalização fecha a família por consistência com o rigor do H1, não é o buraco mais crítico.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `swi-backend/src/chat/chat.service.ts` | `sendMessage`/`markRead`: `$executeRaw` jsonb_set atômico no lugar do RMW. |
| `swi-backend/src/journey/journey.service.ts` | `addTaskPhoto`: `{ imageKeys: { push } }` atômico. |
| `swi-backend/src/auth/auth.service.ts` | `confirm`/`reset` sempre-1-compare; `forgot` trabalho dummy no ramo sem-user. |
| `swi-backend/src/auth/auth.controller.ts` | `@Throttle 5/min` no `signup`. |
| `swi-backend/src/chat/chat.service.spec.ts` | +caso: 2 incrementos concorrentes acumulam (mock do `$executeRaw`). |
| `swi-backend/src/journey/journey.service.spec.ts` | +caso: `addTaskPhoto` usa `push` (não `[...spread]`). |
| `swi-backend/src/auth/auth.service.spec.ts` | +casos: confirm/reset/forgot chamam verifyHash/hash mesmo sem user (timing). |
| `swi-backend/test/{chat,journey}.e2e-spec.ts` | e2e concorrente: N sends → contador = N; N photos → N keys. |

## Tratamento de erro

- **A1/A1b:** tipos de exceção inalterados (`NotFoundException` do photo; sendMessage/markRead
  sem novos erros). O `$executeRaw` lança em erro de DB real (propaga, não engole).
- **B:** shapes/status inalterados (`confirm`/`reset` 400 'Código inválido'; `forgot` 200 void;
  `signup` 409). Só o **custo de tempo** e o **throttle** mudam.

## Testes / gate

- **Unit:** os casos novos + os existentes verdes. `$executeRaw` mockado (`jest.fn`) pros unit
  do chat; o e2e prova o acúmulo real contra Postgres.
- **e2e (Postgres vivo):** N sends concorrentes → `unreadBy[recipient] === N` (hoje < N por
  lost-update); N `addTaskPhoto` concorrentes → `imageKeys.length === N`; auth.e2e mantido.
- **Gate:** backend build 0 / unit verde / e2e verde. **Sem mobile** (confirmo diff zero-mobile).
- **Docker smoke (rebuild):** N sends concorrentes de 2 workers numa conversa → contador de
  não-lidas do destinatário = N exato (não < N); confirm/reset com código errado seguem 400.

## Não-objetivos / deferidos (→ H3b)

- Validação de data de calendário do Perfil (`2000-13-45`→500) + `@CurrentUser()` decorator.
- `@MaxLength`/at-least-one no `SendMessageDto`.
- Paginação (`GET /reports`, listas de chat/notif) + presigned-POST policy (limite de tamanho)
  — **tocam o contrato do mobile**.
- Fan-out de notif → fila (escalabilidade, não correctness).
- Mudar o **shape** do 409 do signup (tocaria o mobile).

## Execução (subagent-driven)

1. **`journey.service.ts`** — `addTaskPhoto` push atômico (+spec). TDD, isolado.
2. **`chat.service.ts`** — `sendMessage`/`markRead` jsonb_set atômico (+spec). TDD.
3. **`auth.service.ts` + `auth.controller.ts`** — confirm/reset/forgot timing + signup throttle (+spec). TDD.
4. **e2e concorrente** (chat contador, journey photos) + **verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality). Commit local por task; **push/PR só com luz
verde explícita, sem rastros de IA**.
