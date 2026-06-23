import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { Conversation, Contact, Message } from './types';
import { getChatBackend } from './getChatBackend';
import { applyMessage, markRead as markReadReducer, conversationKey } from './chatReducers';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface ChatContextValue {
  myId: string;
  loadStatus: LoadStatus;
  conversations: Conversation[];
  directory: Contact[];
  load: () => Promise<void>;
  messagesFor: (conversationId: string) => Message[];
  openConversation: (conversationId: string) => Promise<void>;
  send: (conversationId: string, body: string, imageUri?: string) => Promise<void>;
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

  useEffect(() => {
    const unsub = backend.subscribe(null, (msg) => {
      setConversations((prev) => applyMessage(prev, msg));
      setMessagesByConv((prev) =>
        prev[msg.conversationId]
          ? { ...prev, [msg.conversationId]: [...prev[msg.conversationId], msg] }
          : prev,
      );
      if (openConvRef.current === msg.conversationId && msg.senderId !== myId) {
        backend.markRead(msg.conversationId).catch(() => {});
        setConversations((prev) => markReadReducer(prev, msg.conversationId, myId));
      }
    });
    return unsub;
  }, [backend, myId]);

  const openConversation = useCallback(async (conversationId: string) => {
    openConvRef.current = conversationId;
    const msgs = await backend.listMessages(conversationId);
    setMessagesByConv((prev) => ({ ...prev, [conversationId]: msgs }));
    await backend.markRead(conversationId);
    setConversations((prev) => markReadReducer(prev, conversationId, myId));
  }, [backend, myId]);

  const send = useCallback(async (conversationId: string, body: string, imageUri?: string) => {
    await backend.sendMessage(conversationId, body, imageUri);
  }, [backend]);

  const messagesFor = useCallback(
    (conversationId: string) => messagesByConv[conversationId] ?? [],
    [messagesByConv],
  );
  const keyFor = useCallback((contactWorkerId: string) => conversationKey(myId, contactWorkerId), [myId]);

  const value = useMemo<ChatContextValue>(() => ({
    myId, loadStatus, conversations, directory,
    load, messagesFor, openConversation, send, keyFor,
  }), [myId, loadStatus, conversations, directory, load, messagesFor, openConversation, send, keyFor]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
