import { notDeployedApi } from './notDeployed';
export const adminsApi = notDeployedApi<typeof import('../mockApi/admins').adminsApi>();
