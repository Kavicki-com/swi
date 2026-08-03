// Wiring do diretório do painel (Colaboradores + Admins) contra GET /users.
// vitest globals (describe/it/expect/afterEach) via globals: true — importar de
// 'vitest' duplicaria a instância (ver nota no auth.test.ts).
import { vi } from 'vitest'
import { employeesApi, adminsApi, approvalsApi, ageFrom } from './users'

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)

// DTO do backend (só identidade — vitais/saúde ficam pra smartband).
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Worker Um',
  email: 'w1@x.com',
  role: 'WORKER',
  approvalStatus: 'APPROVED',
  active: true,
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
    expect(url).toContain('/users?role=WORKER&approvalStatus=APPROVED')
  })

  it('falha de rede → { data: null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { data, error } = await employeesApi.list()

    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('adminsApi.list (real)', () => {
  it('GET /users?role=ADMIN; status deriva do approvalStatus, active vem do campo real', async () => {
    const f = okJson([
      summary({
        role: 'ADMIN',
        approvalStatus: 'PENDING',
        active: false, // campo real de ativação — independente do approvalStatus
        jobTitle: 'Diretor',
        companyRole: 'owner',
      }),
    ])
    vi.stubGlobal('fetch', f)

    const { data, error } = await adminsApi.list()

    expect(error).toBeNull()
    const a = data![0]!
    expect(a.role).toBe('Diretor')
    expect(a.active).toBe(false) // reflete o DTO (active:false), não o approvalStatus
    expect(a.status).toBe('pending')
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users?role=ADMIN&approvalStatus=APPROVED')
  })

  it('active vem do campo real mesmo com approvalStatus APPROVED', async () => {
    // Decopla active de approvalStatus: um admin APPROVED mas desativado tem
    // status 'accept' porém active:false.
    vi.stubGlobal('fetch', okJson([summary({ role: 'ADMIN', active: false })]))
    const { data } = await adminsApi.list()
    expect(data![0]!.active).toBe(false)
    expect(data![0]!.status).toBe('accept')
  })

  it('APPROVED + active → active true / status accept', async () => {
    vi.stubGlobal('fetch', okJson([summary({ role: 'ADMIN' })]))
    const { data } = await adminsApi.list()
    expect(data![0]!.active).toBe(true)
    expect(data![0]!.status).toBe('accept')
  })
})

describe('adminsApi.setActive/remove (real)', () => {
  it('setActive → PATCH /users/:id {active}', async () => {
    const f = okJson({ id: 'a1', active: false })
    vi.stubGlobal('fetch', f)
    const { error } = await adminsApi.setActive('a1', false)
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/a1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ active: false })
  })
  it('remove → DELETE /users/:id', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)
    const { error } = await adminsApi.remove('a1')
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/a1')
    expect(init.method).toBe('DELETE')
  })
  it('remove com 409 → { data:null, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          message: 'Usuário possui registros vinculados; desative-o em vez de excluir',
        }),
      } as Response),
    )
    const { data, error } = await adminsApi.remove('a1')
    expect(data).toBeNull()
    expect(error?.message).toMatch(/vinculado/i)
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

describe('approvalsApi.listPendingWorkers (real)', () => {
  it('GET /users?role=WORKER&approvalStatus=PENDING e mapeia createdAt→requestedAt', async () => {
    const f = okJson([
      summary({ approvalStatus: 'PENDING', createdAt: '2026-07-10T00:00:00.000Z' }),
    ])
    vi.stubGlobal('fetch', f)
    const { data, error } = await approvalsApi.listPendingWorkers()
    expect(error).toBeNull()
    expect(data![0]!).toMatchObject({
      id: 'u1',
      name: 'Worker Um',
      email: 'w1@x.com',
      requestedAt: '2026-07-10T00:00:00.000Z',
    })
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/users?role=WORKER&approvalStatus=PENDING')
  })

  // O app manda o perfil junto do cadastro; a fila precisa repassar pra tela,
  // senão o admin continua aprovando às cegas (QA 2026-07-26).
  it('repassa o perfil que veio no cadastro', async () => {
    const base = summary({ approvalStatus: 'PENDING', createdAt: '2026-07-10T00:00:00.000Z' })
    vi.stubGlobal(
      'fetch',
      okJson([
        {
          ...base,
          cpf: '000.000.000-00',
          phone: '(41) 90000-0000',
          birthDate: '1990-12-25T00:00:00.000Z',
          city: 'Curitiba',
          uf: 'PR',
          bloodType: 'O-',
          allergies: 'Amendoim',
        },
      ]),
    )
    const { data } = await approvalsApi.listPendingWorkers()
    expect(data![0]!).toMatchObject({
      cpf: '000.000.000-00',
      phone: '(41) 90000-0000',
      city: 'Curitiba',
      uf: 'PR',
      bloodType: 'O-',
      allergies: 'Amendoim',
    })
  })

  it('cadastro antigo (sem perfil) vira null, não undefined — a tela testa por null', async () => {
    vi.stubGlobal(
      'fetch',
      okJson([summary({ approvalStatus: 'PENDING', createdAt: '2026-07-10T00:00:00.000Z' })]),
    )
    const { data } = await approvalsApi.listPendingWorkers()
    expect(data![0]!.cpf).toBeNull()
    expect(data![0]!.bloodType).toBeNull()
  })
})

describe('create (real)', () => {
  it('employeesApi.create → POST /users role WORKER + identidade', async () => {
    const f = okJson({ id: 'n', name: 'Zé' })
    vi.stubGlobal('fetch', f)
    const { error } = await employeesApi.create({
      name: 'Zé',
      email: 'ze@x.com',
      password: 'senha123',
      phone: '11',
    })
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      role: 'WORKER',
      name: 'Zé',
      email: 'ze@x.com',
      password: 'senha123',
      phone: '11',
    })
  })
  it('adminsApi.create → role ADMIN', async () => {
    const f = okJson({ id: 'n' })
    vi.stubGlobal('fetch', f)
    await adminsApi.create({ name: 'A', email: 'a@x.com', password: 'senha123' })
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string).role).toBe(
      'ADMIN',
    )
  })
  it('erro (409) → { data:null, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'E-mail já cadastrado' }),
      } as Response),
    )
    const { data, error } = await employeesApi.create({
      name: 'A',
      email: 'a@x.com',
      password: 'senha123',
    })
    expect(data).toBeNull()
    expect(error?.message).toMatch(/cadastrad/i)
  })
})

// O detalhe já tinha a seção "Histórico de exames", mas o mapper nunca
// preenchia examHistory: quem TINHA exame via "Nenhum exame registrado".
// Mesma família das alergias fixas e do tipo sanguíneo com default universal
// que o repo já corrigiu — defeito que parece certo quando está errado.
describe('exames reais no detalhe do usuário', () => {
  const EXAME = {
    id: 'e1',
    name: 'Audiometria',
    // Validade em data de CALENDÁRIO, sem hora.
    date: '2027-03-05',
    fileUrl: 'https://exemplo/e1.pdf',
  }

  it('GET /users/:id mapeia os exames do DTO pro examHistory da UI', async () => {
    vi.stubGlobal('fetch', okJson(summary({ exams: [EXAME] })))

    const { data } = await employeesApi.get('u1')

    expect(data?.examHistory).toEqual([
      { id: 'e1', title: 'Audiometria', year: '2027', date: '05 Mar', fileUrl: EXAME.fileUrl },
    ])
  })

  it('sem exame não inventa histórico', async () => {
    vi.stubGlobal('fetch', okJson(summary({ exams: [] })))

    const { data } = await employeesApi.get('u1')

    // undefined, não [] — o layout distingue "não tem" de "não veio".
    expect(data?.examHistory).toBeUndefined()
  })

  it('resposta sem o campo exams não quebra o mapeamento', async () => {
    // Backend antigo (antes do PR feat/backend-exam-filetypes) não manda o campo.
    vi.stubGlobal('fetch', okJson(summary()))

    const { data } = await employeesApi.get('u1')

    expect(data?.examHistory).toBeUndefined()
    expect(data?.name).toBe('Worker Um')
  })

  it('a validade não recua um dia em fuso negativo', async () => {
    // new Date('2027-03-01') é meia-noite UTC: em UTC-3 os getters locais
    // devolvem 28/Fev. Por isso o mapper fatia texto em vez de usar Date.
    vi.stubGlobal('fetch', okJson(summary({ exams: [{ ...EXAME, date: '2027-03-01' }] })))

    const { data } = await employeesApi.get('u1')

    expect(data?.examHistory?.[0]?.date).toBe('01 Mar')
    expect(data?.examHistory?.[0]?.year).toBe('2027')
  })

  it('admin também recebe o histórico real', async () => {
    vi.stubGlobal('fetch', okJson(summary({ role: 'ADMIN', exams: [EXAME] })))

    const { data } = await adminsApi.get('u1')

    expect(data?.examHistory?.[0]?.title).toBe('Audiometria')
  })
})

describe('approvalsApi.approve/reject (real)', () => {
  it('approve() faz POST /users/:id/approve', async () => {
    const f = okJson({ id: 'u1', approvalStatus: 'APPROVED' })
    vi.stubGlobal('fetch', f)
    const { data, error } = await approvalsApi.approve('u1')
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'u1', approvalStatus: 'APPROVED' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/u1/approve')
    expect(init.method).toBe('POST')
  })
  it('reject() faz POST /users/:id/reject', async () => {
    const f = okJson({ id: 'u1', approvalStatus: 'REJECTED' })
    vi.stubGlobal('fetch', f)
    const { data } = await approvalsApi.reject('u1')
    expect(data?.approvalStatus).toBe('REJECTED')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/u1/reject')
    expect(init.method).toBe('POST')
  })
  it('erro no approve → { data:null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await approvalsApi.approve('u1')
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
