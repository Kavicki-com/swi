import { notDeployedApi } from './notDeployed';
export const chatsApi = notDeployedApi<typeof import('../mockApi/chats').chatsApi>();
