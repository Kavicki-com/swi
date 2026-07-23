// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError } from './http'
import { MAX_UPLOAD_BYTES, uploadImage, uploadOrderImage } from './upload'

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

// Resposta do presign. `fields` reproduz o que o createPresignedPost devolve
// (policy/signature/key), não só o Content-Type.
const presignOk = () =>
  ({
    ok: true,
    status: 201,
    json: async () => ({
      url: 'http://minio/bucket',
      fields: {
        key: 'order/uuid.jpg',
        'Content-Type': 'image/jpeg',
        Policy: 'eyJwb2xpY3kiOiJ4In0=',
        'X-Amz-Signature': 'deadbeef',
      },
      key: 'order/uuid.jpg',
    }),
  }) as Response

// Presign OK + resposta do S3 configurável. `body` é o XML de erro que o
// MinIO/S3 devolve no ramo de falha.
const stubUpload = (s3: { ok: boolean; status: number }, body = '') => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(presignOk())
    .mockResolvedValueOnce({ ...s3, json: async () => null, text: async () => body } as Response)
  vi.stubGlobal('fetch', f)
  return f
}

// Arquivo com `size` forjado: alocar 15 MB de verdade só pra testar o limite
// custaria caro no runner (single-fork, jsdom).
const fileOfSize = (bytes: number, type = 'image/jpeg') => {
  const file = new File([new Uint8Array([1])], 'foto.jpg', { type })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

const jpeg = () => new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })

describe('uploadOrderImage', () => {
  it('presigna, sobe com o file por último e devolve a key', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          url: 'http://minio/bucket',
          fields: { key: 'order/uuid.jpg', 'Content-Type': 'image/jpeg' },
          key: 'order/uuid.jpg',
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)

    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    const key = await uploadOrderImage(file)

    expect(key).toBe('order/uuid.jpg')
    const form = f.mock.calls[1]?.[1]?.body as FormData
    // O S3 exige que o campo `file` seja o ÚLTIMO do multipart.
    expect([...form.keys()].pop()).toBe('file')
  })

  it('recusa tipo fora de JPG/PNG antes de chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await expect(uploadOrderImage(file)).rejects.toThrow(/JPG ou PNG/i)
    expect(f).not.toHaveBeenCalled()
  })

  it('presigna com prefix "order" e o content-type do arquivo', async () => {
    const f = stubUpload({ ok: true, status: 204 })
    await uploadOrderImage(new File([new Uint8Array([1])], 'foto.png', { type: 'image/png' }))

    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/media\/presign$/)
    expect(init.method).toBe('POST')
    // prefix 'order' é o único aceito pelo DTO pra anexo de tarefa.
    expect(JSON.parse(init.body as string)).toEqual({
      contentType: 'image/png',
      prefix: 'order',
    })
  })

  it('presigna com o prefix recebido — "chat" para anexo de mensagem', async () => {
    const f = stubUpload({ ok: true, status: 204 })
    await uploadImage(new File([new Uint8Array([1])], 'foto.png', { type: 'image/png' }), 'chat')

    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/media\/presign$/)
    expect(init.method).toBe('POST')
    // O chat valida imageKey contra chat/<uuid>.(jpg|png); o prefix decide a key.
    expect(JSON.parse(init.body as string)).toEqual({
      contentType: 'image/png',
      prefix: 'chat',
    })
  })

  it('não manda Authorization nem Content-Type manual no POST ao S3', async () => {
    window.localStorage.setItem('swi.admin.token', 'jwt-do-admin')
    const f = stubUpload({ ok: true, status: 204 })
    await uploadOrderImage(jpeg())

    const init = f.mock.calls[1]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    // Bearer no S3 = assinatura inválida; Content-Type manual mata o boundary
    // que o browser gera pro multipart.
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Content-Type')).toBeNull()
  })

  it('reenvia todos os fields do presign antes do file', async () => {
    const f = stubUpload({ ok: true, status: 204 })
    await uploadOrderImage(jpeg())

    const form = f.mock.calls[1]?.[1]?.body as FormData
    expect([...form.keys()]).toEqual(['key', 'Content-Type', 'Policy', 'X-Amz-Signature', 'file'])
    expect(form.get('Policy')).toBe('eyJwb2xpY3kiOiJ4In0=')
  })

  it('403 do S3 vira ApiError com mensagem acionável de link expirado', async () => {
    stubUpload({ ok: false, status: 403 })
    const err = await uploadOrderImage(jpeg()).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    // O status é onde suporte/log olha; a mensagem é só pro usuário.
    expect((err as ApiError).status).toBe(403)
    // Tipo e tamanho já foram barrados no client, então 403 em produção é
    // quase sempre presign vencido (TTL de 300 s) — a mensagem diz o que fazer.
    expect((err as ApiError).message).toMatch(/expirou/i)
    expect((err as ApiError).message).toMatch(/selecione o arquivo novamente/i)
    // Código de status é ruído pro operador de chão de fábrica.
    expect((err as ApiError).message).not.toContain('403')
  })

  it('outros erros do S3 viram mensagem genérica com o status preservado', async () => {
    stubUpload({ ok: false, status: 500 })
    const err = await uploadOrderImage(jpeg()).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).message).toMatch(/tente novamente/i)
    expect((err as ApiError).message).not.toMatch(/expirou/i)
  })

  it('loga o corpo do erro do S3 sem vazar pra mensagem do usuário', async () => {
    // O XML traz o código específico (AccessDenied vs EntityTooLarge vs
    // SignatureDoesNotMatch) que o status sozinho não distingue.
    const xml = '<Error><Code>SignatureDoesNotMatch</Code></Error>'
    const spy = vi.fn()
    vi.stubGlobal('console', { ...console, error: spy })
    stubUpload({ ok: false, status: 403 }, xml)

    const err = await uploadOrderImage(jpeg()).catch((e: unknown) => e)

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0]?.join(' ')).toContain('SignatureDoesNotMatch')
    expect((err as ApiError).message).not.toContain('SignatureDoesNotMatch')
  })

  it('falha de rede durante o upload vira ApiError status 0', async () => {
    // Cenário mais provável do app: conexão cai no meio do request mais pesado.
    const f = vi
      .fn()
      .mockResolvedValueOnce(presignOk())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', f)

    const err = await uploadOrderImage(jpeg()).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    // Mesma semântica do http.ts: 0 = não chegou / não completou.
    expect((err as ApiError).status).toBe(0)
    expect((err as ApiError).message).toMatch(/conexão/i)
    // Não pode escapar o TypeError cru em inglês pra tela.
    expect((err as ApiError).message).not.toMatch(/failed to fetch/i)
  })

  it('propaga o erro do presign sem tocar no S3', async () => {
    const f = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    } as Response)
    vi.stubGlobal('fetch', f)

    const err = await uploadOrderImage(jpeg()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('recusa arquivo acima do limite da policy antes de chamar a rede', async () => {
    // Pina o limite no mesmo valor do backend (media.service.ts: MAX_UPLOAD_BYTES).
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024)

    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(uploadOrderImage(fileOfSize(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(/15 MB/)
    expect(f).not.toHaveBeenCalled()
  })

  it('aceita arquivo exatamente no limite', async () => {
    const f = stubUpload({ ok: true, status: 204 })
    await expect(uploadOrderImage(fileOfSize(MAX_UPLOAD_BYTES))).resolves.toBe('order/uuid.jpg')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('recusa arquivo vazio antes de chamar a rede', async () => {
    // A policy exige content-length-range 1..15MB — 0 byte quebraria no S3.
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(uploadOrderImage(fileOfSize(0))).rejects.toThrow(/vazio/i)
    expect(f).not.toHaveBeenCalled()
  })
})
