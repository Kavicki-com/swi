# SWI Backend — Tarefas com atribuição (WorkOrder + checklist) — design

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Primeira fatia **pós-roadmap** de domínio novo:
> destrava a atribuição de tarefas que ficou *design-blocked* na Fatia 5
> (gatilho `task→notif`) e na Fatia 3 ("sem CRUD de task — atribuição é
> externa/seedada"). O design entregou as telas do painel admin em 2026-07-13.

## Contexto — as telas novas (Figma)

4 telas novas no canvas **Desktop** (admin) + 1 tela existente no canvas
**Mobile** que fecha o modelo:

| Node | Tela | Papel |
| --- | --- | --- |
| `1606-11583` | Lista "Atividades em andamento" | 3 abas (Em Andamento / Concluídas / A Fazer), linhas com título+setor+barra de progresso+avatares dos responsáveis (+N)+pino |
| `1611-9071` | "Nova tarefa" (form) | Setor, Tempo estimado, Data de início, Data de Conclusão, Título, Resumo, Detalhes, **toggle Check List** (itens {Título, Texto curto}), Anexos JPG/PNG, botão "Atribuir responsáveis" |
| `1614-13773` | Modal "Selecionar responsáveis" | "Atribua **1 ou mais** responsáveis" — workers com avatar/idade/tipo sanguíneo/cargo + checkbox |
| `1613-10013` | Detalhe da tarefa (admin) | Status chip, Editar, Autor, Responsáveis, **Progresso da tarefa**, Check List, Imagens |
| `364:16378` (mobile, existente) | Jornada "Hoje" | **Os cards de "Próximas tarefas" SÃO os itens do Check List do admin** — mesmo componente, mesma copy ("Inspeção de Equipamentos / Realizar verificações periódicas…") |

### A descoberta que define o modelo

O card da jornada mobile e o item de Check List do admin são **o mesmo objeto**.
O admin **cria a origem** do que o app já mostra e executa. Portanto:

- **Entidade PAI nova — `WorkOrder`** ("Tarefa" na UI do admin; ordem de
  serviço): título, resumo, detalhes, setor, datas, tempo estimado, autor,
  N responsáveis, anexos, status (3 abas), progresso derivado.
- **Entidade FILHA — o `Task` existente** (card da jornada / item do checklist):
  mantém a máquina de estados + âncoras de tempo + tela `task/[id]` intocadas
  na essência. Ganha `orderId`; perde `assignedTo` (a atribuição sobe pro pai).

O mobile **quase não muda**: telas de jornada continuam listando `Task`s; o que
muda é a fonte (itens de ordens onde `eu ∈ responsáveis`) e o rewire de 2 CTAs.

## Decisões (2026-07-13, travadas com o usuário)

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Progresso/estado | **Compartilhado** — 1 status + 1 progresso por WorkOrder, igual pra todos (as telas admin mostram 1 barra/1 aba por tarefa). Nada de progresso por-worker. |
| 2 | Tipo sanguíneo (modal) | **Fica mock** — dado de saúde, pivô manda mockar até a smartband. `GET /work-orders/assignable` NÃO devolve bloodType; o admin UI exibe decorativo. Idade sai de `Profile.birthDate` (dado cadastral, ok). |
| 3 | Pino de localização (lista) | **Sem campo novo** — o form não tem seletor de mapa; o pino é navegação "ver no mapa" pelo `sector`. |
| 4 | Fonte do progresso | **Checklist**: `progressPct = itens done ÷ total`. Tempo estimado/âncoras viram informação, não fonte do progresso do pai. |
| 5 | Sequência | **Backend primeiro** (`feat/backend-tarefas`, toca swi-backend + mobile). UI do admin = `feat/admin-tarefas` DEPOIS (bloqueada pela build vermelha do DS StatusChart). Zero `swi-admin/` nesta branch. |
| A | Concluir item | O botão **"Finalizar tarefa"** que JÁ EXISTE em `task/[id]` (Figma 364:17434) é rewired de `endJourney()` → **`POST /journey/tasks/:id/complete`**. Concluir item NÃO encerra o turno. "Cancelar tarefa" → **`POST /journey/tasks/:id/cancel`** (larga sem concluir). |
| B | Ordem sem checklist | Toggle OFF → o backend **auto-cria 1 item** espelhando título+resumo da ordem ("tarefa de item único"). Invariante: **toda ordem tem ≥1 item** — o progresso nunca é 0÷0 e a ordem sempre aparece na jornada dos responsáveis. |
| C | Conclusão do pai | **Derivada e recomputada em transação**: todos os itens done → `done`; algum item in_progress/paused/done → `in_progress`; senão `pending`. Admin adicionar item numa ordem concluída → volta pra `in_progress` (comportamento correto neste modelo, não bug). |
| D | `paused` | **Fica no item** (os 3 layouts da jornada mobile dependem dele). O PAI nasce com enum próprio de **3 estados** = as 3 abas. |
| E | endJourney | **Não marca mais o item como done** (era a simplificação da demo de 1 worker). Banca o tempo do item ativo e o deixa **`paused`** (retomável amanhã); turno zera como hoje. |
| F | Fotos | **Sobem pro PAI** (`WorkOrder.imageKeys`) — a seção "Imagens" do admin é da ordem; "Fotos da solicitação" no mobile exibe as da ordem. `addTaskPhoto` (rota mantida) resolve item→ordem e appenda com `{ push }` atômico. `Task.imageKeys` morre. |
| G | Notificação | `POST /work-orders` → `enqueueForMany(responsibleIds, { domain:'journey', targetId: orderId, title:'Nova tarefa atribuída', body: order.title })` — fecha o gatilho *design-blocked* da Fatia 5. `PATCH` que ADICIONA responsáveis notifica só os novos. Deep-link por targetId continua deferido (tap cai em `/journey`). |
| H | Estimativa | `estimatedMinutes` é do PAI (campo do form). Itens recebem **rateio** determinístico (`distributeMinutes`) na criação/edição — preserva o donut "8h" da jornada (soma dos itens ≈ total) e a barra de tempo do item. |
| I | Lista do worker | Itens de ordens onde `eu ∈ responsáveis` **AND** (`startDate ≤ hoje` OR null) **AND** `order.status ≠ done`. Atrasada (dueDate < hoje) continua aparecendo. Substitui `assignedTo + scheduledDate = hoje`. |
| J | Objetivo | O form admin não tem objetivo por item. "Objetivo principal" no mobile passa a exibir **`order.summary`** (o "Resumo" da ordem) via o campo `objective` do DTO do item (shape preservado). |

## Schema (migração + reseed limpo — backend nunca deployado)

```prisma
enum WorkOrderStatus { pending  in_progress  done }   // = as 3 abas

model WorkOrder {
  id               String          @id @default(uuid())
  authorId         String
  author           User            @relation("authoredWorkOrders", fields: [authorId], references: [id])
  title            String
  summary          String?
  details          String?
  sector           String?
  estimatedMinutes Int?
  startDate        DateTime?       @db.Date
  dueDate          DateTime?       @db.Date
  status           WorkOrderStatus @default(pending)  // recomputado em tx
  imageKeys        String[]
  responsibles     User[]          @relation("workOrderResponsibles")  // m-n implícito
  items            Task[]
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([status])
}
```

`Task` (filho) — **muda**: `+orderId` (FK, `onDelete: Cascade`), `+position Int
@default(0)`; **remove**: `assignedTo`/`assignee`, `objective`, `scheduledDate`,
`imageKeys`, `interestedCount`, `interestedAvatarKeys` (o índice
`[assignedTo, scheduledDate]` morre; entra `@@index([orderId, position])`).
**Mantém**: `title`, `description`, `estimatedMinutes` (rateio), `status`
(**4 estados, `paused` fica**), `startedAt`, `accumulatedSeconds`, `progressPct`.
`User` ganha as 2 relações (`authoredWorkOrders`, `responsibleFor`); a relação
`tasks` morre.

## Endpoints

### Admin — `src/work-orders/` (novo; `JwtAuthGuard + RolesGuard @Roles('ADMIN')`)

| Rota | Faz |
| --- | --- |
| `POST /work-orders` | Cria + atribui (autor = JWT). `items` vazio/omitido → auto-item (Decisão B). Valida responsibleIds = WORKERs APPROVED. Rateia estimativa. Enfileira notificação (G). |
| `GET /work-orders?status=` | Lista org-wide das abas, `take: 200`, desc. Row: título, setor, status, progressPct, responsáveis (count + avatares presigned). |
| `GET /work-orders/:id` | Detalhe: autor (nome+avatar), responsáveis (perfil: nome, cargo, setor, birthDate, avatar), itens ordenados, imagens presigned, datas, progresso. |
| `PATCH /work-orders/:id` | Editar (botão "Editar"). Itens por reconciliação: com `id` = update, sem `id` = create, ausente = delete; resultado deve ter **≥1 item**. Responsáveis = set replace (novos notificados). Recomputa status/rateio. |
| `GET /work-orders/assignable` | Diretório do modal: WORKERs APPROVED + perfil (espelha `chat.listDirectory`, sem excluir ninguém; **sem bloodType** — Decisão 2). |

### Worker — `/journey` (existente; mecânica de âncoras intocada)

| Rota | Muda |
| --- | --- |
| `GET /journey/tasks` | Query nova (Decisão I). Ordena `[order.createdAt, position]`. Devolve TODOS os status (done aparece — radio preenchido). |
| `GET /journey/tasks/:id` | Membership via `order.responsibles` → 404 (padrão não-vaza-existência). |
| `POST /journey/tasks/:id/start` | Igual + recomputa pai na mesma tx (`pending→in_progress`). |
| `POST /journey/tasks/:id/complete` | **NOVO**: banca tempo (endAnchors), `status: done`, `progressPct: 100`; limpa `journey.activeTaskId` se era o ativo (**turno segue rodando**); recomputa pai (todos done → `done`). Idempotente em item já done. Devolve `{ journey, task }`. |
| `POST /journey/tasks/:id/cancel` | **NOVO**: banca tempo (pauseAnchors), `status: pending` (tempo bancado preservado), limpa `activeTaskId` se ativo; turno segue; recomputa pai. Devolve `{ journey, task }`. |
| `POST /journey/pause` / `resume` | Inalterados (tocam o item ativo — deliberado: o item ativo é de quem trabalha nele agora; semântica de piloto documentada). |
| `POST /journey/end` | **Decisão E**: item ativo → `paused` (não done); turno idle+zerado como hoje. |
| `POST /journey/tasks/:id/photo` | Rota mantida; server appenda em `order.imageKeys` (`{ push }`); DTO do item devolve as imagens da ordem. |

### Concorrência (disciplina H2/H3a, baked-in no design)

Toda transição de item (`start`/`complete`/`cancel`/`pause`/`resume`/`end`) roda
em `$transaction` com **lock pessimista da ordem** (`SELECT id FROM "WorkOrder"
WHERE id = $1 FOR UPDATE` via `$queryRaw` no topo da tx) — serializa o recompute
do pai: 2 workers concluindo os 2 últimos itens em paralelo não deixam a ordem
presa em `in_progress`. O recompute é **função pura** (`orderStatus(items)`)
TDD-ada isolada. Fotos: `{ push }` (array_append) como no H3a.

## DTO do item (wire) — shape quase preservado

```
{ id, title, description,
  objective,                    // ← order.summary ?? '' (Decisão J)
  estimatedMinutes,             // rateio (Decisão H)
  status, startedAt, accumulatedSeconds, progressPct,
  images,                       // ← ORDER.imageKeys presigned (Decisão F)
  responsibleCount,             // ← substituem interestedCount/interestedAvatars
  responsibleNames,             //   (arrays paralelos, padrão Conversation)
  responsibleAvatars }
```

Renomeio `interested*` → `responsible*` é honesto (agora são os responsáveis
REAIS) e barato (a branch é dona dos dois lados). `assignedTo`/`scheduledDate`
saem do tipo mobile.

## Mobile (mesma branch — `feat/backend-*` pode tocar mobile)

- `services/journey/types.ts`: campos acima; `JourneyBackend` ganha
  `completeTask(taskId)` e `cancelTask(taskId)` (ambos → `{ journey, task }`).
- `mockJourneyBackend`: reducers novos (complete/cancel), `endJourney` →
  `paused` (Decisão E), seed vira 1 ordem-demo com os 4 itens (mesma copy) +
  responsáveis demo (avatares worker-1..5). Mock continua o caminho pixel-parity
  do Figma (`DATA_BACKEND=mock`); os `objective` ricos por item do mock de hoje
  colapsam em `order.summary` — divergência aceita e documentada (o Figma mostra
  1 tela; a API real nunca teve objetivo por item).
- `apiJourneyBackend`: 2 POSTs novos.
- `JourneyProvider`: métodos `completeTask`/`cancelTask` (atualizam session+tasks).
- `task/[id].tsx`: **"Finalizar tarefa"** → `completeTask(id)`; **"Cancelar
  tarefa"** → `cancelTask(id)` (ambos voltam pra `/journey`; turno segue).
  Seção "Interessados" (label Figma mantido) lê `responsible*`; caption usa
  `responsibleNames[0]` com fallback na copy do Figma.
- `journey/index.tsx`: **intocada** (donut soma `estimatedMinutes` pending —
  rateio preserva; cards renderizam title/description).

## Seed (reseed limpo, idempotente)

- Ordem-flagship "Inspeção Técnica das Máquinas Pesadas" (copy do admin detail
  1613: summary "Checklist de manutenção preventiva e reparos necessários",
  sector, startDate=hoje, dueDate=+30d, estimatedMinutes=480 → 4×120), autor =
  admin@swi.local, responsáveis = worker@swi.local + 2 workers do chat, itens =
  os 4 cards de sempre (Inspeção/Manutenção/Diagnóstico/Reparo — copy idêntica
  ao mock/Figma).
- 1 ordem **sem checklist** ("Trocar extintores do galpão 3") atribuída ao
  worker@swi.local → prova a Decisão B no QA (card único).
- Mais 3–4 ordens variadas (Reparo/Alocação de maquinário, setores/status
  variados, atribuídas aos outros workers) → povoam as 3 abas do admin.
- Avatares: reusa os `chat/avatars/` que o seed do Chat já sobe pro MinIO.

## Testes + verificação (disciplina da rodada)

- **Unit**: `order-status.spec` (recompute puro: all-done/misto/paused conta
  como começado; `distributeMinutes`: soma preservada, resto no início, n=1,
  total null) + `work-orders.service.spec` (create com/sem checklist, auto-item,
  validação de responsáveis, reconciliação de itens no PATCH com ≥1,
  notificação enfileirada p/ novos responsáveis) + `journey.service.spec`
  atualizado (query nova, complete/cancel, end→paused, photo→ordem).
- **e2e**: `work-orders.e2e` (403 worker no POST; admin cria → responsáveis
  listam em `/journey/tasks`; não-responsável → 404; start→complete→progresso/
  status do pai; 2 completes concorrentes fecham a ordem — prova do FOR UPDATE;
  PATCH edita itens/responsáveis; assignable) + `journey.e2e` atualizado
  (end→paused; cancel volta pending com tempo bancado) + notificação criada
  (inline seam test-env).
- **Docker smoke real** (rebuild): admin cria ordem via curl → worker lista →
  start → complete → `GET /work-orders` mostra progresso/aba; foto
  presign→POST→GET 200 nas imagens da ordem; socket recebe `notification`
  domain=journey.
- **Mobile**: jest (mock novo, api novo, provider), tsc 0 novos (8 baseline),
  expo export web exit 0.
- **Two-gate** (spec + quality por unidade) + review holística; commit **só com
  luz verde explícita** do usuário.

## Não-objetivos / notas

- **UI do admin fora** (`feat/admin-tarefas` depois; consome estes endpoints;
  bloqueada pela build vermelha do DS StatusChart). A copy residual do Figma
  ("Salvar **relatório**", "…ao seu **relatório**" no modal) é bug de design a
  reportar — não afeta o backend.
- **Sem bloodType** no backend (Decisão 2 — saúde mock até a smartband).
- **Sem localização por tarefa** (Decisão 3 — pino = navegação por setor).
- **Sem progresso por-worker** (Decisão 1).
- **Sem paginação real** (cap 200 herdado do H3b; cursor pagination segue como
  diferido global).
- Deep-link `targetId`→tela segue deferido (Fatia 5).
- Push do SO segue hard-block de deploy (SNS/FCM/APNs).
- `PresignDto.prefix` ganha `order` (anexos do admin quando a UI chegar; o seed
  sobe direto via client S3).
