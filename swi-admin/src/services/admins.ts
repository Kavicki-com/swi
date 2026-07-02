import { DATA_BACKEND } from './dataBackend'
import { adminsApi as mockAdminsApi } from './mockApi/admins'
import { adminsApi as amplifyAdminsApi } from './amplifyApi/admins'
export * from './mockApi/admins'
export const adminsApi = DATA_BACKEND === 'amplify' ? amplifyAdminsApi : mockAdminsApi
