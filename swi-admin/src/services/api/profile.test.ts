// QA F (2026-07-24): o settings prefill/salvamento eram mock. Client real do
// /profile/me (GET pré-preenche o form; PUT persiste — 404 no GET = perfil
// ainda não preenchido, estado válido e não erro).
// vitest globals (describe/it/expect/afterEach) via globals: true — importar de
// 'vitest' duplicaria a instância (ver nota no auth.test.ts).
import { vi } from 'vitest'
import { profileApi } from './profile'

const okJson = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response)

const dto = {
  id: 'p1',
  userId: 'u1',
  fullName: 'Ana Prado',
  birthDate: '1990-05-04T00:00:00.000Z',
  cpf: '111.222.333-44',
  phone: '(31) 99999 0000',
  uf: 'MG',
  city: 'Belo Horizonte',
  sector: 'Setor Leste',
  jobTitle: 'Operadora de caminhão',
  duty: 'Operação',
  managerName: 'João Soares Ribeiro',
  gender: 'Feminino',
  bloodType: 'O+',
  allergies: 'Poeira',
  chronicConditions: '',
  avatarKey: 'avatars/2b0f7c1a-1111-2222-3333-444455556666.png',
  avatarUrl: 'https://s3/view/avatars/a.png',
  examKeys: ['exams/2b0f7c1a-1111-2222-3333-444455556666.jpg'],
  examUrls: ['https://s3/view/exams/e1.jpg'],
}

afterEach(() => vi.unstubAllGlobals())

describe('profileApi.me', () => {
  it('GET /profile/me devolve o perfil com keys + URLs de view', async () => {
    const f = okJson(200, dto)
    vi.stubGlobal('fetch', f)
    const { data, error } = await profileApi.me()
    expect(error).toBeNull()
    expect(data?.fullName).toBe('Ana Prado')
    expect(data?.avatarUrl).toBe('https://s3/view/avatars/a.png')
    expect(data?.examKeys).toEqual(['exams/2b0f7c1a-1111-2222-3333-444455556666.jpg'])
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/profile/me')
  })

  it('404 (perfil ainda não preenchido) → { data: null, error: null }', async () => {
    vi.stubGlobal('fetch', okJson(404, { message: 'Perfil ainda não preenchido' }))
    const { data, error } = await profileApi.me()
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('falha de rede → { data: null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await profileApi.me()
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('profileApi.update', () => {
  it('PUT /profile/me com o patch e devolve o perfil salvo', async () => {
    const f = okJson(200, dto)
    vi.stubGlobal('fetch', f)
    const { data, error } = await profileApi.update({ fullName: 'Ana Prado', duty: 'Operação' })
    expect(error).toBeNull()
    expect(data?.duty).toBe('Operação')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/profile/me')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ fullName: 'Ana Prado', duty: 'Operação' })
  })

  it('erro do backend → { data: null, error }', async () => {
    vi.stubGlobal('fetch', okJson(400, { message: 'birthDate inválido' }))
    const { data, error } = await profileApi.update({ birthDate: 'xx' })
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
