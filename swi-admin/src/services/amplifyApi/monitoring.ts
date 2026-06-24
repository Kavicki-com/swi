import { notDeployedApi } from './notDeployed';
export const monitoringApi = notDeployedApi<typeof import('../mockApi/monitoring').monitoringApi>();
