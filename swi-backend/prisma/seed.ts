import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { join } from 'path'
const prisma = new PrismaClient()

async function main() {
  const hash = (p: string) => bcrypt.hash(p, 10)
  await prisma.user.upsert({
    where: { email: 'admin@swi.local' }, update: {},
    create: { email: 'admin@swi.local', name: 'Admin', passwordHash: await hash('admin123'),
      role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' },
  })
  const worker = await prisma.user.upsert({
    where: { email: 'worker@swi.local' }, update: {},
    create: { email: 'worker@swi.local', name: 'Worker Demo', passwordHash: await hash('worker123'),
      role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },   // demo entra direto
  })
  await prisma.profile.upsert({
    where: { userId: worker.id }, update: {},
    create: { userId: worker.id, fullName: 'Worker Demo', phone: '(11) 90000-0000',
      city: 'São Paulo', uf: 'SP', sector: 'Operações', jobTitle: 'Operador de escavadeira' },
  })

  // UTC-midnight de hoje (paridade com o mock e o JourneyService.today()).
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Sobe os 5 avatares demo "interested" pro MinIO; guard: se o bucket não
  // estiver acessível, loga e segue com keys vazias (asset decorativo).
  let interestedKeys: string[] = []
  try {
    const s3 = new S3Client({
      endpoint: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
      forcePathStyle: true,
      region: process.env.MINIO_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      },
    })
    const bucket = process.env.MINIO_BUCKET ?? 'swi-media'
    interestedKeys = await Promise.all(
      [1, 2, 3, 4, 5].map(async (n) => {
        const key = `interested/worker-${n}.png`
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: key,
          Body: readFileSync(join(__dirname, 'fixtures', 'interested', `worker-${n}.png`)),
          ContentType: 'image/png',
        }))
        return key
      }),
    )
  } catch (e) {
    console.warn('[seed] upload dos avatares interested falhou (bucket up?); tasks entram sem avatares:', (e as Error).message)
  }

  const SEED_TASKS = [
    { title: 'Inspeção de Equipamentos',
      description: 'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
      objective: 'Garantir que cada equipamento esteja em condições seguras de operação, identificando desgastes antes que virem falhas.' },
    { title: 'Manutenção Preventiva',
      description: 'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
      objective: 'Prolongar a vida útil dos equipamentos e minimizar paradas não planejadas executando a manutenção dentro do cronograma.' },
    { title: 'Diagnóstico de Falhas',
      description: 'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
      objective: 'Determinar com precisão a causa-raiz de cada mau funcionamento para direcionar o reparo correto.' },
    { title: 'Reparo de Componentes',
      description: 'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
      objective: 'Restaurar o funcionamento pleno dos equipamentos substituindo ou consertando as peças defeituosas identificadas.' },
  ]

  // Re-seed limpo: apaga as tasks de hoje do worker e recria (idempotente).
  await prisma.task.deleteMany({ where: { assignedTo: worker.id, scheduledDate: today } })
  for (const t of SEED_TASKS) {
    await prisma.task.create({
      data: {
        assignedTo: worker.id, title: t.title, description: t.description, objective: t.objective,
        estimatedMinutes: 120, status: 'pending', accumulatedSeconds: 0, progressPct: 0,
        scheduledDate: today, imageKeys: [], interestedCount: 18, interestedAvatarKeys: interestedKeys,
      },
    })
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
