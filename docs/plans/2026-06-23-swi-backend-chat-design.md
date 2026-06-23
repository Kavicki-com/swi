# SWI Backend — Fatia Chat

> Doc **temporário** (deletar quando o backend inteiro estiver pronto).
> Terceira fatia do roadmap pós-pivô — ver `2026-06-22-swi-backend-roadmap-design.md`.
> Branch: `feat/backend-chat` (stacked em `feat/mobile-login`).

## Escopo

Backend real do **chat** no app do worker (mobile): ver as conversas (inbox com
preview + não-lidas), abrir uma thread e **trocar mensagens em tempo real**,
anexar imagem, e iniciar conversa nova a partir de um **diretório de contatos**.
Três models no `swi-backend`, Abordagem A (mock+amplify atrás da flag
`AUTH_BACKEND`, `tsc`+`jest` verdes, deploy-gated). Wiring do swi-admin fica pro
hardening.

A **feature-título** desta fatia é o **real-time** (AppSync subscriptions) — o
análogo ao "progresso real" da Jornada. Como ainda não existe conta AWS, o
*shape* real-time é honesto no código (seam `subscribe()`), o path amplify é um
stub deploy-gated, e o path mock implementa um **event-bus em memória** que faz a
thread e o inbox atualizarem ao vivo — testável de ponta a ponta.

## Decisões (travadas com o usuário 2026-06-23)

1. **Real-time = seam `subscribe()` + mock com bus vivo.** A interface expõe
   `subscribe(convId, cb): () => void`; o amplify mapeia pra
   `Message.onCreate({ filter })` (stub que lança "deploy-gated" até deploy); o
   mock usa um event-bus em memória — `sendMessage` faz append + emite, a thread
   (subscrita em `convId`) e o inbox (subscrito num canal global) atualizam ao
   vivo. **Sem** replier simulado (nada de "outro worker" respondendo sozinho).
2. **Auth participant-scoped.** Chat é privado 1:1 (diferente do `Report`, que é
   `authenticated().read` compartilhado). `Conversation.participants: string[]`
   com `allow.ownersDefinedIn('participants')`; `Message` denormaliza
   `participants` e usa a mesma regra; admin full. Privacidade real desde o shape,
   sem dívida field-level.
3. **Diretório de contatos é um model próprio (`Contact`).** Além de
   `Conversation`/`Message`, um roster leve e **não-sensível**
   (workerId/name/sector/role/avatarKey) com `allow.authenticated().to(['read'])`
   — diferente de `Profile`, que é owner-only por carregar CPF/endereço. "Novo
   Chat" busca no `Contact`. A **fonte real** do diretório (sync de
   Profile/Cognito) fica pro hardening; o mock semeia os 15 workers do array atual
   do inbox.
4. **Estado por-viewer numa única `Conversation` (json + arrays paralelos).** Uma
   conversa é compartilhada pelos 2 participantes, mas `unreadCount` e "quem é o
   contato" diferem por quem olha. Resolvido com `unreadByJson` (map `sub→count`)
   + arrays paralelos de snapshot (`participantNames`/`Subtitles`/`AvatarKeys`); o
   cliente deriva "o outro" + meu unread. **3 models**, sem join. Um model-join
   `ConversationParticipant` fica como refino do hardening (YAGNI agora, espelha o
   "Interessados" denormalizado da Jornada).
5. **Anexo de imagem via S3 (dentro do escopo).** `Message.imageKey` opcional; o
   attach picker (já na tela `[userId]`) passa a enviar de fato. Mesmo padrão S3
   de Relatórios/Jornada — bucket `swiMedia`, prefixo `chat/`. Mock = uris locais.
6. **Criação lazy de conversa (dentro do escopo).** "Novo Chat" → escolhe contato
   do diretório → abre a thread; a `Conversation` só é criada no **1º envio**
   (`sendMessage` cria-ou-anexa). Sem conversas vazias poluindo o inbox.

## Real-time (mecânica)

- **mock:** bus em memória — `Map<conversationId, Set<cb>>` + um canal global pro
  inbox. `sendMessage(convId, body, imageUri?)`:
  1. cria a `Message` (senderId = eu, sentAt = now);
  2. atualiza a `Conversation`: `lastMessageBody`/`lastMessageAt` + incrementa
     `unreadByJson[recipient]`, re-ordena por recência;
  3. **emite** pro canal de `convId` (thread faz append) e pro canal global
     (inbox atualiza preview/badge).
  `subscribe(convId, cb)` registra e devolve o unsubscribe. Fonte única de verdade
  (o próprio sender renderiza a partir do estado atualizado pelo bus — sem echo
  duplo).
- **amplify:** `subscribe` mapeia pra
  `client.models.Message.onCreate({ filter: { conversationId: { eq } } })`
  (ou `observeQuery`); **stub que lança "deploy-gated"** até existir conta (igual
  `amplifyJourneyBackend`). `imageKey` via `uploadData`/`getUrl`.
- **`chatReducers.ts` (puro, TDD)** — análogo ao `progress.ts` da Jornada:
  - `applySent(conversations, msg)` / `applyIncoming(conversations, msg, mySub)` —
    bump `lastMessage*` + incrementa unread do recipient + re-sort por recência;
  - `markRead(conversations, convId, mySub)` — zera `unreadByJson[mySub]`;
  - `resolveContact(conversation, mySub)` — acha o participante que não-sou-eu
    (name/subtitle/avatar) p/ o card do inbox e o header da thread;
  - `unreadFor(conversation, mySub)` — lê `unreadByJson[mySub] ?? 0`.
  `mySub`/`nowMs` injetáveis; testado isolado.

## Modelos (`swi-backend/amplify/data/resource.ts`)

```
Conversation
  participants           string[] required    // [meSub, themSub] (Cognito subs)
  participantNames       string[]             // snapshot denorm paralelo (sem join)
  participantSubtitles   string[]             // "Setor Leste"
  participantAvatarKeys  string[]             // avatar keys (uris no mock)
  lastMessageBody        string               // preview do inbox (compartilhado)
  lastMessageAt          datetime             // ordenação do inbox
  unreadByJson           json                 // { [sub]: count } — unread POR-viewer

  auth:
    allow.ownersDefinedIn('participants')
    allow.group('admin')

Message
  conversationId         string required      // FK lógico (lista por conversationId; sem hasMany)
  participants           string[] required    // denormaliza p/ ownersDefinedIn
  senderId               string required      // autor (define me/them na bubble)
  body                   string               // texto (pode ser vazio se só imagem)
  imageKey               string               // anexo S3 opcional (uri no mock)
  sentAt                 datetime required    // ordenação + "time" da bubble

  auth:
    allow.ownersDefinedIn('participants')
    allow.group('admin')

Contact   (diretório leve p/ "Novo Chat")
  workerId               string required      // Cognito sub
  name                   string required
  sector                 string               // → subtitle do card
  role                   string               // "Operador de escavadeira" (header user-info)
  avatarKey              string

  auth:
    allow.authenticated().to(['read'])        // roster público não-sensível
    allow.group('admin')                      // admin popula/gerencia
```

Notas:
- **Sem `hasMany`** — mensagens listadas por `conversationId`; conversas por
  participante (filtro client/`ownersDefinedIn`). Evita join (igual `activities`
  dos Relatórios / `assignedTo` da Jornada).
- **`unreadByJson` é json** porque o unread é inerentemente por-viewer; o cliente
  faz `unreadByJson[mySub]`. Arrays paralelos (`participantNames`/`Subtitles`/
  `AvatarKeys`) seguem o índice de `participants` — `resolveContact` pega o índice
  do outro.
- **Caveat de auth (documentado, hardening):** `ownersDefinedIn('participants')`
  no `Message` deixa qualquer participante atualizar/apagar mensagem do outro
  (sem regra field-level por `senderId`). Pro demo deploy-gated é aceitável; regra
  fina entra na fatia 7. (Precedente: o caveat análogo da Jornada.)
- **`Contact` não substitui `Profile`** — é um roster não-sensível só p/
  descoberta. O diretório real (sync de Profile/Cognito) é hardening.

## Storage S3 (`swi-backend/amplify/storage/resource.ts`)

- Adiciono o prefixo `chat/{entity_id}/*` (authenticated read; owner write) ao
  `defineStorage` existente — **um bucket (`swiMedia`), três prefixos**
  (`reports/`, `journey/`, `chat/`).
- Amplify: `uploadData` → guarda key em `Message.imageKey`; leitura resolve url
  via `getUrl`. Mock: ignora S3, usa uris locais do `expo-image-picker`.

## Service mobile (`mobile/services/chat/`) — espelha `reports/`/`journey/`

- `types.ts` → `Conversation`, `Message`, `Contact`, e
  `ChatBackend { listConversations(): Promise<Conversation[]>; listMessages(convId): Promise<Message[]>; listDirectory(): Promise<Contact[]>; sendMessage(convId, body, imageUri?): Promise<Message>; startConversation(contactWorkerId): Promise<Conversation>; markRead(convId): Promise<void>; subscribe(convId, cb): () => void }`.
  `Conversation`/`Message` são espelhos locais (sem importar o `Schema` do
  backend; pós-deploy `ampx generate` pode substituir — Phase hardening).
- `chatReducers.ts` (+test) — funções puras descritas acima (TDD).
- `mockChatBackend.ts` (+test) — semeia o diretório (15 workers migrados do array
  do inbox) + ~8 conversas com histórico (mensagens migradas de `[userId]`);
  event-bus em memória; `sendMessage` append+emit+bump; `subscribe` registra
  listener; `markRead` zera unread; `startConversation` cria-lazy.
- `amplifyChatBackend.ts` — `generateClient<Schema>()` (Data) + Storage; `subscribe`
  → `onCreate`; **stub deploy-gated** (lança até existir conta).
- `getChatBackend.ts` (+test) — selector pela flag `AUTH_BACKEND` (mock|amplify),
  igual `getReportsBackend`/`getJourneyBackend`.
- `ChatProvider.tsx` — carrega `conversations` + `directory` no mount com máquina
  `loadStatus` (idle/loading/ready/empty/error); expõe `conversations`,
  `directory`, `messagesFor(convId)`, `sendMessage`, `markRead`,
  `startConversation`; **subscreve** p/ updates ao vivo (thread + inbox). Montado
  em `mobile/app/(app)/chat/_layout.tsx` (auth- e chat-scoped; subscriptions
  desmontam ao sair do Chat).

## Wiring das telas

- `chat/inbox.tsx` — troca o array `USERS` por `useChat().conversations` (card
  `ChatUserCard` mantém name+subtitle+unread, agora derivados de
  `resolveContact`/`unreadFor`; live via subscription); "Novo Chat" abre busca no
  `directory` → escolhe contato → `startConversation` + navega. Render
  loading/empty/error.
- `chat/[userId].tsx` — troca `MESSAGES` por `messagesFor(convId)` (o param
  resolve a conversa pelo participante, ou **cria lazy** no 1º envio);
  **subscribe** → mensagem nova entra ao vivo; `send` → `sendMessage`; `attach_file`
  → `imageKey` via S3; `markRead` ao abrir; me/them por `senderId === mySub`.
  Render loading/empty/error.
- `chat/user-info.tsx` — **fora do escopo de dados-de-chat** (é perfil/saúde/mapa
  = mock-até-smartband). Único toque possível: header (nome/role/avatar) lê do
  `Contact`; fadiga/mini-map/dados clínicos ficam mock.
- Estados compostos com o DS via novo `components/chat/ChatState.tsx` (espelha
  `components/journey/JourneyState.tsx`). **Sem inventar componente** (regra DS).

## Estados production-ready (igual Relatórios/Jornada)

- **loading** — placeholder enquanto busca.
- **empty** — inbox vazio ("nenhuma conversa"); thread vazia ("nenhuma mensagem
  ainda").
- **error** — mensagem + retry (falha de rede/backend).
- Compostos com o DS; sem inventar componente.

## Flag

Reuso `AUTH_BACKEND` (`mock`|`amplify`) como switch global mock/amplify (já liga
auth+profile+reports+journey). Generalizar o nome → switch único no hardening
(fatia 7).

## Não-objetivos da fatia

- **Read receipts por-mensagem** ("Visualizado"/duplo-check) — adiado (unread no
  nível da conversa **é** in-scope; o seen por-mensagem não).
- **Presença online/offline** real-time — adiado (igual a Jornada adiou presença;
  o ring ciano do avatar fica decorativo).
- **Chat em grupo** — só 1:1 nesta fatia.
- **Push de mensagem nova** (notificação fora do app) — fatia Notificações (SNS).
- **Fonte real do diretório** (sync Profile/Cognito) — hardening.
- **Wiring do swi-admin** (`mockApi` → Amplify) — hardening.
- **Deploy de produção** (sem conta AWS).

## Verificação (deploy-gated)

- `swi-backend`: `npx tsc --noEmit -p amplify` exit 0.
- `mobile`: `npx jest` (novos testes verdes — `chatReducers`, `mockChatBackend`,
  `getChatBackend`), `npx tsc --noEmit` sem erros novos (8 pré-existentes são
  baseline), `npx expo export --platform web` exit 0.
- Smoke visual dos estados (loading/empty/error) + thread/inbox atualizando ao
  vivo via flag mock — eyeball pendente até rodar `expo start` (igual
  Relatórios/Jornada/Fatia 3).

## Próximo passo

`writing-plans` → `2026-06-23-swi-backend-chat-plan.md` (fases + verificação),
depois implementação subagent-driven com two-gate review (igual Fatias 1/3/
Relatórios/Jornada). Merge só com OK explícito do usuário.
