# Design — Chat real no painel admin (Passo 3)

**Data:** 2026-07-23
**Fatia:** Passo 3 do roadmap admin-backend (ver `project_swi_admin_backend_roadmap` na memória)
**Branch:** `feat/backend-admin-chat` (de `origin/main`)

## Problema

O chat do admin é 100% mock em duas superfícies: a página `ChatInbox.tsx` (lista + thread + envio, com `handleSend` que só faz append local) e o painel `ChatSection` do DS na sidebar/drawer do `AppLayout` (alimentado por um const hardcoded `CHAT_USERS`). Não existe nenhum socket no admin. O backend, porém, está **100% pronto** — REST de chat + `RealtimeGateway` socket.io, já usados pelo mobile.

## Decisões (do brainstorming)

1. **Escopo UI: inbox + sidebar** — as duas superfícies ficam reais, servidas por um `ChatProvider` compartilhado (badges e lista vivem num só estado).
2. **Sem seed novo:** o inbox do admin abre **vazio** e a conversa nasce ao vivo pelo directory ("Novo Chat" → workers aprovados). Nenhuma mudança no seed.
3. **Anexo de imagem incluído:** upload (presign → MinIO → `imageKey`) + `POST {body?, imageKey?}` + bolha com imagem.
4. **Painel direito (ContactInfoPanel):** identidade real (nome/setor/cargo/avatar via directory); vitais/fadiga/mini-mapa **seguem mock** (bloqueados na smartband, decisão de projeto).

## Contrato do backend (já existente — não muda)

- **REST** (`JwtAuthGuard`, Bearer): `GET /chat/conversations`, `GET /chat/directory` (workers APPROVED, exceto self), `GET /chat/conversations/:id/messages`, `POST /chat/conversations/:id/messages` (`{body? ≤4000, imageKey? chat/<uuid>.(jpg|png)}`, 400 se ambos vazios), `POST /chat/conversations/:id/read` (204).
- **Socket.io** (mesmo host/porta da API, namespace/path default): auth por JWT no handshake (`auth.token`); server põe o cliente na room `user:<userId>`. Server **só emite**: `message` (MessageDto pra todos os participantes, incluindo o remetente) e `notification`. Nenhum evento client→server — toda escrita é REST.
- **Conversa:** id determinístico `[a,b].sort().join('#')`; criada lazy no primeiro send; `unreadBy: Record<userId, number>` por conversa. O `#` no id exige `encodeURIComponent` em toda URL.

## Arquitetura (porta do padrão do mobile, enxugada)

O mobile tem o padrão provado: `ChatBackend` interface + `ChatProvider` (context) + `chatReducers.ts` puro. O admin vai **100% real**, então sem o swap mock/backend — o provider fala direto com `services/api/chats.ts`. Segue o padrão facade→`api/` do roadmap (não ressuscita `amplifyApi`, não usa `DATA_BACKEND`).

### Novos arquivos (`swi-admin/src`)

- **`services/chat/chatReducers.ts`** — cópia do mobile (puro): `conversationKey`, `applyMessage`, `markRead`, `sortByRecent`, `unreadFor`, `resolveContact`.
- **`services/chat/types.ts`** — `Conversation`, `Message`, `Contact` (shapes do wire, iguais ao mobile).
- **`services/api/chats.ts`** — REST real no envelope `MockResponse` (padrão `api/users.ts`): `listConversations`, `listDirectory`, `listMessages(id)`, `sendMessage(id, {body, imageKey})`, `markRead(id)`. Helper `conv(id)` com `encodeURIComponent`.
- **`services/api/chatSocket.ts`** — `io(VITE_API_URL, { auth: { token: readToken() }, transports: ['websocket'] })`; expõe `subscribe(cb)` no evento `message` com cleanup; reconexão fica com o default do socket.io.
- **`services/chat/ChatProvider.tsx`** — context com `conversations`, `messagesByConv`, `directory`, `loadStatus`; `load()`, `openConversation(id)` (fetch thread + markRead REST + otimista), `send(id, body, imageKey?)`, `keyFor(workerId)`. Listener do socket: `applyMessage` se a conversa é conhecida; refetch da lista se desconhecida (thread novo); auto-markRead se a mensagem chega no thread aberto e não é minha. Mirror ref das conversas pra evitar stale closure (igual mobile).

### Superfícies alteradas

- **`ChatInbox.tsx`** — troca `chatsApi.list()` mock + `handleSend` local pelo provider. Um **mapeador** DTO→`ChatContact`/`ChatMessage` preserva o contrato que a UI já consome (quase zero mudança visual). Lista esquerda = conversas reais + entrada "Novo Chat" com o directory. Envio: upload de imagem (se houver) → `POST`; a mensagem volta pelo socket (**sem append otimista** — evita dedup, igual mobile). Painel direito: identidade do directory; vitais mock.
- **`AppLayout.tsx`** — `CHAT_USERS` const → dados do provider (conversas reais com `unreadCount` de `unreadBy[myId]`) alimentando o `ChatSection` do DS como está.
- **`main/App`** — `ChatProvider` montado acima de `AppLayout` + rotas de chat (uma instância pra ambas superfícies).

### Auth

Token: `readToken()` (localStorage `swi.admin.token`, já usado pelo `apiFetch`). Meu id: `useAuth().user.id`. Socket conecta quando o provider monta (sessão logada) e fecha no unmount; 401 REST já dispara `clearSession()`.

## Fluxos

1. **Load:** provider monta → `Promise.all([listConversations, listDirectory])` → `ready`/`empty`/`error`.
2. **Abrir thread:** `listMessages(id)` → cache `messagesByConv`; `markRead(id)` REST + zera `unreadBy[myId]` otimista.
3. **Enviar:** (imagem? upload presign→MinIO→`imageKey`) → `POST …/messages` → servidor persiste + emite `message` a todos (inclusive eu) → listener aplica → UI atualiza.
4. **Receber ao vivo:** evento `message` → `applyMessage` (lastMessage, unread++, re-sort) nas duas superfícies; conversa nova → refetch lista.
5. **Novo chat:** directory → `keyFor(workerId)` → navega pro thread (vazio) → primeiro send cria a conversa no servidor.

## Erros

- REST falha no load → `loadStatus: error` + toast; retry manual.
- Envio falha → toast com a mensagem do backend; draft preservado.
- Socket cai → auto-reconnect do socket.io; mensagens perdidas no gap são recuperadas ao reabrir o thread (fetch) — sem replay/gap-fill nesta fatia (não-objetivo).
- 401 → `clearSession()` existente (REST); socket desconectado pelo server em token inválido.

## Testes (TDD)

- **Reducers:** `applyMessage` (lastMessage/unread/sort), `markRead`, `unreadFor`, `conversationKey`.
- **`api/chats`:** URLs (+`encodeURIComponent` do `#`), métodos, envelope, erro de rede/4xx.
- **Mapeadores:** DTO→`ChatContact`/`ChatMessage` (incl. `imageUri`).
- **Provider (socket mockado):** evento `message` conhecido → estado atualiza; desconhecido → refetch; thread aberto → auto-markRead.
- **Gate:** vitest + tsc + vite build (admin). Backend intocado.
- **Ao vivo (Playwright, 2 sessões):** admin inicia conversa via directory, envia texto + imagem, a mensagem volta pelo socket e renderiza; worker (via API) responde → badge sobe na sidebar; abrir o thread zera o badge. 0 erros de console.

## Não-objetivos

- Vitais/fadiga/mini-mapa reais no painel direito (smartband).
- Seed de conversas do admin.
- Replay/gap-fill de mensagens perdidas em desconexão prolongada.
- Chat em grupo; edição/exclusão de mensagem (backend não tem).
- Notificações push do domínio chat na UI do admin (evento `notification` fica pra fatia de Alertas).
