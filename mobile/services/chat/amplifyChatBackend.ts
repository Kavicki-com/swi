import { generateClient } from 'aws-amplify/data';
import type { ChatBackend, Conversation, Message, Contact } from './types';

const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyChatBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyChatBackend: ChatBackend = {
  myId: '', // virá do auth session (Cognito sub) no deploy
  async listConversations(): Promise<Conversation[]> { void client; throw NOT_READY('listConversations'); },
  async listMessages(conversationId: string): Promise<Message[]> { void conversationId; throw NOT_READY('listMessages'); },
  async listDirectory(): Promise<Contact[]> { throw NOT_READY('listDirectory'); },
  async sendMessage(conversationId: string, body: string, imageUri?: string): Promise<Message> {
    void conversationId; void body; void imageUri; throw NOT_READY('sendMessage');
  },
  async markRead(conversationId: string): Promise<void> { void conversationId; throw NOT_READY('markRead'); },
  subscribe(conversationId: string | null, cb: (msg: Message) => void): () => void {
    // Deploy: client.models.Message.onCreate({ filter: { conversationId: { eq } } }).subscribe({ next: cb })
    void conversationId; void cb;
    return () => {};
  },
};
