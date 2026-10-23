import { LEVEL_OPTIONS, levelLabel, permissionLabel } from './levels'

describe('níveis do painel', () => {
  it('oferece Administrador e Supervisor, cada um com a descrição do que pode', () => {
    expect(LEVEL_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['ADMIN', 'Administrador'],
      ['SUPERVISOR', 'Supervisor'],
    ])
    for (const o of LEVEL_OPTIONS) expect(o.description.length).toBeGreaterThan(0)
  })

  it('levelLabel traduz o papel do backend, e ausente vale Administrador', () => {
    expect(levelLabel('SUPERVISOR')).toBe('Supervisor')
    expect(levelLabel('ADMIN')).toBe('Administrador')
    expect(levelLabel(undefined)).toBe('Administrador')
  })

  it('permissionLabel traduz a permissão do backend e mostra a chave crua se for nova', () => {
    expect(permissionLabel('alerts.operate')).toMatch(/alertas/i)
    expect(permissionLabel('algo.novo')).toBe('algo.novo')
  })

  it('as permissões da pausa, da edição de relatório e dos resgates da empresa têm rótulo', () => {
    expect(permissionLabel('monitoring.pause')).toBe('Pausar os alertas de um funcionário')
    expect(permissionLabel('reports.edit')).toBe('Editar relatórios de outras pessoas')
    expect(permissionLabel('rescue.readAll')).toBe('Ver todos os resgates da empresa')
  })
})
