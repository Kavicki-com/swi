import { notDeployedApi } from './notDeployed';
export const employeesApi = notDeployedApi<typeof import('../mockApi/employees').employeesApi>();
