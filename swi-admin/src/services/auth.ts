import { DATA_BACKEND } from './dataBackend'
import { authApi as mockAuthApi } from './mockApi/auth'
import { authApi as amplifyAuthApi } from './amplifyApi/auth'
export * from './mockApi/auth'
export const authApi = DATA_BACKEND === 'amplify' ? amplifyAuthApi : mockAuthApi
