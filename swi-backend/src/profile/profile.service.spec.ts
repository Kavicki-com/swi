import { ProfileService } from './profile.service'

const prisma = () =>
  ({
    profile: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  }) as any

describe('ProfileService', () => {
  it('getByUserId retorna o profile do usuário', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue({ userId: 'u1', fullName: 'Ana' })
    const r = await new ProfileService(db).getByUserId('u1')
    expect(db.profile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(r?.fullName).toBe('Ana')
  })

  it('getByUserId retorna null quando não existe', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue(null)
    expect(await new ProfileService(db).getByUserId('nope')).toBeNull()
  })

  it('upsert cria quando não existe (create carrega userId)', async () => {
    const db = prisma()
    db.profile.upsert.mockResolvedValue({ userId: 'u1', city: 'SP' })
    await new ProfileService(db).upsert('u1', { city: 'SP' })
    expect(db.profile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', city: 'SP' },
      update: { city: 'SP' },
    })
  })

  // catalog: vocabulário DISTINCT da org — substitui as listas fixas
  // inventadas do settings/tarefas (QA 2026-07-26).
  describe('catalog', () => {
    it('escopa pela empresa do caller e devolve DISTINCT ordenado, sem vazios', async () => {
      const db = prisma()
      db.user.findUnique.mockResolvedValue({ companyId: 'c1' })
      db.profile.findMany.mockResolvedValue([
        { jobTitle: 'Operador', sector: 'Setor Leste', duty: null, fullName: 'Ana', user: { role: 'WORKER', name: 'Ana' } },
        // Duplicado + whitespace: DISTINCT tem que colapsar e o vazio sumir.
        { jobTitle: 'Operador', sector: '  ', duty: 'Operação', fullName: 'Bruno', user: { role: 'WORKER', name: 'Bruno' } },
        { jobTitle: 'Administrador', sector: 'Gestão', duty: null, fullName: 'Carla', user: { role: 'ADMIN', name: 'Carla' } },
      ])
      const r = await new ProfileService(db).catalog('u1')
      expect(db.profile.findMany).toHaveBeenCalledWith({
        where: { user: { companyId: 'c1' } },
        select: { jobTitle: true, sector: true, duty: true, fullName: true, user: { select: { role: true, name: true } } },
      })
      expect(r).toEqual({
        jobTitles: ['Administrador', 'Operador'],
        sectors: ['Gestão', 'Setor Leste'],
        duties: ['Operação'],
        // Só a Carla: os dois operadores executam, não gerenciam.
        managers: ['Carla'],
      })
    })

    it('caller do balde legado (companyId null) casa só com null — não vaza outras empresas', async () => {
      const db = prisma()
      db.user.findUnique.mockResolvedValue({ companyId: null })
      db.profile.findMany.mockResolvedValue([])
      await new ProfileService(db).catalog('u-legado')
      expect(db.profile.findMany).toHaveBeenCalledWith({
        where: { user: { companyId: null } },
        select: { jobTitle: true, sector: true, duty: true, fullName: true, user: { select: { role: true, name: true } } },
      })
    })

    // O combo "Gerente responsável" do app abria VAZIO — o catálogo não tinha
    // de onde tirar a lista. A régua é a MESMA de quem revisa relatório
    // (common/staff + role ADMIN): uma definição só de "quem é gestor".
    it('managers usa a régua de staff, não todo mundo da empresa', async () => {
      const db = prisma()
      db.user.findUnique.mockResolvedValue({ companyId: 'c1' })
      db.profile.findMany.mockResolvedValue([
        { jobTitle: 'Supervisor', sector: null, duty: null, fullName: 'Antonio', user: { role: 'WORKER', name: 'Antonio' } },
        { jobTitle: 'Operador de escavadeira', sector: null, duty: null, fullName: 'Romulo', user: { role: 'WORKER', name: 'Romulo' } },
        // ADMIN entra mesmo sem cargo declarado: autorização não depende de texto livre.
        { jobTitle: null, sector: null, duty: null, fullName: null, user: { role: 'ADMIN', name: 'Admin' } },
      ])
      const r = await new ProfileService(db).catalog('u1')
      expect(r.managers).toEqual(['Admin', 'Antonio'])
    })

    it('org sem cadastros devolve listas vazias (não inventa vocabulário)', async () => {
      const db = prisma()
      db.user.findUnique.mockResolvedValue({ companyId: 'c-nova' })
      db.profile.findMany.mockResolvedValue([])
      expect(await new ProfileService(db).catalog('u9')).toEqual({
        jobTitles: [],
        sectors: [],
        duties: [],
        managers: [],
      })
    })
  })
})
