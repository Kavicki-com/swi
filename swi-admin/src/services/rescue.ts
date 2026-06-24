import { DATA_BACKEND } from './dataBackend'
import { rescueApi as mockRescueApi } from './mockApi/rescue'
import { rescueApi as amplifyRescueApi } from './amplifyApi/rescue'
export * from './mockApi/rescue'
export const rescueApi = DATA_BACKEND === 'amplify' ? amplifyRescueApi : mockRescueApi
