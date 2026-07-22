# SWI Admin — Tarefas (UI) + primeira integração real com o backend — design

> Contrapartida da fatia `feat/backend-tarefas` (PR #39): aquela entregou a API
> `/work-orders`; esta entrega as **4 telas do painel admin** que a consomem.
> **Marco adicional:** é a **primeira tela do `swi-admin` a falar com o backend
> real** — o resto do site roda 100% em mock desde S1. Destravada pelo DS
> 0.1.114 (PR #40), que consertou a build de produção vermelha.

## Contexto

O `swi-admin` nasceu como demo pixel-perfect: `DATA_BACKEND = 'mock'`
(`src/services/dataBackend.ts`), `mockApi/` in-memory, login que aceita
qualquer credencial, `DemoBanner` no topo de toda tela autenticada. O backend
Nest existe, está completo (7 domínios + hardening + tarefas) e roda em Docker,
mas **o site nunca falou com ele** — só o app mobile fala.

O usuário decidiu (2026-07-21) **começar o backend do site por aqui**: as telas
de Tarefas consomem a API real, e o login do admin passa a ser real.

### Telas (Figma, canvas Desktop)

| Node | Tela |
| --- | --- |
| `1606-11583` | Lista "Atividades em andamento" — busca, 3 abas, linhas com título/setor/progresso/avatares/pino, CTA "Nova Tarefa" |
| `1611-9071` | "Nova tarefa" — setor, tempo estimado, datas, título, resumo, detalhes, toggle Check List, anexos, CTA responsáveis |
| `1614-13773` | Modal "Selecionar responsáveis" — linhas com avatar/idade/tipo sanguíneo/cargo + checkbox |
| `1613-10013` | Detalhe — chip de status, Editar, autor, responsáveis, progresso, checklist, imagens |

## Decisões

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Fonte de dados | **Backend real**, sem caminho mock nestas telas. É o começo da migração do site pro backend próprio. |
| 2 | Login | **Só login real.** O form autentica contra `POST /auth/login` e **exige `role: ADMIN`**. O botão "Entrar como demo" e o `DemoBanner` **morrem** — com login real eles viram mentira. SignUp/Recovery seguem visuais (mock) até a frente de integração seguinte. |
| 3 | Copy do Figma | **Corrigida pra "tarefa".** As telas carregam resíduo de Relatórios ("Salvar relatório", "Detalhes do relatório:", "…ao seu relatório, eles revisaram e farão comentários") + um label solto `description`. A implementação vira a referência; o Figma se ajusta depois. |
| 4 | Formação do responsável | **Não existe no backend.** `toWorkerDto` devolve `{ id, name, jobTitle, sector, birthDate, avatar }`. A 2ª linha do card exibe **`sector`** no lugar da "formação" do Figma. Formação real = campo de cadastro numa frente futura. |
| 5 | Tipo sanguíneo | **Decorativo** (Decisão 2 da fatia backend — saúde fica mock até a smartband). Mesmo padrão do `ResponsablesModal` atual (ícone `humidity_mid` como gota). |
| 6 | Modal de responsáveis | **Overlay local do form**, não rota. O `/modals/responsables` existente seleciona **admins** pro fluxo de Relatórios e **não devolve a seleção** (é demo) — aqui a seleção precisa voltar pro form. O modal-rota de Relatórios fica **intocado**. |
| 7 | Tela de edição | O Figma não desenhou uma. **Reuso do form** pré-preenchido em `/tasks/:id/edit` → `PATCH`. Gap de design assumido e registrado. |
| 8 | Pino da lista | Navega pro **mapa geral** (`/maps/general`), mesmo destino de todos os outros pinos do admin. Não existe rota por setor, e a Decisão 3 da fatia backend já descartou localização por tarefa. |
| 9 | Busca | **Filtro client-side** por título/setor sobre a página corrente (o backend não tem busca; cap de 200 herdado do H3b). |

## Pré-requisito — mini-branch backend

Branch `fix/backend-admin-integration-prereqs` (PR próprio, pequeno, mergeado
antes):

1. **CORS.** O Nest hoje só tem CORS no gateway WebSocket
   (`realtime.gateway.ts`); o HTTP não tem `app.enableCors`. Sem isso o browser
   bloqueia toda chamada do site. Origins por env (`CORS_ORIGINS`, default
   `http://localhost:5173`), `credentials: false` (o token vai no header).
2. **`createdAt` no detalhe.** O Figma mostra "Data de criação"; o
   `toDetailDto` não devolve o campo. Adição de 1 linha + expectativa no spec.

## Arquitetura (swi-admin)

### Camada de rede — `src/services/api/`

- `http.ts` — wrapper de `fetch`: base URL de `VITE_API_URL`
  (default `http://localhost:3000`), injeta `Authorization: Bearer`, parseia
  erro do Nest (`{ message }`), **401 → derruba a sessão e redireciona pro
  login**. Ponto único de política de erro pros domínios futuros.
- `workOrders.ts` — `list(status)`, `get(id)`, `create(dto)`, `update(id, dto)`,
  `assignable()`. Tipos espelham os DTOs reais do backend.
- `upload.ts` — `POST /media/presign` (prefix `order`) → POST multipart pro
  MinIO/S3 (**fields primeiro, `file` por último** — requisito do S3 POST) →
  devolve a key. As keys devem casar `^order/<uuid>\.(jpg|png)$`.

### Auth real

`services/auth.ts` passa a chamar `POST /auth/login`; decodifica o payload do
JWT e **rejeita `role !== 'ADMIN'`** ("acesso restrito a administradores").
Token + user em `localStorage`; `useAuth`/`RequireAuth` passam a exigir essa
sessão; logout limpa. `RequireAuth` perde o `DemoBanner`.

### Páginas — `src/pages/tasks/`

| Rota | Tela |
| --- | --- |
| `/tasks` | Lista. Abas mapeiam o enum: **A Fazer**=`pending`, **Em Andamento**=`in_progress` (default), **Concluídas**=`done`; cada troca refaz `GET /work-orders?status=`. Linha: ícone, título+setor, barra de progresso, cluster de avatares (+N via `responsibleCount`), pino. "Nova Tarefa" → `/tasks/new`. |
| `/tasks/new` | Form. Toggle Check List revela a lista de itens `{título, texto curto}`; "Atribuir responsáveis" abre o overlay; Anexos com upload real; "Salvar tarefa" → `POST` → navega pro detalhe criado. |
| `/tasks/:id` | Detalhe. Chip de status, Editar, autor, responsáveis (cards + "Ver Todos"), progresso, checklist (radio preenchido = `done`), imagens presigned. |
| `/tasks/:id/edit` | Form pré-preenchido → `PATCH` (itens existentes vão **com `id`** — reconciliação do backend). |

Sidebar ganha o item **"Tarefas"** (o Figma o mostra ativo nas 4 telas).

### Validação do form

Espelha o que o backend impõe, pra falhar cedo e com mensagem boa:
título obrigatório (≤200), **≥1 responsável** (`ArrayNotEmpty` no DTO),
≤50 itens, ≤20 anexos, datas em formato de calendário válido.

## Design system

Tudo com componentes DS **como estão** + `useTheme()`; zero hardcode.
Auditoria dos ícones necessários contra `icons/paths.ts`: `assignment`
(sidebar), `build` (linha), `location_pin`/`location_on`, `cloud_upload`,
`add_circle`, `edit`, `search`, `humidity_mid`, `check`/`close` — **todos já
existem**. Nenhum bump previsto; se a fidelidade acusar glifo divergente, aí
sim mini-bump com **SVG exportado do Figma** (regra de ícones).

## Testes e verificação

- **Vitest + RTL por página**, com a camada `services/api` mockada (padrão dos
  43 suites atuais): abas trocam a query e repintam; criação com e sem
  checklist; bloqueio sem responsável; overlay seleciona e devolve ids; detalhe
  renderiza checklist/progresso/imagens; edição manda `id` dos itens; 401
  derruba a sessão; login com `role: WORKER` é rejeitado.
- **Gates:** `tsc -b`, `vite build` (verde desde o 0.1.114), suite completa.
- **Fidelidade visual** contra o Figma, tela a tela, antes de dar por pronta.
- **Smoke real** com o stack Docker de pé: login admin → cria tarefa com
  checklist e anexo → aparece na aba certa → worker vê os itens no app → detalhe
  reflete progresso.

## Não-objetivos

- Migrar os outros domínios do site pro backend real (cada um na sua frente).
- Tempo real na lista (WebSocket existe, mas fora de escopo aqui).
- Paginação por cursor (diferido global; cap 200 do H3b vale).
- SignUp/Recovery reais, push do SO, deploy AWS.
