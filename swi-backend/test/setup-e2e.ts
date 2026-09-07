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

// Uma vez por ano, 1º de janeiro: na prática, nunca dentro de uma rodada.
//
// Aqui, e não no spec das condições, porque o @Cron é avaliado na CARGA DO
// MÓDULO, quando o spec faz `import { AppModule }`. Um `process.env` no
// beforeAll chega tarde: o decorador já leu a expressão. E o cuidado não é de
// um spec só: todo e2e que sobe o AppModule herda o agendador da raiz, então
// são os dezessete.
//
// O que a varredura faria solta: ela roda a cada 30 s, e uma rodada é bem mais
// longa que isso. Ela abriria perda de sinal e recuperaria condição sobre os
// fixtures de QUALQUER suíte que tenha deixado um snapshot calado para trás, no
// meio de outra suíte, e o resultado seria instabilidade que não se reproduz.
// O spec das condições chama sweepSilentSessions DIRETO, com um instante
// explícito, que é determinístico e é o que se quer provar.
//
// Forçado, não `??=`: a máquina que tiver a variável no .env não pode
// ressuscitar a varredura por baixo da suíte.
process.env.TELEMETRY_CONDITION_SWEEP_CRON = '0 0 0 1 1 *'

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
