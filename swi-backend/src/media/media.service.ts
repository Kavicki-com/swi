import { Injectable } from '@nestjs/common'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const PUT_TTL = 300 // 5 min pra subir
const GET_TTL = 3600 // 1 h pra ler

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

  // Assina só Bucket+Key (não constrange content-type) → o cliente PUTa o blob
  // sem risco de signature-mismatch de header.
  async presignPut(contentType: string, prefix = 'reports'): Promise<{ url: string; key: string }> {
    const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: PUT_TTL })
    return { url, key }
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: GET_TTL })
  }

  presignGetMany(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.presignGet(k)))
  }
}
