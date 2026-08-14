import { randomBytes } from 'node:crypto'

// Roda como `setupFiles` do jest-e2e.json, ou seja, antes de qualquer spec ser
// carregado e portanto antes de qualquer `import { AppModule }`. Essa é a única
// janela útil: o MediaService monta o S3Client no construtor e o app.module lê
// NODE_ENV na carga do módulo. Depois disso já é tarde.
//
// A ordem em setupFiles importa: `dotenv/config` vem antes e carrega o .env da
// máquina. O que este arquivo força vence o .env; o que ele resolve com `??=`
// aceita o que veio de fora.

// Contrato de comportamento, não conveniência: NODE_ENV=test desliga o
// throttler e roda a fila de notificação inline. Forçado porque um NODE_ENV
// herdado do shell mudaria em silêncio o que a suíte exercita.
process.env.NODE_ENV = 'test'

// Forçado, não `??=`: sem isto o E2E assinaria token com o JWT_SECRET real que
// o dotenv/config acabou de ler do .env, e o resultado passaria a depender de
// um arquivo que não está no repositório.
//
// Sorteado a cada execução em vez de escrito aqui. Segredo fixo em arquivo
// versionado é segredo de verdade no dia em que alguém apontar a suíte para um
// banco que não é descartável, e o scanner de segredos acusa com razão. O
// prefixo é o que test/environment.e2e-spec.ts usa para provar que a
// sobrescrita aconteceu; o corpo aleatório garante o comprimento mínimo que o
// contrato de ambiente exige.
process.env.JWT_SECRET = `e2e-descartavel-${randomBytes(24).toString('hex')}`

// Aqui valor dummy basta, e não por preguiça: o presign é puro, não faz rede.
// Tanto o POST (createPresignedPost) quanto o GET (getSignedUrl) só assinam
// com a credencial que o S3Client recebeu, então credencial fixa deixa a
// assinatura determinística sem exigir um MinIO de pé.
// `??=` de propósito: quando a stack gerenciada sobe um MinIO de verdade, é a
// configuração dela que tem de valer.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'
process.env.MINIO_REGION ??= 'us-east-1'
