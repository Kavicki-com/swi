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
import { pathToFileURL } from 'node:url'

// O ESM resolve dependência pelo caminho do ARQUIVO, não pelo cwd: um `import`
// estático daqui procuraria node_modules subindo a partir de scripts/, onde não
// existe @prisma/client. O createRequire ancorado no cwd (swi-backend) resolve
// no lugar certo e mantém o script fora do projeto que ele semeia.
// A resolução acontece na CHAMADA, não na importação: assim o módulo pode ser
// importado de fora do backend (por exemplo pelos testes deste diretório) sem
// exigir as dependências que só o ato de semear precisa.
const requireDoBackend = () => createRequire(join(process.cwd(), 'package.json'))

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

  const bcrypt = requireDoBackend()('bcrypt')
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
  //
  // CPF, CEP e tipo sanguíneo são os três marcadores que `onboardingPendente`
  // (mobile/services/profile/onboarding.ts) lê para decidir, no login, entre o
  // dashboard e o wizard de complimentary-data. Sem eles o app entenderia o
  // worker como cadastro pela metade e o smoke web nunca sairia do wizard.
  // Vão também no `update` porque o marcador precisa valer mesmo num banco
  // reaproveitado de uma execução anterior: com `update: {}` o login iria pro
  // wizard sem nenhuma pista do motivo.
  const onboardingConcluido = {
    // Placeholder de exemplo, não é o CPF de ninguém.
    cpf: '00000000000',
    cep: '30130000',
    bloodType: 'O+',
  }

  await prisma.profile.upsert({
    where: { userId: worker.id },
    update: onboardingConcluido,
    create: {
      userId: worker.id,
      fullName: 'Worker E2E',
      phone: '11900000000',
      city: 'Belo Horizonte',
      uf: 'MG',
      sector: 'Operações',
      jobTitle: 'Operador',
      ...onboardingConcluido,
    },
  })

  return { companyId: company.id, adminId: admin.id, workerId: worker.id }
}

/**
 * "Fui executado direto, ou só importado?"
 *
 * A URL vem de `pathToFileURL`, nunca de concatenar `'file:///'` com o
 * caminho. A concatenação só funciona no Windows, onde o caminho começa em
 * `C:`; com um caminho POSIX o resultado é `file:////home/...`, quatro barras,
 * que nunca bate com o `file:///home/...` de import.meta.url. A consequência
 * seria pior que um erro: rodado direto no Linux, o seed terminaria com código
 * 0 sem escrever nada, e a suíte seguiria até quebrar no login contra um banco
 * vazio.
 *
 * `pathToFileURL` é a conversão da própria plataforma e resolve os dois casos.
 * Mesma função de run-test-stack.mjs, que cerca o mesmo ponto.
 */
export function ehExecucaoDireta(caminhoInvocado, urlDoModulo) {
  if (!caminhoInvocado) return false
  return pathToFileURL(caminhoInvocado).href === urlDoModulo
}

if (ehExecucaoDireta(process.argv[1], import.meta.url)) {
  const { PrismaClient } = requireDoBackend()('@prisma/client')
  const prisma = new PrismaClient()
  seedE2E(prisma)
    .then((ids) => console.log(`Seed E2E pronto: ${JSON.stringify(ids)}`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
