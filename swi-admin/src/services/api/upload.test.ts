// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError } from './http'
import {
  MAX_AUDIO_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  checkReportFile,
  reportFileInfo,
  uploadImage,
  uploadOrderImage,
} from './upload'
import { permitirConsoleError } from '@/test-setup'

// O caminho de erro do upload registra o status recusado pelo storage de
// propósito: é o que suporte lê quando um presign vence. Estes dois testes
// exercitam exatamente esse caminho, então o log é esperado, não ruído.
const LOG_DO_UPLOAD = /\[upload\] storage recusou o PUT/

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

// Resposta do presign. Sem `fields`: o upload é PUT presignado (o R2 nao
// implementa presigned POST, responde 501), e o contrato é { url, key }.
const presignOk = () =>
  ({
    ok: true,
    status: 201,
    json: async () => ({ url: 'http://r2/bucket/order/uuid.jpg', key: 'order/uuid.jpg' }),
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
  it('presigna, sobe via PUT com o proprio File no corpo e devolve a key', async () => {
    const f = stubUpload({ ok: true, status: 200 })
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    const key = await uploadOrderImage(file)

    expect(key).toBe('order/uuid.jpg')
    const [url, init] = f.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('http://r2/bucket/order/uuid.jpg')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(file)
    // Content-Type tem que casar com o assinado, senao 403 (verificado no R2).
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg')
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
      contentLength: 1,
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
      contentLength: 1,
      prefix: 'chat',
    })
  })

  it('presigna com o prefix "reports" — anexo de relatório', async () => {
    const f = stubUpload({ ok: true, status: 204 })
    await uploadImage(new File([new Uint8Array([1])], 'foto.png', { type: 'image/png' }), 'reports')

    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/media\/presign$/)
    expect(init.method).toBe('POST')
    // O backend valida imageKeys de relatório contra reports/<uuid>.(jpg|png);
    // 'reports' é o prefixo default do presign, então já é aceito.
    expect(JSON.parse(init.body as string)).toEqual({
      contentType: 'image/png',
      contentLength: 1,
      prefix: 'reports',
    })
  })

  it('nao manda Authorization no PUT, mas manda o Content-Type assinado', async () => {
    window.localStorage.setItem('swi.admin.token', 'jwt-do-admin')
    const f = stubUpload({ ok: true, status: 200 })
    await uploadOrderImage(jpeg())

    const init = f.mock.calls[1]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    // Bearer no storage = assinatura invalida. Já o Content-Type é obrigatorio
    // no PUT (entra na assinatura), ao contrario do POST multipart de antes.
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('manda o contentLength no presign — o servidor o assina', async () => {
    const f = stubUpload({ ok: true, status: 200 })
    await uploadOrderImage(jpeg())

    const init = f.mock.calls[0]?.[1] as RequestInit
    // jpeg() tem 3 bytes; o valor tem que ser o size real, nao um palpite.
    expect(JSON.parse(init.body as string).contentLength).toBe(3)
  })

  it('403 do S3 vira ApiError com mensagem acionável de link expirado', async () => {
    permitirConsoleError(LOG_DO_UPLOAD)
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
    permitirConsoleError(LOG_DO_UPLOAD)
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

// O tipo aceito depende do PREFIXO, espelhando allowed-content-types.ts do
// backend: laudo clínico costuma vir em PDF, mas liberar PDF pro chat deixaria
// o presign assinar um arquivo que nenhuma tela conseguiria anexar depois
// (cada consumidor valida a própria key contra .(jpg|png)).
describe('uploadImage — tipos aceitos por prefixo', () => {
  const fileOfType = (type: string, name: string) => new File([new Uint8Array([1])], name, { type })

  it('aceita pdf quando o prefixo é exams', async () => {
    const f = stubUpload({ ok: true, status: 200 })
    await expect(
      uploadImage(fileOfType('application/pdf', 'exame.pdf'), 'exams'),
    ).resolves.toBeDefined()

    // O content-type vai pro presign e entra na ASSINATURA: mandar um valor
    // diferente do real faria o storage recusar depois do upload inteiro.
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string).contentType).toBe('application/pdf')
  })

  it('aceita txt quando o prefixo é exams', async () => {
    stubUpload({ ok: true, status: 200 })
    await expect(uploadImage(fileOfType('text/plain', 'exame.txt'), 'exams')).resolves.toBeDefined()
  })

  it('continua aceitando imagem em exams', async () => {
    stubUpload({ ok: true, status: 200 })
    await expect(uploadImage(fileOfType('image/png', 'exame.png'), 'exams')).resolves.toBeDefined()
  })

  it('recusa pdf fora de exams antes de chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(uploadImage(fileOfType('application/pdf', 'foto.pdf'), 'chat')).rejects.toThrow(
      /JPG ou PNG/i,
    )
    expect(f).not.toHaveBeenCalled()
  })

  it('em exams, a mensagem lista os tipos de exame, não só imagem', async () => {
    vi.stubGlobal('fetch', vi.fn())
    // Sem isso a tela mandaria o operador converter o laudo pra JPG, quando o
    // PDF que ele tem em mãos seria aceito.
    const err = await uploadImage(fileOfType('video/mp4', 'exame.mp4'), 'exams').catch(
      (e: unknown) => e,
    )
    expect((err as Error).message).toMatch(/PDF/)
    expect((err as Error).message).toMatch(/TXT/)
  })
})

// Anexo multimídia do relatório. Espelha o backend (allowed-content-types.ts):
// em 'reports' entram imagem, vídeo, áudio e PDF, com teto por tipo (vídeo
// 100 MB, áudio 25 MB, o resto 15 MB). A mensagem é a mesma do app.
describe('uploadImage — anexo multimídia de relatório', () => {
  const MB = 1024 * 1024
  const fileOf = (type: string, name: string, bytes = 10) => {
    const file = new File([new Uint8Array([1])], name, { type })
    Object.defineProperty(file, 'size', { value: bytes })
    return file
  }

  it('tetos espelham o backend', () => {
    expect(MAX_VIDEO_BYTES).toBe(100 * MB)
    expect(MAX_AUDIO_BYTES).toBe(25 * MB)
  })

  it.each([
    ['video/mp4', 'campo.mp4'],
    ['video/quicktime', 'campo.mov'],
    ['audio/mpeg', 'relato.mp3'],
    ['audio/mp4', 'relato.m4a'],
    ['audio/x-m4a', 'relato.m4a'],
    ['audio/wav', 'relato.wav'],
    ['audio/x-wav', 'relato.wav'],
    ['application/pdf', 'laudo.pdf'],
  ])('aceita %s e assina o mesmo content-type', async (type, name) => {
    const f = stubUpload({ ok: true, status: 200 })
    await expect(uploadImage(fileOf(type, name), 'reports')).resolves.toBeDefined()
    const presign = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(presign.contentType).toBe(type)
    expect(presign.prefix).toBe('reports')
    const put = f.mock.calls[1]?.[1] as RequestInit
    expect((put.headers as Record<string, string>)['Content-Type']).toBe(type)
  })

  // Navegador que não reconhece a extensão manda type vazio. Sem inferir pela
  // extensão, um .m4a legítimo seria recusado por "tipo não aceito".
  it('type vazio: deduz pela extensão e assina o tipo deduzido', async () => {
    const f = stubUpload({ ok: true, status: 200 })
    await expect(uploadImage(fileOf('', 'relato.M4A'), 'reports')).resolves.toBeDefined()
    expect(JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string).contentType).toBe(
      'audio/mp4',
    )
    expect(
      ((f.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>)['Content-Type'],
    ).toBe('audio/mp4')
  })

  it('recusa txt no relatório, listando o que passa', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(uploadImage(fileOf('text/plain', 'nota.txt'), 'reports')).rejects.toThrow(
      'Tipo de arquivo não aceito. Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF.',
    )
    expect(f).not.toHaveBeenCalled()
  })

  it.each([
    ['video/mp4', 'campo.mp4', 100 * MB + 1, 'O arquivo excede o limite de 100 MB para vídeo.'],
    ['audio/mpeg', 'relato.mp3', 25 * MB + 1, 'O arquivo excede o limite de 25 MB para áudio.'],
    ['application/pdf', 'laudo.pdf', 15 * MB + 1, 'O arquivo excede o limite de 15 MB para PDF.'],
    ['image/jpeg', 'foto.jpg', 15 * MB + 1, 'O arquivo excede o limite de 15 MB para imagem.'],
  ])('%s acima do teto é recusado antes da rede', async (type, name, bytes, message) => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(uploadImage(fileOf(type, name, bytes), 'reports')).rejects.toThrow(message)
    expect(f).not.toHaveBeenCalled()
  })

  it('vídeo de 100 MB exatos passa', async () => {
    stubUpload({ ok: true, status: 200 })
    await expect(
      uploadImage(fileOf('video/mp4', 'campo.mp4', 100 * MB), 'reports'),
    ).resolves.toBeDefined()
  })

  // Vídeo continua fora dos outros prefixos: a regra nova é só do relatório.
  it('vídeo segue recusado em chat', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(uploadImage(fileOf('video/mp4', 'campo.mp4'), 'chat')).rejects.toThrow(
      /JPG ou PNG/,
    )
  })
})

// A tela usa as mesmas funções na ESCOLHA do arquivo, para recusar na hora
// em vez de só no salvar.
describe('reportFileInfo e checkReportFile', () => {
  const MB = 1024 * 1024
  const fileOf = (type: string, name: string, bytes = 10) => {
    const file = new File([new Uint8Array([1])], name, { type })
    Object.defineProperty(file, 'size', { value: bytes })
    return file
  }

  it.each([
    ['image/png', 'a.png', 'image/png', 'image'],
    ['video/quicktime', 'a.mov', 'video/quicktime', 'video'],
    ['audio/x-wav', 'a.wav', 'audio/x-wav', 'audio'],
    ['application/pdf', 'a.pdf', 'application/pdf', 'document'],
    ['', 'a.mp4', 'video/mp4', 'video'],
    // Tipo informado fora da lista: a extensão decide.
    ['audio/vnd.wave', 'a.wav', 'audio/wav', 'audio'],
  ])('%s %s → %s (%s)', (type, name, contentType, kind) => {
    expect(reportFileInfo(fileOf(type, name))).toEqual({ contentType, kind })
  })

  it('tipo fora da lista devolve null', () => {
    expect(reportFileInfo(fileOf('text/plain', 'a.txt'))).toBeNull()
    expect(reportFileInfo(fileOf('', 'a.exe'))).toBeNull()
  })

  it('checkReportFile devolve null para arquivo válido e a mensagem para o recusado', () => {
    expect(checkReportFile(fileOf('video/mp4', 'a.mp4', 50 * MB))).toBeNull()
    expect(checkReportFile(fileOf('audio/mpeg', 'a.mp3', 30 * MB))).toBe(
      'O arquivo excede o limite de 25 MB para áudio.',
    )
    expect(checkReportFile(fileOf('', 'a.txt'))).toBe(
      'Tipo de arquivo não aceito. Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF.',
    )
    expect(checkReportFile(fileOf('image/png', 'a.png', 0))).toBe('O arquivo está vazio')
  })
})
