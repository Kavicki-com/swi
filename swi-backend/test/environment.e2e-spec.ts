import { MIN_JWT_SECRET_LENGTH } from '../src/config/runtime-env'

// Este spec não monta o AppModule de propósito: ele existe para provar que o
// ambiente já está certo ANTES de qualquer app.init(). Os oito specs irmãos
// repetiam os quatro process.env.MINIO_* no topo do arquivo porque o
// MediaService constrói o S3Client no construtor, e um spec novo que
// esquecesse o bloco quebrava com erro de credencial, longe da causa.
//
// Com o setup compartilhado o bloco sai dos specs e passa a ser contrato. Se
// alguém desligar o setup de jest-e2e.json, é aqui que aparece, em um teste
// que diz o porquê, em vez de oito falhas espalhadas dizendo "resolve of
// credentials failed".
describe('Contrato de ambiente do E2E', () => {
  it('roda com NODE_ENV=test, que desliga o throttler e enfileira notificação inline', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })

  // O jest-e2e.json carrega dotenv/config, então o .env do desenvolvedor entra
  // no processo. Sem sobrescrever, o E2E assinaria token com o segredo real da
  // máquina de quem roda, e o resultado passaria a depender de um arquivo que
  // nem está no repositório.
  it('assina com um JWT descartável, nunca com o segredo real do .env', () => {
    const segredo = process.env.JWT_SECRET
    expect(segredo).toBeDefined()
    expect(segredo!.length).toBeGreaterThanOrEqual(MIN_JWT_SECRET_LENGTH)
    // O prefixo é a marca de que o setup sobrescreveu o que veio do .env.
    expect(segredo).toMatch(/^e2e-descartavel-/)
  })

  it('tem os MINIO_* prontos antes de qualquer AppModule', () => {
    for (const chave of ['MINIO_PUBLIC_URL', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_BUCKET']) {
      expect(process.env[chave]).toBeTruthy()
    }
  })
})
