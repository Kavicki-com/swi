# Passo 4 — Relatórios (CRUD completo + comentários): Design

**Data:** 2026-07-23
**Branch:** `feat/backend-admin-reports` (base `main`; toca `swi-backend/` + `swi-admin/`, sem `mobile/`)
**Roadmap:** [[swi-admin-backend-roadmap]] Passo 4

## Objetivo

O site precisa funcionar **completamente**, exceto o que é alimentado pela smartband
(saúde/vitais e derivados). Relatório **não é dado de saúde** → tem que funcionar de ponta
a ponta: **criar, ler, editar/revisar e comentar**. Esta fatia deixa de ser um espelho de
"só leitura" (Passo 2) e vira **CRUD completo + domínio de comentários**.

Decisões do usuário (brainstorming 2026-07-23):
- **Profundidade:** CRUD completo (não só leitura).
- **Revisar relatório (peça B):** *editar conteúdo completo* — status **e** título/resumo/
  detalhes/anexos, reusando o form em modo edição.
- **Comentários (peça C):** *construir de verdade* — model + endpoints + lista na tela.
- **Ornamentos decorativos:** manter como decoração (avatares do card e das activities vêm
  de rodízio fixo de avatares empacotados; responsáveis em **texto** são reais).

## Estado atual (levantado no código)

- **Backend `/reports` já é real:** `GET /reports`, `GET /reports/:id`, `POST /reports`
  existem e retornam o shape mobile `Report` (avatar/imagens presignados, data BR). Falta
  **`PATCH`** e **comentários**.
- **Admin ainda no mock morto:** telas importam de `services/reports.ts` (fachada
  `DATA_BACKEND` mock/amplify, morta). Não existe `services/api/reports.ts`.
- **DB sem relatórios seedados** → lista fica vazia sem seed.
- **Ações de escrita são toasts:** `NewReport` "Salvar" e `ReportDetails` "Revisar"/"Fazer
  comentário" só chamam `showToast`. O `ResponsablesModal` lê admins reais mas o "Continuar"
  não devolve a seleção pro form.
- **`ReportStatus` enum** = `accept | pending | canceled | info` (bate com a união do mock).
- **`activities`** é `Json?` no model; `create()` grava `[]`. Não há model de comentário.

## Backend (`swi-backend`)

1. **`PATCH /reports/:id`** — guard ADMIN ou autor. Edita `title/summary/details/
   responsibles/imageKeys/status/statusLabel`. Reusa `toDto`. `imageKeys` valida prefixo
   `reports/` (mesmo regex do create). P2025 → 404.
2. **Model `Comment`** (migração aditiva):
   - Campos: `id`, `reportId → Report`, `authorId → User`, `body`, `createdAt`.
   - `POST /reports/:id/comments` (autenticado) → cria; DTO devolve autor (nome + avatar
     presignado) + corpo + data BR.
   - Comentários **embutidos no `GET /reports/:id`** (uma chamada só pro detalhe), ordenados
     por `createdAt`.
   - Notificação best-effort pros outros workers (opcional; espelha o padrão do `create`).
3. **Seed** (`prisma/seed.ts`): ~12 relatórios ricos via `prisma.report.create` direto
   (permite status variado): autor real do seed (+ `avatarKey`), `responsibles` (nomes),
   `sector`, `details`, `activities` JSON (título/setor/progresso/tom), `imageKeys` (as 3
   fotos de inspeção enviadas ao MinIO em `reports/<uuid>.png`, reusando o S3 client +
   guard bucket-down existente). Mais alguns comentários demo em 1–2 relatórios.
4. **Fora de escopo backend:** sem `DELETE /reports/:id` (não há UI de exclusão); **sem
   filtro por autor** no `GET /reports` — org-wide é o correto pro admin (o `create` já
   notifica todos os workers → inbox org-wide). O "bug" do roadmap é uma questão do mobile.

## Admin (`swi-admin`)

1. **`services/api/reports.ts`** (novo, padrão `api/auth.ts`/`api/users.ts`): `list`, `get`
   (com comentários), `create`, `update` (PATCH), `addComment`. Envelope `MockResponse`.
   Mapper de leitura DTO→`Report`:
   - `responsibles: string[]` → **string separada por vírgula**.
   - `responsibleAvatars`/`responsibleTotalCount` → **decorativos** (rodízio de avatares
     empacotados; documentado como decoração).
   - `activities` JSON → `ReportActivity[]`, injetando `avatars` decorativos por linha.
   - `status/statusLabel/authorAvatarUri/images/details/creationDate` → passthrough.
2. **`NewReport` (modo criação):** `POST /reports` real; anexos via `uploadImage(file,
   'reports')` → `imageKeys`; **reconectar `ResponsablesModal`** (seleção volta pro form via
   state de rota/store leve → `responsibles`).
3. **Revisar/Editar:** "Revisar relatório" (`ReportDetails`) → nova rota `/reports/:id/edit`
   que reusa o `NewReport` em **modo edição** (pré-preenchido) + **controle de status**;
   salvar → `PATCH`.
4. **Comentários:** `ReportDetails` ganha **lista de comentários** (autor + avatar + data +
   corpo, composta com o DS) acima do input; "Fazer comentário" → `POST` → append/refetch.
5. **Ornamentos** (card `responsibleAvatars`, `AvatarGroup` "+13", avatares de activity)
   seguem decorativos; o `AvatarGroup` hardcoded do `ReportDetails` fica como está.

## Fora de escopo (mock / smartband)

Vitais, alerts, rescue, monitoring, maps, biometria do worker. DELETE de relatório.
Filtro por autor no `GET /reports`.

## Testes & verificação

- **Backend:** specs de `PATCH`, comments service + guards; migração aplicada; re-seed do
  DB de dev; `npm test` verde.
- **Admin:** `api/reports.test.ts` (list/get/create/update/addComment + mapper) + testes de
  tela (NewReport POST + upload, edit mode PATCH, lista + post de comentário, modal
  reconectado ao form).
- **Playwright ao vivo** contra a stack real: criar → aparece na lista; editar status/
  conteúdo → persiste; comentar → aparece na lista; anexo carrega do MinIO; 0 erro de
  console. Mesma régua dos Passos 2/3.

## Execução

Fatia grande → **subagent-driven development** (como o Passo 3): unidades independentes,
cada uma com spec + quality review. O prettier órfão do `App.tsx` + o `eas.json` local
(URL ngrok real, nunca commitada) vêm junto na branch.
