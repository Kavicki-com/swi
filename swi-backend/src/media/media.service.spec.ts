jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/obj?sig=1'),
}))
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MediaService } from './media.service'

// O upload é PUT presignado, não POST. Motivo: o Cloudflare R2 NÃO implementa
// presigned POST, responde 501 "Presigned post requests are not yet
// implemented", e é por lá que a foto do cadastro sobe. O MinIO local aceita os
// dois, então PUT serve aos dois mundos.
//
// O que a assinatura garante, verificado no R2 de verdade antes de escrever
// este código: sem `signableHeaders`, o content-type NÃO entra na assinatura e
// o cliente pode mandar qualquer um (probe devolveu 200). Com ele, tipo
// divergente e tamanho divergente são recusados com 403.
describe('MediaService', () => {
  beforeEach(() => {
    ;(getSignedUrl as jest.Mock).mockClear()
    // Storage "configurado" pros casos de presign: sem estas envs o service
    // falha rapido de proposito (ver describe no fim do arquivo).
    process.env.MINIO_ACCESS_KEY = 'test-key'
    process.env.MINIO_SECRET_KEY = 'test-secret'
  })
  afterEach(() => {
    delete process.env.MINIO_ACCESS_KEY
    delete process.env.MINIO_SECRET_KEY
  })

  const argsDoPresign = () => {
    const [, cmd, opts] = (getSignedUrl as jest.Mock).mock.calls[0]
    return { input: cmd.input, opts }
  }

  it('presignPut: key com prefixo+ext e url assinada', async () => {
    const out = await new MediaService().presignPut('image/png', 1234, 'task')
    expect(out.key).toMatch(/^task\/[0-9a-f-]{36}\.png$/)
    expect(out.url).toBe('https://signed.example/obj?sig=1')
    const { input } = argsDoPresign()
    expect(input.ContentType).toBe('image/png')
    expect(input.ContentLength).toBe(1234)
  })

  // Sem signableHeaders o cliente troca o content-type impunemente (provado no
  // R2). Estes dois cabeçalhos são a única defesa real do upload direto.
  it('presignPut: assina content-type E content-length', async () => {
    await new MediaService().presignPut('image/jpeg', 999)
    const { opts } = argsDoPresign()
    expect([...opts.signableHeaders]).toEqual(
      expect.arrayContaining(['content-type', 'content-length']),
    )
  })

  it('presignPut: prefixo default reports + jpg pra content-type não-png', async () => {
    const { key } = await new MediaService().presignPut('image/jpeg', 10)
    expect(key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  it('presignPut: prefixo order (anexos do WorkOrder) → key sob order/', async () => {
    const { key } = await new MediaService().presignPut('image/jpeg', 10, 'order')
    expect(key).toMatch(/^order\/[0-9a-f-]{36}\.jpg$/)
  })

  // O tamanho agora é validado ANTES de assinar: a policy do POST impunha a
  // faixa 1..15MB, e sem ela o limite tem que virar checagem explícita — senão
  // a migração pra PUT teria removido o teto em silêncio.
  it.each([
    ['zero', 0],
    ['negativo', -1],
    ['acima de 15 MB', 15 * 1024 * 1024 + 1],
  ])('presignPut recusa tamanho %s com 400', async (_rotulo, bytes) => {
    await expect(new MediaService().presignPut('image/jpeg', bytes)).rejects.toMatchObject({
      status: 400,
    })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('presignPut aceita exatamente 15 MB (limite inclusivo)', async () => {
    await expect(
      new MediaService().presignPut('image/jpeg', 15 * 1024 * 1024),
    ).resolves.toBeDefined()
  })

  // A extensão da key TEM que sair do content-type. Com pdf/txt liberados em
  // exames, um ternário png/jpg gravaria o PDF como `exams/<uuid>.jpg`: arquivo
  // com nome mentiroso no bucket, que o regex do CreateExamDto engoliria sem
  // reclamar. É por isso que esta task anda junto da que liberou os tipos.
  describe('key do presign por content-type', () => {
    it.each([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['application/pdf', 'pdf'],
      ['text/plain', 'txt'],
    ])('presignPut: %s vira .%s', async (contentType, esperado) => {
      const { key } = await new MediaService().presignPut(contentType, 1234, 'exams')
      expect(key).toMatch(new RegExp(`^exams/[0-9a-f-]{36}\\.${esperado}$`))
    })
  })

  // A regra allow/deny em si tem teste unitário em allowed-content-types.spec,
  // mas nada exercitava a LINHA que a chama dentro do presignPut. Sem isto,
  // remover a guarda por engano não quebraria nenhum teste do service.
  describe('guarda de content-type por prefixo', () => {
    it('presignPut recusa pdf em prefixo que só aceita imagem (chat) com 400', async () => {
      await expect(
        new MediaService().presignPut('application/pdf', 100, 'chat'),
      ).rejects.toMatchObject({ status: 400 })
    })

    // A guarda precisa barrar ANTES de assinar. Se ela rodasse depois do
    // getSignedUrl, o teste de rejeição acima continuaria verde enquanto a URL
    // assinada já teria sido gerada, e a falha ficaria invisível.
    it('presignPut recusado não chega a assinar nada', async () => {
      await expect(
        new MediaService().presignPut('application/pdf', 100, 'chat'),
      ).rejects.toBeDefined()
      expect(getSignedUrl).not.toHaveBeenCalled()
    })

    it('presignPut aceita pdf em exams', async () => {
      await expect(
        new MediaService().presignPut('application/pdf', 100, 'exams'),
      ).resolves.toBeDefined()
      expect(getSignedUrl).toHaveBeenCalledTimes(1)
    })
  })

  it('presignGetMany assina cada key', async () => {
    const urls = await new MediaService().presignGetMany(['reports/a.jpg', 'reports/b.jpg'])
    expect(urls).toEqual(['https://signed.example/obj?sig=1', 'https://signed.example/obj?sig=1'])
    expect(getSignedUrl).toHaveBeenCalledTimes(2)
  })
})

// Sem credenciais de storage, o getSignedUrl do SDK dispara a default provider
// chain, que tenta o IMDS (169.254.169.254) e PENDURA por timeout fora da AWS.
// No painel isso trava /users, /positions, /reports e /chat/* de uma vez, ou
// seja, todo endpoint que assina avatar. Sem storage configurado, o presign tem
// que falhar RAPIDO.
describe('MediaService sem storage configurado', () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.resetModules() })

  const semCredenciais = () => {
    delete process.env.MINIO_ACCESS_KEY
    delete process.env.MINIO_SECRET_KEY
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- o require é proposital: vem depois de jest.resetModules() para reavaliar o módulo com o ambiente já alterado, coisa que um import estático (içado) não faz.
    const { MediaService } = require('./media.service')
    return new MediaService()
  }

  it('presignGet devolve string vazia na hora (sem tocar a rede)', async () => {
    const svc = semCredenciais()
    const inicio = Date.now()
    await expect(svc.presignGet('avatars/x.jpg')).resolves.toBe('')
    expect(Date.now() - inicio).toBeLessThan(200)
  })

  it('presignPut falha com 503 limpo, nao com timeout', async () => {
    const svc = semCredenciais()
    await expect(svc.presignPut('image/jpeg', 100)).rejects.toMatchObject({ status: 503 })
  })
})
