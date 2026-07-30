import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const UPLOAD_TTL = 300 // 5 min pra subir
const GET_TTL = 3600 // 1 h pra ler
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB — teto validado antes de assinar

@Injectable()
export class MediaService {
  // endpoint unset em AWS → SDK usa o S3 real; forcePathStyle só contra MinIO.
  private readonly s3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_URL || undefined,
    forcePathStyle: !!process.env.MINIO_PUBLIC_URL,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    // Credenciais estáticas só quando fornecidas (MinIO local/QA). Em AWS, sem
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
  // Storage configurado = credenciais explícitas presentes. Sem elas, o
  // getSignedUrl dispararia a default provider chain do SDK — que tenta IMDS
  // (169.254.169.254) e PENDURA por timeout fora da AWS. No deploy Cloudez
  // isso travou todo endpoint que assina avatar (/users, /positions, /reports,
  // /chat/*) até o dashboard inteiro cair (2026-07-29). Sem storage, presign
  // falha RÁPIDO: '' pro GET (telas tratam como sem-imagem) e 503 pro upload.
  // NB: um futuro modo IAM-role (sem chave estática) precisaria rever isto —
  // hoje não existe: o storage é MinIO local ou R2, sempre com chave.
  private readonly configured = !!(process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY)

  private ext(contentType: string): string {
    return contentType === 'image/png' ? 'png' : 'jpg'
  }

  /**
   * URL presignada de PUT pro cliente subir o arquivo direto no storage.
   *
   * PUT e não POST: o Cloudflare R2 NÃO implementa presigned POST — devolve
   * 501 "Presigned post requests are not yet implemented", que foi o erro na
   * cara do usuário ao anexar a foto do cadastro (QA 2026-07-29). O MinIO
   * local aceita ambos, então PUT atende os dois ambientes com um caminho só.
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
