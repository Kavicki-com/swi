import { can, isPanelRole, permissionsOf, PERMISSIONS, rolesFor, type Permission } from './permissions'

const ALL = Object.keys(PERMISSIONS) as Permission[]

// O que o Supervisor opera no painel (decisão de 04/10): monitora, trata
// alertas, opera ordens de serviço, relatórios e chat. Qualquer permissão nova
// precisa entrar numa das duas listas, senão o teste de cobertura abaixo falha.
const SUPERVISOR_PODE: Permission[] = [
  'monitoring.read',
  'monitoring.bands.manage',
  'alerts.operate',
  'workOrders.operate',
  'chat.use',
  'cameras.read',
  'evacuation.operate',
  'rescue.operate',
  'weather.read',
  'positions.read',
  'users.read',
  'reports.read',
]
const SO_ADMIN: Permission[] = [
  'monitoring.safety.manage',
  'users.manage',
  'devices.manage',
  'cameras.manage',
  'company.manage',
  'reports.delete',
]

describe('matriz de permissões', () => {
  it('toda permissão está classificada como do Supervisor ou só do Administrador', () => {
    expect([...SUPERVISOR_PODE, ...SO_ADMIN].sort()).toEqual([...ALL].sort())
  })

  it('o Administrador pode tudo', () => {
    for (const p of ALL) expect(can('ADMIN', p)).toBe(true)
  })

  it.each(SUPERVISOR_PODE)('o Supervisor pode %s', (p) => {
    expect(can('SUPERVISOR', p)).toBe(true)
  })

  it.each(SO_ADMIN)('o Supervisor NÃO pode %s', (p) => {
    expect(can('SUPERVISOR', p)).toBe(false)
  })

  it('o Funcionário só tem o chat entre as permissões do painel', () => {
    expect(permissionsOf('WORKER')).toEqual(['chat.use'])
  })

  it('papel ausente ou desconhecido não pode nada', () => {
    expect(permissionsOf(undefined)).toEqual([])
    expect(permissionsOf('ROOT')).toEqual([])
    expect(can('', 'users.read')).toBe(false)
  })

  it('rolesFor devolve os papéis na ordem de hierarquia e uma cópia', () => {
    expect(rolesFor('users.read')).toEqual(['ADMIN', 'SUPERVISOR'])
    rolesFor('users.read').push('WORKER')
    expect(rolesFor('users.read')).toEqual(['ADMIN', 'SUPERVISOR'])
  })

  it('isPanelRole aceita Administrador e Supervisor, nunca Funcionário', () => {
    expect(isPanelRole('ADMIN')).toBe(true)
    expect(isPanelRole('SUPERVISOR')).toBe(true)
    expect(isPanelRole('WORKER')).toBe(false)
    expect(isPanelRole(undefined)).toBe(false)
  })
})
