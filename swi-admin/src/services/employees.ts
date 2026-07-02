import { DATA_BACKEND } from './dataBackend'
import { employeesApi as mockEmployeesApi } from './mockApi/employees'
import { employeesApi as amplifyEmployeesApi } from './amplifyApi/employees'
export * from './mockApi/employees'
export const employeesApi = DATA_BACKEND === 'amplify' ? amplifyEmployeesApi : mockEmployeesApi
