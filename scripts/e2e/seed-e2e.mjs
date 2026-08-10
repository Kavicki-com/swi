/**
 * Seed do banco de TESTE dos E2E de navegador.
 *
 * Deliberadamente separado de `swi-backend/prisma/seed.ts`: aquele é o seed de
 * DEMONSTRAÇÃO, com conta administrativa de senha conhecida e volume de dados
 * pensado pra apresentar o produto, e é protegido por `assertSeedAllowed`. Aqui
 * o que se quer é o mínimo pra um fluxo de navegador existir, com credenciais
 * que só valem nesta stack descartável.
 *
 * Sem PII: nomes e e-mails são inventados, o domínio `.teste.local` não resolve
 * em lugar nenhum e o CNPJ é o placeholder de exemplo.
 *
 * Idempotente por upsert em chave fixa: o runner chama isto a cada execução, e
 * uma segunda chamada não pode duplicar empresa nem usuário.
 *
 * Roda com o cwd em swi-backend, que é onde vivem o @prisma/client gerado e o
 * bcrypt.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

// O ESM resolve dependência pelo caminho do ARQUIVO, não pelo cwd: um `import`
// estático daqui procuraria node_modules subindo a partir de scripts/, onde não
// existe @prisma/client. O createRequire ancorado no cwd (swi-backend) resolve
// no lugar certo e mantém o script fora do projeto que ele semeia.
const requireDoBackend = createRequire(join(process.cwd(), 'package.json'))
const { PrismaClient } = requireDoBackend('@prisma/client')
const bcrypt = requireDoBackend('bcrypt')

// Mesmo algoritmo e custo do backend (src/auth/codes.ts): o login compara com
// bcrypt, então gerar o hash de outro jeito faria a senha certa ser recusada.
const BCRYPT_COST = 12

export const E2E_COMPANY_ID = 'company-e2e-1'

export const E2E_ADMIN = { email: 'admin-e2e@teste.local', password: 'e2e-admin-pass' }
export const E2E_WORKER = { email: 'worker-e2e@teste.local', password: 'e2e-worker-pass' }

export async function seedE2E(prisma) {
  const company = await prisma.company.upsert({
    where: { id: E2E_COMPANY_ID },
    update: {},
    create: {
      id: E2E_COMPANY_ID,
      name: 'Empresa E2E',
      cnpj: '00000000000191',
      site: 'www.teste.local',
      cep: '30130000',
      street: 'Rua de Teste',
      number: '1',
      neighborhood: 'Centro',
      uf: 'MG',
    },
  })

  const [adminHash, workerHash] = await Promise.all([
    bcrypt.hash(E2E_ADMIN.password, BCRYPT_COST),
    bcrypt.hash(E2E_WORKER.password, BCRYPT_COST),
  ])

  const admin = await prisma.user.upsert({
    where: { email: E2E_ADMIN.email },
    update: { companyId: company.id, approvalStatus: 'APPROVED', emailVerified: true },
    create: {
      email: E2E_ADMIN.email,
      name: 'Admin E2E',
      passwordHash: adminHash,
      role: 'ADMIN',
      emailVerified: true,
      approvalStatus: 'APPROVED',
      companyId: company.id,
    },
  })

  const worker = await prisma.user.upsert({
    where: { email: E2E_WORKER.email },
    update: { companyId: company.id, approvalStatus: 'APPROVED', emailVerified: true },
    create: {
      email: E2E_WORKER.email,
      name: 'Worker E2E',
      passwordHash: workerHash,
      role: 'WORKER',
      emailVerified: true,
      approvalStatus: 'APPROVED',
      companyId: company.id,
    },
  })

  // O painel resolve setor e cargo pelo profile; sem ele o worker aparece sem
  // identificação nas listas e o teste de chat não tem por quem procurar.
  await prisma.profile.upsert({
    where: { userId: worker.id },
    update: {},
    create: {
      userId: worker.id,
      fullName: 'Worker E2E',
      phone: '11900000000',
      city: 'Belo Horizonte',
      uf: 'MG',
      sector: 'Operações',
      jobTitle: 'Operador',
    },
  })

  return { companyId: company.id, adminId: admin.id, workerId: worker.id }
}

const invokedPath = process.argv[1]?.replaceAll('\\', '/')
const isDirectRun = Boolean(invokedPath) && import.meta.url === new URL(`file:///${invokedPath}`).href

if (isDirectRun) {
  const prisma = new PrismaClient()
  seedE2E(prisma)
    .then((ids) => console.log(`Seed E2E pronto: ${JSON.stringify(ids)}`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
