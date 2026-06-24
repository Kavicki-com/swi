import { DATA_BACKEND } from './dataBackend'
import { dashboardApi as mockDashboardApi } from './mockApi/dashboard'
import { dashboardApi as amplifyDashboardApi } from './amplifyApi/dashboard'
export * from './mockApi/dashboard'
export const dashboardApi = DATA_BACKEND === 'amplify' ? amplifyDashboardApi : mockDashboardApi
