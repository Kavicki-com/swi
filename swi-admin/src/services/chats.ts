import { DATA_BACKEND } from './dataBackend'
import { chatsApi as mockChatsApi } from './mockApi/chats'
import { chatsApi as amplifyChatsApi } from './amplifyApi/chats'
export * from './mockApi/chats'
export const chatsApi = DATA_BACKEND === 'amplify' ? amplifyChatsApi : mockChatsApi
