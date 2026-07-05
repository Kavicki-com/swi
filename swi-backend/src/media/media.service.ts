import { Injectable } from '@nestjs/common'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { randomUUID } from 'crypto'

const UPLOAD_TTL = 300 // 5 min pra subir
const GET_TTL = 3600 // 1 h pra ler
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB — limite real de upload, imposto na policy S3

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

  private ext(contentType: string): string {
    return contentType === 'image/png' ? 'png' : 'jpg'
  }

  // Presigned POST: a policy S3 impõe tamanho (content-length-range) e trava o
  // Content-Type no upload — o cliente não consegue subir blob maior que 15 MB
  // nem com content-type divergente do assinado.
  async presignPost(contentType: string, prefix = 'reports'): Promise<{ url: string; fields: Record<string, string>; key: string }> {
    const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Expires: UPLOAD_TTL,
      // content-type travado 2x de propósito: a condition explícita + a derivada do Fields (defense-in-depth).
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
    })
    return { url, fields, key }
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: GET_TTL })
  }

  presignGetMany(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.presignGet(k)))
  }
}
