import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { Conversation, Contact, Message } from './types';
import { getChatBackend } from './getChatBackend';
import { applyMessage, markRead as markReadReducer, conversationKey } from './chatReducers';
import { getSendQueue } from '../outbox/getSendQueue';
import type { EnqueueResult } from '../outbox/sendQueue';
import { useSendQueueEvent, useSendQueueState } from '../outbox/useSendQueue';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/**
 * Mensagem minha que ainda não é do servidor: aguardando envio na fila, ou
 * recusada. A tela a desenha depois do histórico, com o estado no lugar da hora.
 */
export interface OutgoingMessage {
  id: string;
  body: string;
  state: 'pending' | 'refused';
}

interface ChatContextValue {
  myId: string;
  loadStatus: LoadStatus;
  conversations: Conversation[];
  directory: Contact[];
  load: () => Promise<void>;
  messagesFor: (conversationId: string) => Message[];
  openConversation: (conversationId: string) => Promise<void>;
  /** Põe a mensagem na fila de envios. `full`: a fila está no teto e ela não entrou. */
  send: (conversationId: string, body: string, imageUri?: string) => Promise<EnqueueResult>;
  /** As minhas mensagens da conversa que ainda não são do servidor, na ordem. */
  outgoingFor: (conversationId: string) => OutgoingMessage[];
  keyFor: (contactWorkerId: string) => string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getChatBackend(), []);
  const myId = backend.myId;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [directory, setDirectory] = useState<Contact[]>([]);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({});
  const openConvRef = useRef<string | null>(null);
  // Espelho síncrono de `conversations` para o listener decidir, sem closure
  // velha, se a mensagem que chegou pertence a uma conversa já conhecida.
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const load = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const [cs, dir] = await Promise.all([backend.listConversations(), backend.listDirectory()]);
      setConversations(cs);
      setDirectory(dir);
      setLoadStatus(cs.length ? 'ready' : 'empty');
    } catch { setLoadStatus('error'); }
  }, [backend]);

  useEffect(() => { load(); }, [load]);

  // A fila de envios: o que aguarda sinal e o que o servidor recusou.
  const queueState = useSendQueueState();
  // Ids das mensagens do servidor já aplicadas. A mesma mensagem chega por dois
  // caminhos (a resposta do envio e o socket, que também entrega a quem enviou)
  // e o socket pode repetir a entrega ao reconectar: só a primeira conta.
  const seenRef = useRef(new Set<string>());
  // Item da fila → id da mensagem do servidor que já o representa na tela. O
  // socket costuma entregar a mensagem antes de a resposta do envio chegar;
  // nesse intervalo o balão pendente sai, para não aparecer ao lado dela.
  const [echoed, setEchoed] = useState<Record<string, string>>({});
  const echoedRef = useRef(echoed);

  // Aplica uma mensagem do servidor, venha do socket ou da resposta do envio.
  const receive = useCallback((msg: Message) => {
    if (seenRef.current.has(msg.id)) {
      // Mesmo id de novo: a segunda via de um envio (idêntica), ou a mensagem
      // editada ou apagada, que o backend avisa pelo mesmo evento com o estado
      // atual. Troca no lugar; não é mensagem nova nem conta como não lida.
      setMessagesByConv((prev) => {
        const thread = prev[msg.conversationId];
        if (!thread || !thread.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.conversationId]: thread.map((m) => (m.id === msg.id ? msg : m)) };
      });
      return;
    }
    seenRef.current.add(msg.id);
    // Conversa criada de forma lazy pelo sendMessage (1ª mensagem a um contato
    // novo) ainda não está no state: applyMessage seria no-op e a conversa
    // sumiria do inbox. Nesse caso buscamos a lista do backend (sem mexer no
    // loadStatus → sem flash de loading); senão aplicamos o reducer.
    const known = conversationsRef.current.some((c) => c.id === msg.conversationId);
    if (known) {
      setConversations((prev) => applyMessage(prev, msg));
    } else {
      backend.listConversations().then(setConversations).catch(() => {});
    }
    // Append ao histórico da thread aberta/carregada. Inclui a 1ª mensagem de
    // uma conversa nova (messagesByConv[convId] já foi inicializado no
    // openConversation, então o append roda mesmo no caso !known). Mensagem que
    // já veio no histórico não entra de novo.
    setMessagesByConv((prev) => {
      const thread = prev[msg.conversationId];
      if (!thread || thread.some((m) => m.id === msg.id)) return prev;
      return { ...prev, [msg.conversationId]: [...thread, msg] };
    });
    if (openConvRef.current === msg.conversationId && msg.senderId !== myId) {
      backend.markRead(msg.conversationId).catch(() => {});
      setConversations((prev) => markReadReducer(prev, msg.conversationId, myId));
    }
  }, [backend, myId]);

  /** Troca o mapa de ecos no estado e no espelho síncrono de uma vez. */
  const updateEchoed = useCallback((next: Record<string, string>) => {
    echoedRef.current = next;
    setEchoed(next);
  }, []);

  useEffect(() => {
    const unsub = backend.subscribe(null, (msg) => {
      if (msg.senderId === myId && !seenRef.current.has(msg.id)) {
        // Mensagem minha chegando pelo socket igual ao envio da frente da fila:
        // é o eco de um envio cuja resposta ainda não chegou, ou se perdeu. Só
        // o item da frente pode ter eco, porque a fila envia um por vez; uma
        // mensagem igual vinda de outro aparelho não esconde o que nem saiu.
        const queue = getSendQueue();
        const [head] = queue.getState().items;
        const waiting =
          head &&
          head.kind === 'chat.message' &&
          head.conversationId === msg.conversationId &&
          head.body === msg.body &&
          !(head.id in echoedRef.current)
            ? head
            : null;
        if (waiting) {
          updateEchoed({ ...echoedRef.current, [waiting.id]: msg.id });
          // Se a resposta se perdeu, o reenvio (mesma chave) fecha o item já.
          void queue.kick();
        }
      }
      receive(msg);
    });
    return unsub;
  }, [backend, myId, receive, updateEchoed]);

  useSendQueueEvent((event) => {
    if (event.item.kind !== 'chat.message') return;
    if (event.item.id in echoedRef.current) {
      const rest = { ...echoedRef.current };
      delete rest[event.item.id];
      updateEchoed(rest);
    }
    if (event.type === 'sent') receive(event.result as Message);
  });

  const openConversation = useCallback(async (conversationId: string) => {
    openConvRef.current = conversationId;
    const msgs = await backend.listMessages(conversationId);
    for (const m of msgs) seenRef.current.add(m.id);
    setMessagesByConv((prev) => ({ ...prev, [conversationId]: msgs }));
    // Marcar como lida é melhor esforço: se falhar, a conversa já carregada
    // continua na tela e só o contador de não lidas fica como está.
    try {
      await backend.markRead(conversationId);
      setConversations((prev) => markReadReducer(prev, conversationId, myId));
    } catch {
      // A próxima abertura tenta de novo.
    }
  }, [backend, myId]);

  const send = useCallback(
    (conversationId: string, body: string, imageUri?: string) =>
      getSendQueue().enqueue({ kind: 'chat.message', conversationId, body, imageUri }),
    [],
  );

  const messagesFor = useCallback(
    (conversationId: string) => messagesByConv[conversationId] ?? [],
    [messagesByConv],
  );

  const outgoingFor = useCallback(
    (conversationId: string): OutgoingMessage[] => {
      const rows: (OutgoingMessage & { at: string })[] = [];
      for (const { item } of queueState.refused) {
        if (item.kind !== 'chat.message' || item.conversationId !== conversationId) continue;
        rows.push({ id: item.id, body: item.body, state: 'refused', at: item.createdAt });
      }
      for (const item of queueState.items) {
        if (item.kind !== 'chat.message' || item.conversationId !== conversationId) continue;
        if (item.id in echoed) continue;
        rows.push({ id: item.id, body: item.body, state: 'pending', at: item.createdAt });
      }
      return rows
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(({ id, body, state }) => ({ id, body, state }));
    },
    [queueState, echoed],
  );
  const keyFor = useCallback((contactWorkerId: string) => conversationKey(myId, contactWorkerId), [myId]);

  const value = useMemo<ChatContextValue>(() => ({
    myId, loadStatus, conversations, directory,
    load, messagesFor, openConversation, send, outgoingFor, keyFor,
  }), [
    myId, loadStatus, conversations, directory,
    load, messagesFor, openConversation, send, outgoingFor, keyFor,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
