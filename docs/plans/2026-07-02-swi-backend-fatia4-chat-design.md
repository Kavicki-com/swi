# SWI Backend — Fatia 4: Chat (design)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Fatia 4 da rodada dos domínios não-saúde
> (`2026-07-02-swi-backend-dominios-nao-saude-design.md`). Sucede as fatias 0
> (Fundação, PR #23), 1 (Perfil, PR #25), 2 (Relatórios + MinIO, PR #26) e 3
> (Jornada/Tarefas, PR #27). O **seam mobile** consumido aqui nasceu do design
> Amplify-era `2026-06-23-swi-backend-chat-design.md` (mock + amplify atrás de
> flag); esta fatia é o **contraponto backend real** (NestJS/Prisma/MinIO +
> WebSocket), trocando o stub `amplifyChatBackend` por `apiChatBackend`.
>
> **É a fatia que introduz a infra nova da rodada: o gateway WebSocket real-time.**

## Contexto

Os models `Conversation` e `Message` já existem (Fatia 0). O seam mobile de Chat
já está pronto da era Amplify: `ChatBackend` (7 membros), `ChatProvider`,
`chatReducers` puros (testados), telas `inbox`/`[userId]`, e `getChatBackend`
**pinado em mock** (ignora `DATA_BACKEND`). A infra de mídia (MinIO +
`MediaService` presign + `uploadMedia`) já existe da Fatia 2. Esta fatia constrói
o lado servidor NestJS — **incluindo um gateway WebSocket** para o push real-time
— e troca o stub pinado por um cliente REST+socket `apiChatBackend`, destravando o
selector para `'api'`.

Contrato mobile (intocado):

```
readonly myId: string
listConversations(): Conversation[]
listMessages(conversationId): Message[]
listDirectory(): Contact[]
sendMessage(conversationId, body, imageUri?): Message   // cria-ou-anexa
markRead(conversationId): void
subscribe(conversationId | null, cb): () => void          // real-time push
```

**Sem CRUD de contato** (o diretório é derivado dos Users aprovados). O `Contact`
do Amplify morreu (decidido na Fatia 0): diretório = query sobre `User` com os
campos de exibição do `Profile` (`sector`/`jobTitle`/`avatarKey`).

Observações do seam que travam decisões de design:
- O `ChatProvider` lê **`backend.myId` de forma síncrona** (na construção) e só
  chama **`subscribe(null, …)`** (canal global do inbox). A tela `[userId]` não
  chama `subscribe` diretamente — consome o provider. Logo o transporte só precisa
  entregar "todas as minhas mensagens" a um canal por-usuário; o filtro por
  `conversationId` do contrato é honrado no wrapper do seam.
- `ChatProvider.send()` **ignora o retorno** de `sendMessage` e faz o append da
  bolha **só via `subscribe`** → o servidor deve emitir o evento **também para o
  remetente** (exatamente 1 append, sem duplicar).

## Real-time (o coração da fatia)

Transporte escolhido: **WebSocket gateway com socket.io** (`@nestjs/websockets` +
`@nestjs/platform-socket.io`), anexado **ao mesmo servidor HTTP (porta 3000)** —
sem porta nem túnel novo (ao contrário do MinIO). JWT verificado no **handshake**.

Alternativas descartadas: **polling REST** (não é push — contradiz o "real-time"
que é a feature-título da rodada; não reusa pra Notificações) e **SSE** (RN não
tem `EventSource` nativo — exigiria polyfill; one-way; diverge da escolha travada
no design da rodada). socket.io ainda dá **fallback automático** se o upgrade WS
falhar (relevante sob ngrok/proxy no QA).

O gateway vive num módulo próprio (`src/realtime/`) para a **Fatia 5
(Notificações) reusá-lo** — o design da rodada já previu "chat + notificações num
gateway só".

## Decisões (2026-07-02)

| Tema | Decisão |
| --- | --- |
| **Transporte** | WebSocket gateway (socket.io) na mesma porta 3000; JWT no handshake; sala `user:<userId>` por conexão. |
| **Emissão** | Em `sendMessage`, após persistir, emite `message` para as salas de **todos os participantes, inclusive o remetente** (paridade com o append-via-subscribe do provider). |
| **`myId` síncrono** | Singleton em memória `services/api/session.ts` (`setUserId`/`getUserId`), populado no `apiAuthBackend.signIn` e no `getCurrentUser` com `user.id`. `apiChatBackend.myId` lê dele. **ChatProvider/telas intocados.** |
| **Diretório** | `User` com `approvalStatus=APPROVED AND role=WORKER`, **exceto eu** → `Contact{workerId:user.id, name, sector, role:jobTitle, avatarUri:presign(avatarKey)}`. |
| **`id` da conversa** | Determinístico `[a,b].sort().join('#')` (contrato do client, `conversationKey`). Garante idempotência de "abrir conversa com fulano". |
| **Create-or-attach** | `sendMessage` num id determinístico ainda **sem** conversa **cria** a conversa lazy a partir dos 2 profiles (snapshots denorm), depois anexa a mensagem. Espelha `createLazy` do mock. |
| **Ownership** | Conversa/mensagens escopadas a `participants ∋ req.user.userId` → **404** (não 403, pra não vazar existência). Paridade com a Jornada. |
| **`markRead`** | Zera `unreadByJson[meuId]` no servidor. **Sem broadcast** (unread é por-viewer; o do outro sobe quando ele recebe o `message`). |
| **`unread` / `lastMessage`** | Derivados no cliente pelos `chatReducers` (`applyMessage`) a partir do `message` recebido — o servidor persiste o snapshot mas o real-time carrega só a `Message`. |
| **Fotos** | Reusa a mídia da Fatia 2 com prefixo **`chat/`**: `uploadImage(uri,'chat')` → `POST /chat/conversations/:id/messages { imageKey }`. |
| **Seed = Opção A (fidelidade Figma)** | Seed cria ~8 workers aprovados (+Profile) e semeia as conversas/mensagens do mock (histórico do Romulo, badges de não-lido). Inbox abre populado igual ao Figma. |

## Arquitetura

Espelha as Fatias 1–3: módulo Nest `controller → guard JWT → service → Prisma`,
reusando `MediaModule` (presign). **Sem schema change, sem serviço novo no
compose** (o WS sobe no mesmo processo/porta da API).

### Backend — `src/realtime/`
- `realtime.gateway.ts`: `@WebSocketGateway()` implementando `OnGatewayConnection`.
  No connect: lê `client.handshake.auth.token` (fallback `Authorization` header),
  verifica com `requireJwtSecret()` (mesmo segredo do REST); em sucesso guarda
  `userId` no socket e entra na sala `user:<userId>`; em falha `client.disconnect()`.
  Expõe `emitToUsers(userIds: string[], event: string, payload: unknown)`.
- `realtime.module.ts`: provê e **exporta** `RealtimeGateway`.

### Backend — `src/chat/`
- `ChatController` (`@UseGuards(JwtAuthGuard)`), rotas resource-style:

  | Contrato | Rota | Retorno |
  | --- | --- | --- |
  | `listConversations` | `GET /chat/conversations` | `Conversation[]` (minhas, recência) |
  | `listMessages` | `GET /chat/conversations/:id/messages` | `Message[]` (404 se não-membro) |
  | `listDirectory` | `GET /chat/directory` | `Contact[]` |
  | `sendMessage` | `POST /chat/conversations/:id/messages` | `Message` (create-or-attach) |
  | `markRead` | `POST /chat/conversations/:id/read` | 204 |

- `ChatService` (injeta `PrismaService`, `MediaService`, `RealtimeGateway`):
  - `listConversations(userId)`: `findMany` where `participants has userId`,
    ordena por `lastMessageAt desc` (nulls por último), `Promise.all(toConvDto)`.
  - `listMessages(userId, convId)`: valida membership (404), `findMany` por
    `conversationId` ordenado por `sentAt asc`, `Promise.all(toMsgDto)`.
  - `listDirectory(userId)`: `user.findMany` aprovados/worker exceto eu, `toContact`.
  - `sendMessage(userId, convId, {body?, imageKey?})`: valida que `userId` é membro
    do `convId` (o id determinístico contém o meu id); `upsert` da conversa
    (create-or-attach — cria dos 2 profiles se ausente), `message.create`, atualiza
    `lastMessageBody`/`lastMessageAt`/`unreadByJson` (incrementa o do destinatário),
    `emitToUsers(participants, 'message', dto)`, retorna o dto.
  - `markRead(userId, convId)`: membership → zera `unreadByJson[userId]`.
  - `toConvDto` **async** (`participantAvatarKeys → presignGetMany`, `unreadByJson →
    unreadBy`, datas ISO, `null→''`/`{}`); `toMsgDto` **async** (`imageKey →
    presignGet | null`, `sentAt` ISO); `toContact` (`avatarKey → presignGet | ''`).
- `dto.ts`: `SendMessageDto` (class-validator) — `body?` string opcional,
  `imageKey?` opcional com `@Matches(/^chat\/[0-9a-f-]{36}\.(jpg|png)$/)`
  (anti-abuso, igual reports/task); **pelo menos um dos dois** (validação custom).
- Registrar `ChatModule` (imports `MediaModule`, `RealtimeModule`) e `RealtimeModule`
  em `app.module.ts`.

### Backend — `src/media/` (extensão mínima)
- `PresignDto.prefix` passa a aceitar `reports | task | chat` (backward-compat).

### Backend — `prisma/seed.ts` (Opção A)
- Semeia **~8 workers aprovados** (`romulo@swi.local`, …) com `Profile`
  (`sector`/`jobTitle`/`avatarKey`), espelhando o `DIRECTORY` do mock.
- Sobe os avatares demo (`mobile/assets/avatars/worker-{1..8}.png`) pro bucket
  `swi-media` sob `chat/avatars/worker-N.png`; grava a key em cada Profile.
- Semeia as **conversas + mensagens** dos `THREADS` do mock (Romulo com histórico
  completo; demais com 1–3 msgs), `id` determinístico, `unreadByJson` com o badge.
- Idempotente (upsert por email/`id` de conversa). Mesmo **guard MinIO** da Jornada
  (credencial/bucket inacessível → loga e segue com `avatarKey` vazio).

### Mobile — `services/chat/`
- `apiChatBackend.ts` (+test): implementa `ChatBackend`.
  - `myId`: `getUserId()` do singleton de sessão.
  - `listConversations`/`listMessages`/`listDirectory`/`markRead`: `apiRequest({auth})`.
  - `sendMessage(convId, body, imageUri?)`: se `imageUri`, `uploadImage(uri,'chat')`
    → `imageKey`; `POST …/messages {body, imageKey}`. Server devolve `Message` pronto.
  - `subscribe(convId, cb)`: conecta `socket.io-client` de forma assíncrona por
    dentro (lê token do SecureStore → `io(API_URL,{auth:{token},transports:['websocket']})`),
    `socket.on('message', m => { if (convId===null || m.conversationId===convId) cb(m) })`;
    retorna unsub síncrono (`() => socket.close()`).
- `services/api/session.ts` (novo): singleton `setUserId`/`getUserId` em memória.
- `apiAuthBackend.ts`: `signIn` e `getCurrentUser` chamam `setUserId(user.id)`.
- `getChatBackend.ts`: passa a honrar `DATA_BACKEND` (igual `getReportsBackend`/
  `getJourneyBackend`). Teste atualizado (espera api quando `flag=api`).
- **Deletar `amplifyChatBackend.ts`** (aposentado, igual as fatias anteriores).

## Fluxo de dados

```
# envio + real-time
app -- POST /chat/conversations/:id/messages {body,imageKey?} --> ChatService
        persiste (create-or-attach) + bump unread/lastMessage
        └─> RealtimeGateway.emitToUsers([a,b], 'message', msgDto)
              └─> socket 'message' --> subscribe(null,cb) de cada cliente
                    └─> applyMessage (unread++, reordena) / append na thread aberta

# recepção (outro worker conectado)
outro socket recebe 'message' --> inbox e thread atualizam ao vivo, sem polling

# foto (reusa fundação Fatia 2)
app -- POST /media/presign {contentType, prefix:'chat'} --> {url, key: chat/<uuid>.jpg}
app -- PUT bytes --> MinIO
app -- POST /chat/conversations/:id/messages {imageKey} --> Message (imageUri presigned)
```

## Tratamento de erros

Corpo consistente `{statusCode, message}` (padrão auth/profile/reports/journey).
`apiRequest` já anexa `.status`. Acesso a conversa/mensagens de que não sou membro
→ **404**. `sendMessage` sem `body` nem `imageKey` → **400** (validação custom).
`imageKey` de outro prefixo → **400** (regex do DTO). Handshake WS sem token válido
→ `disconnect` (o cliente apenas não recebe pushes; as leituras REST seguem). Falha
de socket no cliente é silenciosa (o inbox ainda carrega via REST; degrada pra
"sem tempo-real", não quebra a tela).

## Testes + verificação (disciplina da rodada)

- **Backend**:
  - unit `chat.service.spec` (Prisma + Media + Gateway mockados): create-or-attach
    (cria lazy vs anexa), membership 404 em list/send/markRead, bump de unread,
    `toConvDto`/`toMsgDto`/`toContact` (presign, null-coalesce, datas ISO), diretório
    (aprovados/worker exceto eu), `emitToUsers` chamado com os participantes certos.
  - unit `realtime.gateway.spec`: connect com token válido entra na sala e com token
    inválido desconecta; `emitToUsers` roteia pras salas certas (server mockado).
  - e2e `chat.e2e-spec` (supertest vs Postgres real, workers throwaway): 401 sem
    token; `listDirectory` traz o outro worker; `sendMessage` cria a conversa e
    aparece em `listConversations`/`listMessages`; `markRead` zera o unread; 404 de
    não-membro; 400 de mensagem vazia. (Presign reusa o endpoint da Fatia 2 — não
    precisa MinIO up pro e2e.)
  - **docker smoke (o que tsc/jest não provam)**: stack up; **dois clientes
    socket.io** (workerA + workerB) conectam com JWT; workerB manda `POST …/messages`;
    **workerA recebe o evento `message` pelo socket** (prova do push real-time);
    foto: presign `chat/` → PUT → message com `imageKey` → a URL da imagem responde
    200. Seed verificado: diretório + inbox populado via API.
- **Mobile**: jest (`apiChatBackend` REST com fetch mockado; `subscribe` com
  `socket.io-client` mockado — evento entregue chama o cb, filtro por convId;
  `getChatBackend` honra a flag; `session` singleton), tsc **0 novos** (8 baseline),
  expo export web exit 0.
- **Two-gate** (spec-compliance + quality subagents) + review holística; commit
  **só com luz verde explícita** do usuário; PR contra `main`; **sem rastros de IA**.
- Teste manual no dev build (`EXPO_PUBLIC_DATA_BACKEND=api`): abrir inbox populado,
  abrir a thread do Romulo, enviar mensagem, anexar foto; (real-time visível com um
  2º cliente — device+emulador, ou o smoke de 2 sockets).

## Não-objetivos / notas

- **Sem bot de eco** — o outro lado não responde sozinho (paridade com o mock; o
  real-time é provado pelos 2 sockets do smoke, não por um respondedor sintético).
- **Sem CRUD de contato/diretório** (derivado de Users aprovados).
- **Sem paginação** de mensagens/conversas (dia/thread inteiros) e **sem presença/
  digitando/entregue-lido** (fora do contrato do seam).
- **Sem push de SO** (`expo-notifications`/SNS) — Fatia 5+; o socket só entrega
  in-app com o app aberto.
- **Saúde/vitals intocado** (mock permanente até a smartband).
- **Hardening DEFERIDO** (categoria dos #1/#3 da Fatia 3 — melhorias de backend-real que o
  mock não tem; follow-up, não bloqueiam a fatia fiel ao mock): `sendMessage` no path
  create-or-attach tem TOCTOU — se os 2 participantes mandam a 1ª mensagem concorrentemente,
  o 2º `conversation.create` bate no unique do `id` (Prisma `P2002`) e vira 500 com a
  mensagem perdida. Fix futuro: `upsert` (INSERT … ON CONFLICT atômico) ou catch de `P2002`
  → retry como attach. (O shape do id já é validado: canônico + 2-partes + ambos users reais → 404.)
- **Deploy** (herança da rodada): WS atrás do ALB exige sticky sessions / adaptador
  (Redis) se >1 réplica ECS; MinIO→S3; `chat/avatars` do seed vira fixture/IaC;
  segredo JWT via SSM. Mapeado, pós-testes.
