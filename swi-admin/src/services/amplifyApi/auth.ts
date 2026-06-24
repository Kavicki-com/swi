import { notDeployedApi } from './notDeployed'
export const authApi = notDeployedApi<typeof import('../mockApi/auth').authApi>()
