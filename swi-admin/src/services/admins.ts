// Fachada dos administradores, 100% real: `api/users.ts` lista o diretório do
// backend Nest filtrando role ADMIN. O eixo de seleção de backend (simulação vs
// provider legado) morreu; este re-export fino existe só para os consumidores
// que já importavam de '@/services/admins' continuarem resolvendo.
export { adminsApi } from './api/users'
export type { Admin } from './api/users'
