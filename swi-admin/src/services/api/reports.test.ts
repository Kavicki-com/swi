// Wiring dos relatórios do painel (/reports, /reports/:id) contra o backend real.
// vitest globals (describe/it/expect/afterEach) via globals: true — importar de
// 'vitest' duplicaria a instância (ver nota no auth.test.ts). Só `vi` é importado.
import { vi } from 'vitest'
import { reportsApi } from './reports'

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)

// DTO do backend (GET /reports item) — responsibles como array de nomes (o mapper
// junta em string); sem avatares (decorativos entram no mapeamento).
const dto = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  title: 'Inspeção Técnica',
  summary: 'Checklist de manutenção preventiva.',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Eduardo Henriques',
  authorAvatarUri: 'signed:av1',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ana', 'Bea'],
  details: 'Corpo do relatório.',
  images: ['signed:img1', 'signed:img2'],
  activities: null,
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('reportsApi.list (real)', () => {
  it('GET /reports; junta responsibles em string e usa os avatares REAIS', async () => {
    const f = okJson([
      dto({ responsibles: ['Ana', 'Bea'], responsibleAvatars: ['signed:ana', 'signed:bea'] }),
    ])
    vi.stubGlobal('fetch', f)

    const { data, error } = await reportsApi.list()

    expect(error).toBeNull()
    const r = data![0]!
    expect(r.id).toBe('r1')
    expect(r.title).toBe('Inspeção Técnica')
    expect(r.responsibles).toBe('Ana, Bea') // array de nomes → string separada por vírgula
    // Contagem e faces = responsáveis REAIS. Uma rotação fixa de PNGs
    // decorativos mostraria no card caras que não são das pessoas nomeadas
    // logo abaixo.
    expect(r.responsibleTotalCount).toBe(2)
    expect(r.responsibleAvatars).toEqual(['signed:ana', 'signed:bea'])
    expect(r.status).toBe('pending')
    expect(r.statusLabel).toBe('Em Revisão')
    expect(r.authorAvatarUri).toBe('signed:av1')
    expect(r.images).toEqual(['signed:img1', 'signed:img2'])
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/reports')
  })

  it('images ausente no DTO → [] no mapeamento', async () => {
    vi.stubGlobal('fetch', okJson([dto({ images: undefined })]))
    const { data } = await reportsApi.list()
    expect(data![0]!.images).toEqual([])
  })

  it('falha de rede → { data: null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await reportsApi.list()
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('reportsApi.get (real)', () => {
  it('coage activities cru → ReportActivity[] com avatares injetados', async () => {
    const f = okJson(
      dto({
        activities: [
          {
            title: 'Verificação de óleo',
            sector: 'Setor Noroeste',
            progress: 80,
            tone: 'success',
            overflowCount: 13,
          },
          { title: 'Manutenção', sector: 'Setor Central', progress: 30, tone: 'error' },
        ],
        comments: [],
      }),
    )
    vi.stubGlobal('fetch', f)

    const { data, error } = await reportsApi.get('r1')

    expect(error).toBeNull()
    expect(data!.activities!.length).toBe(2)
    const a = data!.activities![0]!
    expect(a.title).toBe('Verificação de óleo')
    expect(a.sector).toBe('Setor Noroeste')
    expect(a.progress).toBe(80)
    expect(a.tone).toBe('success')
    // Atividade do backend não carrega pessoas → sem faces. Eram 5 avatares
    // decorativos por linha, sugerindo uma equipe que o dado não afirma.
    expect(a.avatars).toEqual([])
    expect(a.overflowCount).toBe(13) // passthrough quando presente
    expect(data!.activities![1]!.id).toBe('act-1') // sintetizado quando o backend não manda
    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain('/reports/r1')
  })

  it('preserva o id da atividade quando o backend manda um', async () => {
    vi.stubGlobal(
      'fetch',
      okJson(
        dto({
          activities: [
            {
              id: 'server-act-42',
              title: 'Tarefa',
              sector: 'Setor Sul',
              progress: 10,
              tone: 'warning',
            },
          ],
          comments: [],
        }),
      ),
    )
    const { data } = await reportsApi.get('r1')
    expect(data!.activities![0]!.id).toBe('server-act-42') // não sobrescrito pela síntese
  })

  it('activities null → [] (sem quebrar)', async () => {
    vi.stubGlobal('fetch', okJson(dto({ activities: null, comments: [] })))
    const { data } = await reportsApi.get('r1')
    expect(data!.activities).toEqual([])
  })

  it('passa comments adiante (passthrough)', async () => {
    const comment = {
      id: 'c1',
      body: 'Ótimo trabalho',
      authorName: 'Mariana',
      authorAvatarUri: 'signed:av2',
      createdAt: '2026-04-13T00:00:00.000Z',
    }
    vi.stubGlobal('fetch', okJson(dto({ comments: [comment] })))
    const { data } = await reportsApi.get('r1')
    expect(data!.comments).toEqual([comment])
  })

  it('comments ausente → [] no retorno', async () => {
    vi.stubGlobal('fetch', okJson(dto({ comments: undefined })))
    const { data } = await reportsApi.get('r1')
    expect(data!.comments).toEqual([])
  })

  it('expõe imageKeys crus do DTO (pro form de edição preservar anexos)', async () => {
    vi.stubGlobal(
      'fetch',
      okJson(dto({ imageKeys: ['reports/a.jpg', 'reports/b.jpg'], comments: [] })),
    )
    const { data } = await reportsApi.get('r1')
    expect(data!.imageKeys).toEqual(['reports/a.jpg', 'reports/b.jpg']) // keys crus, não os `images` presigned
  })

  it('imageKeys ausente no DTO → [] no retorno', async () => {
    vi.stubGlobal('fetch', okJson(dto({ imageKeys: undefined, comments: [] })))
    const { data } = await reportsApi.get('r1')
    expect(data!.imageKeys).toEqual([])
  })

  it('expõe responsibleNames crus (array, não a string comma-joined) pro form de edição', async () => {
    // Um nome com ", " provaria que split(', ') da string seria lossy — o array cru preserva.
    vi.stubGlobal('fetch', okJson(dto({ responsibles: ['Ana, Jr.', 'Bea'], comments: [] })))
    const { data } = await reportsApi.get('r1')
    expect(data!.responsibleNames).toEqual(['Ana, Jr.', 'Bea']) // cru, não desfeito de string
    expect(data!.responsibles).toBe('Ana, Jr., Bea') // a string comma-joined continua no Report
  })

  it('responsibles ausente no DTO → responsibleNames [] no retorno', async () => {
    vi.stubGlobal('fetch', okJson(dto({ responsibles: undefined, comments: [] })))
    const { data } = await reportsApi.get('r1')
    expect(data!.responsibleNames).toEqual([])
  })

  it('não encontrado (404) → { data: null, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Relatório não encontrado' }),
      } as Response),
    )
    const { data, error } = await reportsApi.get('nope')
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('reportsApi.create (real)', () => {
  it('POST /reports com o corpo esperado', async () => {
    const f = okJson(dto())
    vi.stubGlobal('fetch', f)
    const { error } = await reportsApi.create({
      title: 'Novo',
      summary: 'Resumo',
      details: 'Detalhes',
      responsibles: ['Ana'],
      imageKeys: ['k1'],
    })
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/reports')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Novo',
      summary: 'Resumo',
      details: 'Detalhes',
      responsibles: ['Ana'],
      imageKeys: ['k1'],
    })
  })

  it('create só com title omite as chaves opcionais undefined do corpo', async () => {
    const f = okJson(dto())
    vi.stubGlobal('fetch', f)
    await reportsApi.create({ title: 'Só título' })
    const [, init] = f.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ title: 'Só título' }) // JSON.stringify descarta undefined
    expect(Object.keys(body)).toEqual(['title'])
  })

  it('erro (400) → { data: null, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Título obrigatório' }),
      } as Response),
    )
    const { data, error } = await reportsApi.create({ title: '' })
    expect(data).toBeNull()
    expect(error?.message).toMatch(/obrigat/i)
  })
})

describe('reportsApi.update (real)', () => {
  it('PATCH /reports/:id com os campos parciais', async () => {
    const f = okJson(dto())
    vi.stubGlobal('fetch', f)
    const { error } = await reportsApi.update('r1', { status: 'accept', statusLabel: 'Concluído' })
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/reports/r1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({
      status: 'accept',
      statusLabel: 'Concluído',
    })
  })
})

describe('reportsApi.addComment (real)', () => {
  it('POST /reports/:id/comments com { body }', async () => {
    const f = okJson({
      id: 'c1',
      body: 'Comentário',
      authorName: 'Eu',
      authorAvatarUri: 'signed:me',
      createdAt: '2026-04-14T00:00:00.000Z',
    })
    vi.stubGlobal('fetch', f)
    const { data, error } = await reportsApi.addComment('r1', 'Comentário')
    expect(error).toBeNull()
    expect(data?.body).toBe('Comentário')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/reports/r1/comments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ body: 'Comentário' })
  })

  it('falha de rede → { data: null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await reportsApi.addComment('r1', 'x')
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
