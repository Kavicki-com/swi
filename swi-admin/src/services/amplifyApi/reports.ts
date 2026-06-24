import { notDeployedApi } from './notDeployed';
// typeof import(...) = type query, NÃO emite import runtime → zero acoplamento ao mock.
export const reportsApi = notDeployedApi<typeof import('../mockApi/reports').reportsApi>();
