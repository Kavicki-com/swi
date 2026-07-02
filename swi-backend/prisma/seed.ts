import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
const prisma = new PrismaClient()

async function main() {
  const hash = (p: string) => bcrypt.hash(p, 10)
  await prisma.user.upsert({
    where: { email: 'admin@swi.local' }, update: {},
    create: { email: 'admin@swi.local', name: 'Admin', passwordHash: await hash('admin123'),
      role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' },
  })
  await prisma.user.upsert({
    where: { email: 'worker@swi.local' }, update: {},
    create: { email: 'worker@swi.local', name: 'Worker Demo', passwordHash: await hash('worker123'),
      role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },   // demo entra direto
  })
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
