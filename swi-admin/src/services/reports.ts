import { DATA_BACKEND } from './dataBackend';
import { reportsApi as mockReportsApi } from './mockApi/reports';
import { reportsApi as amplifyReportsApi } from './amplifyApi/reports';
export * from './mockApi/reports';
export const reportsApi = DATA_BACKEND === 'amplify' ? amplifyReportsApi : mockReportsApi;
