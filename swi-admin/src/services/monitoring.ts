import { DATA_BACKEND } from './dataBackend';
import { monitoringApi as mockMonitoringApi } from './mockApi/monitoring';
import { monitoringApi as amplifyMonitoringApi } from './amplifyApi/monitoring';
export * from './mockApi/monitoring';
export const monitoringApi = DATA_BACKEND === 'amplify' ? amplifyMonitoringApi : mockMonitoringApi;
