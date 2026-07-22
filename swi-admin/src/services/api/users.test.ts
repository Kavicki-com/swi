// Wiring do diretório do painel (Colaboradores + Admins) contra GET /users.
// vitest globals (describe/it/expect/afterEach) via globals: true — importar de
// 'vitest' duplicaria a instância (ver nota no auth.test.ts).
import { vi } from 'vitest'
import { employeesApi, adminsApi, ageFrom } from './users'

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)

// DTO do backend (só identidade — vitais/saúde ficam pra smartband).
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Worker Um',
  email: 'w1@x.com',
  role: 'WORKER',
  approvalStatus: 'APPROVED',
  jobTitle: 'Operador',
  sector: 'Norte',
  birthDate: '1990-05-04T00:00:00.000Z',
  avatar: 'signed:av1',
  companyRole: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('ageFrom', () => {
  it('calcula idade a partir do nascimento (ISO)', () => {
    expect(ageFrom('1990-05-04T00:00:00.000Z', new Date('2026-07-22'))).toBe(36)
  })
  it('ainda não fez aniversário no ano → idade um a menos', () => {
    expect(ageFrom('1990-12-31T00:00:00.000Z', new Date('2026-07-22'))).toBe(35)
  })
  it('nascimento nulo → 0 (placeholder até o cadastro preencher)', () => {
    expect(ageFrom(null, new Date('2026-07-22'))).toBe(0)
  })
})

describe('employeesApi.list (real)', () => {
  it('GET /users?role=WORKER e mapeia pro Employee com placeholders de saúde', async () => {
    const f = okJson([summary()])
    vi.stubGlobal('fetch', f)

    const { data, error } = await employeesApi.list()

    expect(error).toBeNull()
    const e = data![0]!
    expect(e.id).toBe('u1')
    expect(e.name).toBe('Worker Um')
    expect(e.role).toBe('Operador') // jobTitle → linha 1
    expect(e.specialization).toBe('Norte') // sector → linha 2
    expect(e.sector).toBe('Norte')
    expect(e.avatarUri).toBe('signed:av1')
    expect(e.bloodType).toBe('—') // placeholder: backend não tem o campo
    expect(e.vitalsStatus).toBe('good') // placeholder neutro até a smartband
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users?role=WORKER')
  })

  it('falha de rede → { data: null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { data, error } = await employeesApi.list()

    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('adminsApi.list (real)', () => {
  it('GET /users?role=ADMIN; active/status derivam do approvalStatus', async () => {
    const f = okJson([
      summary({
        role: 'ADMIN',
        approvalStatus: 'PENDING',
        jobTitle: 'Diretor',
        companyRole: 'owner',
      }),
    ])
    vi.stubGlobal('fetch', f)

    const { data, error } = await adminsApi.list()

    expect(error).toBeNull()
    const a = data![0]!
    expect(a.role).toBe('Diretor')
    expect(a.active).toBe(false) // PENDING → não ativo
    expect(a.status).toBe('pending')
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users?role=ADMIN')
  })

  it('APPROVED → active true / status accept', async () => {
    vi.stubGlobal('fetch', okJson([summary({ role: 'ADMIN' })]))
    const { data } = await adminsApi.list()
    expect(data![0]!.active).toBe(true)
    expect(data![0]!.status).toBe('accept')
  })
})

describe('employeesApi.get (real)', () => {
  it('GET /users/:id e mapeia o detalhe', async () => {
    const f = okJson({
      ...summary(),
      phone: '119',
      cpf: '123',
      company: { id: 'c1', name: 'ACME' },
    })
    vi.stubGlobal('fetch', f)

    const { data, error } = await employeesApi.get('u1')

    expect(error).toBeNull()
    expect(data?.name).toBe('Worker Um')
    expect(data?.role).toBe('Operador')
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users/u1')
  })

  it('não encontrado (404) → data null (tela mostra "não encontrado")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Usuário não encontrado' }),
      } as Response),
    )

    const { data } = await employeesApi.get('nope')

    expect(data).toBeNull()
  })
})
