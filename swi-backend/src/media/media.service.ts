import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { AllowedContentType, allowedTypesFor, isContentTypeAllowed } from './allowed-content-types'

const UPLOAD_TTL = 300 // 5 min pra subir
const GET_TTL = 3600 // 1 h pra ler
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB — teto validado antes de assinar

// Extensão por content-type. A chave é a união literal de allowed-content-types,
// então acrescentar um tipo aceito sem mapear a extensão aqui vira ERRO DE
// COMPILAÇÃO, não arquivo gravado sob nome errado em silêncio: foi assim que o
// PDF virava .jpg antes desta correção.
//
// O `Record<string, string>` da interseção não afrouxa nada disso: ele só
// permite a CONSULTA por uma string qualquer (a que chega do cliente), enquanto
// o `Record<AllowedContentType, string>` continua exigindo a união inteira na
// declaração. Sem ele, indexar com string seria erro de tipo e a alternativa
// seria um cast, que devolveria em silêncio o que este mapa existe pra impedir.
const EXT_BY_CONTENT_TYPE: Record<string, string> & Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

@Injectable()
export class MediaService {
  // endpoint unset em AWS → SDK usa o S3 real; forcePathStyle só contra MinIO.
  private readonly s3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_URL || undefined,
    forcePathStyle: !!process.env.MINIO_PUBLIC_URL,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    // Credenciais estáticas só quando fornecidas, como no MinIO local. Em AWS, sem
    // MINIO_ACCESS_KEY, NÃO passar `credentials` — passar strings vazias
    // desligaria a default provider chain do SDK e o IAM role nunca entraria.
    ...(process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: process.env.MINIO_ACCESS_KEY,
            secretAccessKey: process.env.MINIO_SECRET_KEY,
          },
        }
      : {}),
  })
  private readonly bucket = process.env.MINIO_BUCKET ?? 'swi-media'
  // Storage configurado significa credenciais explícitas presentes. Sem elas o
  // getSignedUrl dispara a default provider chain do SDK, que tenta o IMDS
  // (169.254.169.254) e PENDURA por timeout fora da AWS, travando todo endpoint
  // que assina avatar (/users, /positions, /reports, /chat/*) até derrubar o
  // dashboard inteiro. Sem storage, o presign falha RÁPIDO: '' pro GET, que as
  // telas tratam como sem-imagem, e 503 pro upload.
  // Atenção: um modo com IAM role, sem chave estática, exigiria rever isto.
  // Hoje o storage é MinIO local ou R2, sempre com chave.
  private readonly configured = !!(process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY)

  // Extensão derivada do content-type JÁ VALIDADO por allowed-content-types.
  // Antes era um ternário png/jpg: bastava pro presign de imagem, mas com PDF e
  // TXT liberados em exames ele gravaria um PDF sob nome .jpg, e o regex do
  // CreateExamDto deixaria passar.
  //
  // O parâmetro segue `string` porque é o que chega do cliente. O `?? 'jpg'`
  // não é mais a rede contra esquecer de mapear um tipo (disso cuida o Record
  // acima, em tempo de compilação): é só o que mantém o método total pra uma
  // string arbitrária, caso alguém o chame sem passar pela guarda do presign.
  private ext(contentType: string): string {
    return EXT_BY_CONTENT_TYPE[contentType] ?? 'jpg'
  }

  /**
   * URL presignada de PUT pro cliente subir o arquivo direto no storage.
   *
   * PUT e não POST: o Cloudflare R2 NÃO implementa presigned POST, devolve 501
   * "Presigned post requests are not yet implemented", e é por lá que a foto do
   * cadastro sobe. O MinIO local aceita ambos, então PUT atende os dois
   * ambientes com um caminho só.
   *
   * O que substitui a policy do POST (que impunha faixa de tamanho e tipo):
   *  - `signableHeaders` põe content-type e content-length NA ASSINATURA, então
   *    divergir de qualquer um dos dois dá 403. Sem esse Set explícito o
   *    content-type fica FORA da assinatura e o cliente manda o que quiser —
   *    verificado contra o R2 real antes de escrever isto.
   *  - o teto de 15 MB vira validação aqui, antes de assinar: assinar
   *    content-length fixa o tamanho, mas não o limita.
   */
  async presignPut(
    contentType: string,
    contentLength: number,
    prefix = 'reports',
  ): Promise<{ url: string; key: string }> {
    if (!this.configured) throw new ServiceUnavailableException('Armazenamento de mídia não configurado')
    // O tipo permitido depende do prefixo: pdf/txt só valem pra exame clínico.
    // A checagem saiu do @IsIn do DTO porque lá ela era global e não enxergava
    // o prefix, então liberar documento pra exame liberaria pra todo mundo.
    if (!isContentTypeAllowed(contentType, prefix)) {
      // Lista derivada da mesma fonte do allow/deny, como a guarda de tamanho
      // logo abaixo informa a faixa: erro que não diz o que passaria vira
      // tentativa e erro no cliente.
      throw new BadRequestException(
        `Tipo de arquivo não permitido para ${prefix}. Aceitos: ${allowedTypesFor(prefix).join(', ')}`,
      )
    }
    if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`Tamanho inválido: esperado de 1 a ${MAX_UPLOAD_BYTES} bytes`)
    }
    const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: UPLOAD_TTL, signableHeaders: new Set(['content-type', 'content-length']) },
    )
    return { url, key }
  }

  presignGet(key: string): Promise<string> {
    if (!this.configured) return Promise.resolve('')
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: GET_TTL })
  }

  presignGetMany(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.presignGet(k)))
  }
}
