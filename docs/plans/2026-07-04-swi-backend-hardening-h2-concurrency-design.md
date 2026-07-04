# SWI Backend (container) — Hardening H2 (Correctness/concorrência) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. **2ª fatia da fase de hardening pré-produção** (pós H1
> Auth security, já em `main` via PR #32). Fase escolhida pelo usuário: "hardening
> pré-produção" — código puro contra o Docker local, sem depender de deploy AWS.
>
> **Distinto** do H1 (`2026-07-03-swi-backend-hardening-h1-auth-design.md`, segurança do
> auth). Aqui = **correctness de concorrência/atomicidade** em Chat e Journey.

## Contexto

H1 fechou a segurança do auth. H2 = os achados de **correctness sob concorrência** dos
code-reviews de Chat e Journey. **Fatia pure-backend**: só `swi-backend/src/{chat,journey}/`,
**zero mobile** (igual H1). Branch **`feat/backend-hardening-h2`** de `main` (`8578a62`,
já com Evacuação + H1).

Escopo travado com o usuário: **exatamente os 3 races** — sem absorver timing de
enumeração (deferido do H1) nem validação de data do Perfil; esses ficam pro **H3**.

### Estado real auditado (código, não memória)

- `chat.service.ts:55-56` — `findUnique` seguido de `createConversation` (check-then-act).
- `journey.service.ts` — `startTask`/`pauseJourney`/`resumeJourney`/`endJourney` fazem
  `task.update` **e depois** `journey.update` como 2 writes soltos. *(A criação da journey
  já é race-safe via `upsert` no `getOrCreateToday` — a race não é a criação, é o par de writes.)*
- `time-anchors.ts:20-28` — `startAnchors`/`resumeAnchors` setam `startedAt=now`
  incondicionalmente, sem bancar o segmento em curso.

## Decisões

### T1 — Chat TOCTOU (`chat.service.ts`)

`conversation.create` concorrente das 2 primeiras mensagens → a 2ª bate **`P2002`**
(unique no `id` determinístico `[a,b].sort().join('#')`) → exceção não tratada → **500**.
Fix = **create-catch-P2002-refetch**:

```ts
let conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
if (!conv) {
  try {
    conv = await this.createConversation(convId, participants)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      conv = await this.prisma.conversation.findUnique({ where: { id: convId } })
      if (!conv) throw e // paranoia: P2002 sem linha visível → não engolir
    } else {
      throw e
    }
  }
}
```

**Preserva o 404-user-inexistente:** `createConversation` lança `NotFoundException` (não
P2002) quando algum participante não existe → cai no `else { throw e }` → 404 intacto. Só
a colisão de corrida é engolida. Por isso **não** `upsert` (mascararia user inválido criando
conv com nome vazio).

### T2 — Journey atomicidade (`journey.service.ts`)

Os 4 métodos (`startTask`, `pauseJourney`, `resumeJourney`, `endJourney`) fazem
`task.update` + `journey.update` sem transação → falha no 2º write deixa estado
inconsistente permanente (task `in_progress` mas journey `idle`, etc.). Fix = **transação
interativa** do Prisma envolvendo o(s) write(s) dependentes:

```ts
return this.prisma.$transaction(async (tx) => {
  const journey = await tx.journey.upsert({ ... })   // getOrCreateToday dentro da tx
  // ... reads via tx (findMyTask do active) ...
  const savedTask = await tx.task.update({ ... })
  const savedJourney = await tx.journey.update({ ... })
  return { ... }
})
```

Interativa (não o array `$transaction([...])`) porque os writes são **dependentes**
(read journey/task → compute anchors → write). Todos os reads/writes do método passam a
usar `tx` pra ficarem na mesma transação. `getOrCreateToday`/`findMyTask` ganham um param
opcional de client (`tx ?? this.prisma`) pra serem reusados dentro e fora da tx.

### T3 — Idempotência start/resume (`time-anchors.ts`)

`startAnchors`/`resumeAnchors` re-ancoram `startedAt=now` mesmo já rodando, **sem bancar**
o segmento corrido → duplo-tap descarta tempo. Fix = **no-op quando já running** (guard na
função pura):

```ts
export function startAnchors(a: Anchors, nowMs: number): Anchors {
  if (a.running && a.startedAt != null) return a
  return { startedAt: nowMs, accumulatedSeconds: a.accumulatedSeconds, running: true }
}
// idem resumeAnchors
```

Já rodando → âncoras intactas (o `startedAt` original segue contando via `elapsedSeconds`).
Só re-ancora na transição legítima parado→rodando. Guard na função pura (não no serviço):
idempotência é propriedade do modelo de âncoras, já tem cobertura de teste, e vale pra task
**e** journey (ambos usam as mesmas funções).

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `swi-backend/src/chat/chat.service.ts` | create-catch-P2002-refetch no `sendMessage`; import `Prisma`. |
| `swi-backend/src/journey/journey.service.ts` | `$transaction` interativo nos 4 métodos; `getOrCreateToday`/`findMyTask` aceitam client opcional. |
| `swi-backend/src/journey/time-anchors.ts` | guard idempotente em `startAnchors`/`resumeAnchors`. |
| `swi-backend/src/chat/chat.service.spec.ts` | +caso: 2º create P2002 → re-busca, não 500. |
| `swi-backend/src/journey/journey.service.spec.ts` | +caso: falha no 2º write → nada commita (mock tx). |
| `swi-backend/src/journey/time-anchors.spec.ts` | +caso: start/resume já-rodando = no-op (tempo preservado). |
| `swi-backend/test/{chat,journey}.e2e-spec.ts` | e2e concorrente: 2 sends simultâneos = 0 erro; start 2× = tempo não regride. |

## Tratamento de erro

- **T1:** só `P2002` é engolido (e só quando a re-busca acha a linha); qualquer outra
  exceção (incl. `NotFoundException` de user inexistente) re-lança. Tipos de resposta
  inalterados.
- **T2:** transação faz rollback automático em qualquer throw dentro do callback; os tipos
  de exceção dos métodos (`NotFoundException`) ficam iguais — só passam a ser atômicos.
- **T3:** sem novos erros; caminho já-rodando vira no-op silencioso (semântica de retry).

## Testes / gate

- **Unit:** os 3 casos novos + os existentes verdes.
- **e2e:** `chat.e2e`/`journey.e2e` mantidos verdes + os 2 casos concorrentes novos.
- **Gate:** backend build 0 / unit verde / e2e verde. **Sem mobile** → gate mobile
  inalterado (confirmo que nada mobile mudou; `npm test`/tsc/expo mobile não precisam rodar).
- **Docker smoke (rebuild):** 2 primeiras mensagens concorrentes entre 2 workers = ambas
  200 (nenhum 500); start-task 2× seguido = `accumulatedSeconds` não regride; pause após
  start-duplo banca o tempo certo.

## Não-objetivos / deferidos

- **Timing de enumeração** (forgot/confirm/reset/signup) → **H3** (mesma família do login-fix).
- **Validação de data de calendário** do Perfil (`2000-13-45`→500) + `@CurrentUser()` → **H3**.
- **Notif fan-out→fila / consolidar sockets** e **Reports presigned-POST/paginação** → **H3**.
- Locking pessimista, retry-com-backoff, filas — overkill pro piloto; catch-P2002 +
  `$transaction` cobrem os casos reais.

## Execução (subagent-driven)

1. **`time-anchors.ts`** — guard idempotente em start/resume (+spec). Função pura, TDD, sem deps.
2. **`journey.service.ts`** — `$transaction` interativo nos 4 métodos (+spec). TDD.
3. **`chat.service.ts`** — create-catch-P2002-refetch (+spec). TDD.
4. **e2e concorrente** (chat 2-sends, journey start-duplo) + **verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality). Commit local por task; **push/PR só com
luz verde explícita, sem rastros de IA**.
