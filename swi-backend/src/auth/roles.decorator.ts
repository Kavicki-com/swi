import { applyDecorators, SetMetadata } from '@nestjs/common'
import type { Role } from '@prisma/client'
import { rolesFor, type Permission } from './permissions'

/** Papéis aceitos pela rota. Para o que o painel opera, prefira @Can. */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles)

/** Nome da permissão que a rota exige. Quem lê é o teste da trilha de auditoria. */
export const PERMISSION_KEY = 'permission'

/**
 * A rota exige uma permissão da matriz (auth/permissions.ts). Grava a mesma
 * metadata de @Roles, então o RolesGuard não muda: só deixa de existir uma
 * lista de papéis solta em cada controller. Grava também o nome da permissão:
 * os papéis sozinhos não dizem qual delas a rota pede, e é por ela que o
 * route-audit.spec sabe quais rotas têm de deixar trilha.
 */
export const Can = (permission: Permission) =>
  applyDecorators(Roles(...rolesFor(permission)), SetMetadata(PERMISSION_KEY, permission))
