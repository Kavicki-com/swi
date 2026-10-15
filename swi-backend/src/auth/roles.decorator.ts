import { SetMetadata } from '@nestjs/common'
import type { Role } from '@prisma/client'
import { rolesFor, type Permission } from './permissions'

/** Papéis aceitos pela rota. Para o que o painel opera, prefira @Can. */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles)

/**
 * A rota exige uma permissão da matriz (auth/permissions.ts). Grava a mesma
 * metadata de @Roles, então o RolesGuard não muda: só deixa de existir uma
 * lista de papéis solta em cada controller.
 */
export const Can = (permission: Permission) => Roles(...rolesFor(permission))
