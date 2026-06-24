import { notDeployedApi } from './notDeployed';
export const dashboardApi = notDeployedApi<typeof import('../mockApi/dashboard').dashboardApi>();
