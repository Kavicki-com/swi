import { PrismaClient, type NotificationDomain } from '@prisma/client'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DEMO_STORM_ALERT_ID } from '../src/weather/weather.types'
import { hash } from '../src/auth/codes'
import { distributeMinutes } from '../src/work-orders/order-status'
import { assertSeedAllowed } from '../src/config/seed-guard'
const prisma = new PrismaClient()

async function main() {
  // Primeira linha, antes de qualquer escrita: este seed cria conta
  // administrativa com senha de demonstração. Contra um banco que não seja
  // descartável, isso é uma credencial pública, não dado de teste.
  assertSeedAllowed(process.env)
  // Org-scoping (QA C1): TODO usuário seed pertence à empresa demo — sem isto,
  // ficam com companyId null (balde legado) e as listas escopadas vêm vazias.
  // id fixo → upsert idempotente; o `update` dos upserts abaixo re-vincula
  // usuários que já existiam no banco dev antes do scoping.
  const company = await prisma.company.upsert({
    where: { id: 'company-seed-1' }, update: {},
    create: {
      id: 'company-seed-1', name: 'SWI Demo Mineração', cnpj: '00000000000191',
      site: 'www.swi.local', cep: '30130000', street: 'Avenida Demo', number: '100',
      neighborhood: 'Centro', uf: 'MG',
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: 'admin@swi.local' }, update: { companyId: company.id },
    create: { email: 'admin@swi.local', name: 'Admin', passwordHash: await hash('admin123'),
      role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED', companyId: company.id },
  })
  const worker = await prisma.user.upsert({
    where: { email: 'worker@swi.local' }, update: { companyId: company.id },
    create: { email: 'worker@swi.local', name: 'Worker Demo', passwordHash: await hash('worker123'),
      role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED', companyId: company.id },   // demo entra direto
  })
  await prisma.profile.upsert({
    where: { userId: worker.id }, update: {},
    create: { userId: worker.id, fullName: 'Worker Demo', phone: '11900000000',
      city: 'São Paulo', uf: 'SP', sector: 'Operações', jobTitle: 'Operador de escavadeira' },
  })

  // UTC-midnight de hoje (paridade com o mock e o JourneyService.today()).
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dueIn = (days: number) => new Date(today.getTime() + days * 86_400_000)

  // ===== Fatia 4 (Chat): diretório + conversas/mensagens demo (Opção A) =====
  // conversationKey: paridade EXATA com mobile/services/chat/chatReducers.ts
  const convKey = (a: string, b: string) => [a, b].sort().join('#')

  // birthDate (date-only): demo realista pra a UI do painel calcular idade (antes
  // todos caíam em "0 anos" por falta do campo). Ver [[swi-open-followups]] #5.
  // bloodType/allergies/gender: cadastro CLÍNICO (não depende da smartband — são
  // campos editáveis do Profile). Sem eles a tela de socorro lista "—" pra todo
  // mundo (a info mais crítica da linha num console de emergência) e o detalhe
  // do funcionário mostrava "Gênero: Feminino" pra todos, por default do layout.
  const CONTACTS = [
    { n: 1, email: 'romulo@swi.local',   name: 'Romulo Cardoso',          sector: 'Setor Leste', role: 'Operador',                birthDate: '1985-03-12', bloodType: 'O+',  gender: 'male',   allergies: '' },
    { n: 2, email: 'ezequiel@swi.local', name: 'Ezequiel Almeida',        sector: 'Setor Leste', role: 'Operador',                birthDate: '1990-07-25', bloodType: 'A+',  gender: 'male',   allergies: 'Dipirona' },
    { n: 3, email: 'josue@swi.local',    name: 'Josué Oliveira',          sector: 'Setor Leste', role: 'Técnico de Manutenção',   birthDate: '1982-11-03', bloodType: 'B+',  gender: 'male',   allergies: '' },
    { n: 4, email: 'carlos@swi.local',   name: 'Carlos Santos',           sector: 'Setor Leste', role: 'Operador',                birthDate: '1978-01-19', bloodType: 'O-',  gender: 'male',   allergies: 'Penicilina' },
    { n: 5, email: 'antonio@swi.local',  name: 'Antonio Carlos Figueira', sector: 'Setor Leste', role: 'Supervisor',              birthDate: '1971-09-08', bloodType: 'AB+', gender: 'male',   allergies: '' },
    { n: 6, email: 'jennifer@swi.local', name: 'Jennifer Gomes',          sector: 'Setor Leste', role: 'Analista de Segurança',   birthDate: '1993-05-14', bloodType: 'A-',  gender: 'female', allergies: 'Látex' },
    { n: 7, email: 'adriana@swi.local',  name: 'Adriana Santos Almeida',  sector: 'Setor Leste', role: 'Operadora',               birthDate: '1988-12-02', bloodType: 'B-',  gender: 'female', allergies: '' },
    { n: 8, email: 'compressor@swi.local', name: 'Carlos Santos (Manut.)', sector: 'Setor Leste', role: 'Operador',               birthDate: '1995-04-21', bloodType: 'O+',  gender: 'male',   allergies: 'Poeira de sílica' },
  ]

  type Seg = { from: 'me' | 'them'; body: string; time: string }
  const THREADS: { n: number; unread: number; baseDay: string; texts: Seg[] }[] = [
    { n: 1, unread: 10, baseDay: '2026-06-23', texts: [
      { from: 'them', body: 'Vamos precisar alinhar com a equipe de transporte sobre os horários.', time: '13:42' },
      { from: 'me',   body: 'Combinado. Já enviei a planilha para o pessoal do operacional.', time: '13:50' },
      { from: 'them', body: 'Perfeito. Obrigado pelo retorno rápido.', time: '13:55' },
      { from: 'them', body: 'Ainda não recebemos atualizações recentes do setor de segurança.', time: '14:20' },
      { from: 'them', body: 'Bom dia! Alguma novidade sobre a detonação de explosivos na área 7?', time: '14:25' },
      { from: 'me',   body: 'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.', time: '14:57' },
      { from: 'them', body: 'Os especialistas estão agendando uma reunião para discutir os próximos passos.', time: '15:10' },
      { from: 'them', body: 'É recomendado manter a área isolada até segunda ordem das autoridades competentes.', time: '15:15' },
    ] },
    { n: 2, unread: 2, baseDay: '2026-06-22', texts: [
      { from: 'them', body: 'Conseguimos finalizar a inspeção do turno da manhã.', time: '09:10' },
      { from: 'me',   body: 'Ótimo, registra no relatório por favor.', time: '09:18' },
      { from: 'them', body: 'Já registrado. Algum ponto de atenção?', time: '09:30' },
    ] },
    { n: 3, unread: 2, baseDay: '2026-06-21', texts: [
      { from: 'them', body: 'A bomba hidráulica voltou a apresentar ruído.', time: '11:05' },
      { from: 'them', body: 'Vou abrir uma OS de manutenção preventiva.', time: '11:12' },
    ] },
    { n: 4, unread: 0, baseDay: '2026-06-20', texts: [
      { from: 'me',   body: 'Carlos, consegue cobrir o turno da tarde amanhã?', time: '16:40' },
      { from: 'them', body: 'Consigo sim, sem problema.', time: '16:52' },
    ] },
    { n: 5, unread: 0, baseDay: '2026-06-19', texts: [
      { from: 'them', body: 'Reunião de segurança confirmada para sexta às 14h.', time: '10:00' },
    ] },
    { n: 6, unread: 0, baseDay: '2026-06-18', texts: [
      { from: 'them', body: 'Os EPIs novos chegaram no almoxarifado.', time: '08:30' },
      { from: 'me',   body: 'Show, vou retirar os do nosso setor.', time: '08:45' },
    ] },
    { n: 7, unread: 0, baseDay: '2026-06-17', texts: [
      { from: 'me',   body: 'Adriana, o checklist da área 3 está pronto?', time: '13:20' },
      { from: 'them', body: 'Está, enviei por e-mail também.', time: '13:35' },
      { from: 'them', body: 'Qualquer coisa me avisa.', time: '13:36' },
    ] },
    { n: 8, unread: 0, baseDay: '2026-06-16', texts: [
      { from: 'them', body: 'Fechamos o reparo do compressor.', time: '17:05' },
    ] },
  ]

  // S3 pro upload dos avatares do chat (guard próprio — bucket inacessível → key vazia).
  const chatS3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
    forcePathStyle: true,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    },
  })
  const chatBucket = process.env.MINIO_BUCKET ?? 'swi-media'
  const uploadAvatarFile = async (fileName: string): Promise<string> => {
    const key = `chat/avatars/${fileName}`
    await chatS3.send(new PutObjectCommand({
      Bucket: chatBucket, Key: key,
      Body: readFileSync(join(__dirname, 'fixtures', 'chat-avatars', fileName)),
      ContentType: 'image/png',
    }))
    return key
  }
  const uploadChatAvatar = (n: number): Promise<string> => uploadAvatarFile(`worker-${n}.png`)
  // Sobe uma imagem de inspeção pro MinIO (mesmo bucket do chat). Key no formato
  // que a regex do backend exige: ^reports\/[0-9a-f-]{36}\.png$ (randomUUID = 36 chars).
  // Não guarda internamente: se o bucket estiver inacessível ela LANÇA — o loop
  // chamador captura, dá warn e deixa imageKeys em [] (mesmo padrão do uploadChatAvatar).
  const uploadReportImage = async (localFileName: string): Promise<string> => {
    const key = `reports/${randomUUID()}.png`
    await chatS3.send(new PutObjectCommand({
      Bucket: chatBucket, Key: key,
      Body: readFileSync(join(__dirname, 'seed-assets', localFileName)),
      ContentType: 'image/png',
    }))
    return key
  }

  // Cria/atualiza os 8 workers (aprovados) + Profile com avatar; guarda a key real.
  const chatPass = await hash('worker123')
  const contactIds = new Map<number, string>()
  const contactAvatarKeys = new Map<number, string>()
  for (const c of CONTACTS) {
    let avatarKey = ''
    try { avatarKey = await uploadChatAvatar(c.n) }
    catch (e) { console.warn(`[seed] avatar chat worker-${c.n} falhou (bucket up?):`, (e as Error).message) }
    contactAvatarKeys.set(c.n, avatarKey)
    const u = await prisma.user.upsert({
      where: { email: c.email },
      update: { approvalStatus: 'APPROVED', emailVerified: true, companyId: company.id },
      create: { email: c.email, name: c.name, passwordHash: chatPass, role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED', companyId: company.id },
    })
    contactIds.set(c.n, u.id)
    await prisma.profile.upsert({
      where: { userId: u.id },
      update: { fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey, birthDate: new Date(c.birthDate), bloodType: c.bloodType, gender: c.gender, allergies: c.allergies },
      create: { userId: u.id, fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey, birthDate: new Date(c.birthDate), bloodType: c.bloodType, gender: c.gender, allergies: c.allergies },
    })
  }

  // TODO usuário semeado tem foto: sem avatarKey a UI cai no círculo cinza do
  // DS e o mapa/listas ficam com "buracos" (QA de volume 2026-07-26). Os 8
  // contatos já ganharam a sua no laço acima; aqui fecham o worker demo e o
  // admin, que antes nasciam sem Profile completo.
  for (const p of [
    { user: worker, file: 'worker-demo.png', fullName: 'Worker Demo', sector: 'Operações', jobTitle: 'Operador de escavadeira', birthDate: '1994-02-17', bloodType: 'A+', gender: 'male', allergies: 'Poeira de sílica' },
    { user: admin, file: 'admin-1.png', fullName: 'Admin', sector: 'Gestão', jobTitle: 'Administrador', birthDate: '1986-06-09', bloodType: 'O+', gender: 'male', allergies: '' },
  ]) {
    let avatarKey = ''
    try { avatarKey = await uploadAvatarFile(p.file) }
    catch (e) { console.warn(`[seed] avatar ${p.file} falhou (bucket up?):`, (e as Error).message) }
    await prisma.profile.upsert({
      where: { userId: p.user.id },
      update: { fullName: p.fullName, sector: p.sector, jobTitle: p.jobTitle, avatarKey, birthDate: new Date(p.birthDate), bloodType: p.bloodType, gender: p.gender, allergies: p.allergies },
      create: {
        userId: p.user.id, fullName: p.fullName, sector: p.sector, jobTitle: p.jobTitle,
        avatarKey, birthDate: new Date(p.birthDate), bloodType: p.bloodType, gender: p.gender,
        allergies: p.allergies, city: 'São Paulo', uf: 'SP',
      },
    })
  }

  // Semeia conversas + mensagens (idempotente: apaga as conversas de "eu" e recria).
  const meId = worker.id
  const myConvIds = CONTACTS.map((c) => convKey(meId, contactIds.get(c.n)!))
  await prisma.message.deleteMany({ where: { conversationId: { in: myConvIds } } })
  await prisma.conversation.deleteMany({ where: { id: { in: myConvIds } } })

  const isoFor = (day: string, time: string) => new Date(`${day}T${time}:00.000Z`)
  for (const th of THREADS) {
    const otherId = contactIds.get(th.n)!
    const id = convKey(meId, otherId)
    const parts = [meId, otherId].sort()
    const other = CONTACTS.find((c) => c.n === th.n)!
    const otherAvatarKey = contactAvatarKeys.get(th.n) ?? ''
    await prisma.conversation.create({
      data: {
        id,
        participants: parts,
        participantNames: parts.map((p) => (p === meId ? 'Você' : other.name)),
        participantSubtitles: parts.map((p) => (p === meId ? '' : other.sector)),
        participantAvatarKeys: parts.map((p) => (p === meId ? '' : otherAvatarKey)),
        lastMessageBody: th.texts[th.texts.length - 1].body,
        lastMessageAt: isoFor(th.baseDay, th.texts[th.texts.length - 1].time),
        unreadByJson: th.unread > 0 ? { [meId]: th.unread } : {},
      },
    })
    for (const t of th.texts) {
      await prisma.message.create({
        data: {
          conversationId: id,
          senderId: t.from === 'me' ? meId : otherId,
          body: t.body,
          imageKey: null,
          sentAt: isoFor(th.baseDay, t.time),
        },
      })
    }
  }

  // ===== Fatia 7 (Tarefas/WorkOrder): ordens de serviço demo =====
  // Re-seed limpo: apaga TODAS as ordens (o cascade da FK Task.orderId remove os
  // itens junto) e recria. Idempotente.
  await prisma.workOrder.deleteMany({})

  // 4 cards canônicos do checklist — cópia EXATA (title+description) do mock
  // mobile SEED_BASE (mobile/services/journey/mockJourneyBackend.ts). O antigo
  // `objective` por-item sobe pro pai (WorkOrder.summary), não fica no item.
  const FLAGSHIP_ITEMS = [
    { title: 'Inspeção de Equipamentos',
      description: 'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.' },
    { title: 'Manutenção Preventiva',
      description: 'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.' },
    { title: 'Diagnóstico de Falhas',
      description: 'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.' },
    { title: 'Reparo de Componentes',
      description: 'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.' },
  ]
  const flagshipMinutes = distributeMinutes(480, FLAGSHIP_ITEMS.length) // [120,120,120,120] → 8h

  // Ordem carro-chefe: checklist de 4 itens, worker demo + 2 colegas responsáveis.
  await prisma.workOrder.create({
    data: {
      authorId: admin.id,
      title: 'Inspeção Técnica das Máquinas Pesadas',
      summary: 'Checklist de manutenção preventiva e reparos necessários',
      details: 'Percorrer o checklist de inspeção das máquinas pesadas do pátio, registrando desgastes e executando os reparos necessários no turno.',
      sector: 'Manutenção Industrial',
      estimatedMinutes: 480,
      startDate: today,
      dueDate: dueIn(30),
      status: 'pending',
      imageKeys: [],
      responsibles: { connect: [{ id: worker.id }, { id: contactIds.get(1)! }, { id: contactIds.get(2)! }] },
      items: {
        create: FLAGSHIP_ITEMS.map((it, i) => ({
          position: i,
          title: it.title,
          description: it.description,
          estimatedMinutes: flagshipMinutes[i] ?? null,
          status: 'pending',
          accumulatedSeconds: 0,
          progressPct: 0,
        })),
      },
    },
  })

  // Ordem SEM checklist (Decisão B): item único auto-gerado = título + summary da
  // ordem. Também atribuída ao worker demo (aparece na jornada dele).
  await prisma.workOrder.create({
    data: {
      authorId: admin.id,
      title: 'Trocar extintores do galpão 3',
      summary: 'Substituição dos extintores vencidos conforme a norma NR-23.',
      details: 'Substituição dos extintores vencidos conforme a norma NR-23.',
      sector: 'Segurança do Trabalho',
      estimatedMinutes: 60,
      startDate: today,
      dueDate: dueIn(7),
      status: 'pending',
      imageKeys: [],
      responsibles: { connect: [{ id: worker.id }] },
      items: {
        create: [{
          position: 0,
          title: 'Trocar extintores do galpão 3',
          description: 'Substituição dos extintores vencidos conforme a norma NR-23.',
          estimatedMinutes: 60,
          status: 'pending',
          accumulatedSeconds: 0,
          progressPct: 0,
        }],
      },
    },
  })

  // Ordens variadas atribuídas aos OUTROS workers — populam as 3 tabs do admin
  // (pending / in_progress / done). Os status dos itens justificam o status do
  // pai (um recompute manteria o mesmo valor).
  await prisma.workOrder.create({
    data: {
      authorId: admin.id,
      title: 'Reparo hidráulico da retroescavadeira',
      summary: 'Corrigir vazamento no circuito hidráulico e testar a pressão.',
      details: 'Troca de mangueiras e vedações do circuito hidráulico, seguida de teste de pressão em bancada.',
      sector: 'Manutenção Industrial',
      estimatedMinutes: 240,
      startDate: today,
      dueDate: dueIn(5),
      status: 'in_progress',
      imageKeys: [],
      responsibles: { connect: [{ id: contactIds.get(3)! }] },
      items: {
        create: [
          { position: 0, title: 'Substituir mangueiras', description: 'Trocar as mangueiras ressecadas do circuito.', estimatedMinutes: 120, status: 'paused', accumulatedSeconds: 1800, progressPct: 40 },
          { position: 1, title: 'Teste de pressão', description: 'Validar a pressão do circuito após o reparo.', estimatedMinutes: 120, status: 'pending', accumulatedSeconds: 0, progressPct: 0 },
        ],
      },
    },
  })

  await prisma.workOrder.create({
    data: {
      authorId: admin.id,
      title: 'Alocação de maquinário — Frente 12',
      summary: 'Deslocamento e posicionamento das máquinas para a nova frente de lavra.',
      details: 'Coordenar o transporte e o posicionamento das máquinas pesadas na frente de lavra 12.',
      sector: 'Operações',
      estimatedMinutes: 180,
      startDate: dueIn(-3),
      dueDate: dueIn(-1),
      status: 'done',
      imageKeys: [],
      responsibles: { connect: [{ id: contactIds.get(4)! }, { id: contactIds.get(5)! }] },
      items: {
        create: [
          { position: 0, title: 'Transporte das máquinas', description: 'Deslocar as máquinas até a frente 12.', estimatedMinutes: 90, status: 'done', accumulatedSeconds: 5400, progressPct: 100 },
          { position: 1, title: 'Posicionamento e nivelamento', description: 'Posicionar e nivelar as máquinas no ponto de operação.', estimatedMinutes: 90, status: 'done', accumulatedSeconds: 5400, progressPct: 100 },
        ],
      },
    },
  })

  await prisma.workOrder.create({
    data: {
      authorId: admin.id,
      title: 'Vistoria de EPIs do turno noturno',
      summary: 'Conferência dos equipamentos de proteção individual antes do turno.',
      details: 'Vistoriar e registrar a conformidade dos EPIs distribuídos ao turno noturno.',
      sector: 'Segurança do Trabalho',
      estimatedMinutes: 90,
      startDate: dueIn(1),
      dueDate: dueIn(10),
      status: 'pending',
      imageKeys: [],
      responsibles: { connect: [{ id: contactIds.get(6)! }] },
      items: {
        create: [
          { position: 0, title: 'Conferir capacetes e óculos', description: 'Checar integridade e validade dos capacetes e óculos.', estimatedMinutes: 45, status: 'pending', accumulatedSeconds: 0, progressPct: 0 },
          { position: 1, title: 'Conferir protetores auriculares', description: 'Checar o estoque e a condição dos protetores auriculares.', estimatedMinutes: 45, status: 'pending', accumulatedSeconds: 0, progressPct: 0 },
        ],
      },
    },
  })

  // ===== Fatia 5 (Notificações): feed demo do worker (Opção A, fidelidade) =====
  // Migrado do array estático de mockNotificationBackend.ts (12 itens). createdAt
  // decrescente (1º = mais recente); mix read/unread. targetId null (deep-link a
  // recurso específico = pendência; a tela roteia por domain).
  const NOTIF_BASE = new Date('2026-06-23T15:00:00.000Z')
  const notifAt = (min: number) => new Date(NOTIF_BASE.getTime() - min * 60_000)
  const SEED_NOTIFS: { title: string; body: string; domain: NotificationDomain; read: boolean; min: number }[] = [
    { title: 'Alerta Meteorológico', body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', domain: 'weather', read: false, min: 5 },
    { title: 'Atividade de Colaborador', body: 'Ana atualizou o status da manutenção preventiva no setor de produção.', domain: 'chat', read: false, min: 30 },
    { title: 'Feedback Recebido', body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.', domain: 'chat', read: false, min: 90 },
    { title: 'Novo Relatório Atribuído', body: 'Relatório de segurança do setor 5 foi designado para sua análise.', domain: 'reports', read: true, min: 180 },
    { title: 'Relatório de Qualidade', body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.', domain: 'reports', read: true, min: 240 },
    { title: 'Notificação de Treinamento', body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.', domain: 'journey', read: true, min: 300 },
    { title: 'Nova Tarefa Atribuída', body: 'Realizar auditoria dos processos de armazenamento até o final da semana.', domain: 'journey', read: true, min: 360 },
    { title: 'Nova Inspeção Programada', body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.', domain: 'journey', read: true, min: 420 },
    { title: 'Mudança no Cronograma', body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.', domain: 'journey', read: true, min: 480 },
    { title: 'Comentário em Relatório', body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`, domain: 'chat', read: true, min: 540 },
    { title: 'Atualização de Procedimento', body: 'Procedimento de emergência revisado e disponível para consulta.', domain: 'faq', read: true, min: 600 },
    { title: 'Novo Comentário', body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`, domain: 'chat', read: true, min: 660 },
  ]
  await prisma.notification.deleteMany({ where: { workerId: worker.id } }) // idempotente
  for (const n of SEED_NOTIFS) {
    await prisma.notification.create({
      data: { workerId: worker.id, title: n.title, body: n.body, domain: n.domain, read: n.read, createdAt: notifAt(n.min) },
    })
  }

  // ===== Fatia (Relatórios): 12 relatórios ricos + imagens + comentários demo =====
  // Espelha o mock do admin (swi-admin/src/services/mockApi/reports.ts REPORTS_SEED
  // + DEMO_DETAILS). As 3 imagens de inspeção sobem UMA vez pro MinIO e são reusadas
  // em todos os relatórios (imageKeys). Autor rotaciona sobre os 8 workers semeados.

  // Sobe as 3 imagens de inspeção uma única vez (guard próprio: bucket down → '').
  const reportImageKeys: string[] = []
  for (const fn of ['inspection-1.png', 'inspection-2.png', 'inspection-3.png']) {
    try {
      const k = await uploadReportImage(fn)
      if (k) { reportImageKeys.push(k); console.log(`[seed] report image up: ${k}`) }
    } catch (e) {
      console.warn(`[seed] report image ${fn} falhou (bucket up?):`, (e as Error).message)
    }
  }

  // Detalhes/atividades demo (mesmo corpo pra todos, paridade com DEMO_DETAILS do
  // mock). As atividades NÃO carregam avatares aqui — o admin decora na renderização.
  const REPORT_DETAILS =
    'Inspeção realizada nas máquinas pesadas da Mina Córrego Seco, com foco especial no equipamento Komatsu K35E. Inicia o checklist abrangente de manutenção preventiva, abordando desde a verificação dos níveis de óleo e filtros até a substituição de componentes desgastados. A equipe técnica também realizou ajustes de calibração nos sistemas hidráulicos e elétricos, garantindo o desempenho ótimo dos equipamentos. Foram identificadas e corrigidas pequenas falhas no sistema de ignição de uma das escavadeiras, contribuindo para sua eficiência operacional aprimorada. Adicionalmente, foi realizada uma verificação minuciosa nos pneus, monitorando o desgaste e a pressão para garantir a segurança e o bom funcionamento das máquinas em todas as operações de mineração.'
  // `responsibleNames`: equipes REAIS do CONTACTS (o Figma desenha rostos por
  // atividade; faces decorativas foram banidas no QA 2026-07-26 — decisão do
  // usuário: seguir o Figma COM gente de verdade). O read resolve nome → foto
  // via avatarsForNames, igual aos responsáveis do relatório.
  const REPORT_ACTIVITIES = [
    { title: 'Verificação de níveis de óleo e filtros', sector: 'Setor Noroeste', progress: 80, tone: 'success', responsibleNames: ['Josué Oliveira', 'Ezequiel Almeida'] },
    { title: 'Manutenção de motores', sector: 'Setor Noroeste', progress: 50, tone: 'warning', responsibleNames: ['Carlos Santos (Manut.)', 'Romulo Cardoso'] },
    { title: 'Ajustes de sistemas elétricos', sector: 'Setor Central', progress: 30, tone: 'error', responsibleNames: ['Antonio Carlos Figueira', 'Adriana Santos Almeida', 'Jennifer Gomes'] },
  ]

  // Fixture espelhando REPORTS_SEED (title/summary/status/statusLabel/creationDate/
  // sector/responsibles). Datas dd/mm/yyyy → Date (UTC midnight).
  // `responsibles` NÃO vem da fixture: era a mesma dupla inventada ("Ana Clara
  // Mendonça, Antonio Hayde") nos 12 relatórios, gente que não existe no quadro.
  // Agora sai do próprio CONTACTS, rotacionando (QA 2026-07-26).
  type ReportFx = { title: string; summary: string; status: 'accept' | 'pending' | 'canceled' | 'info'; statusLabel: string; creationDate: string; sector: string }
  const REPORTS_FX: ReportFx[] = [
    { title: 'Inspeção Técnica das Máquinas Pesadas', summary: 'Checklist de manutenção preventiva e reparos necessários nos equipamentos da frota.', status: 'pending', statusLabel: 'Em Revisão', creationDate: '12/04/2026', sector: 'Setor Nordeste' },
    { title: 'Relatório de Eficiência Energética da Mina Oeste', summary: 'Análise de consumo e indicadores de eficiência energética por turno e equipamento.', status: 'accept', statusLabel: 'Concluído', creationDate: '08/04/2026', sector: 'Setor Nordeste' },
    { title: 'Análise de Qualidade do Solo na Região Sul', summary: 'Resultados de amostragem geoquímica para validar qualidade do solo na nova frente.', status: 'info', statusLabel: 'Em Andamento', creationDate: '02/04/2026', sector: 'Setor Sul' },
    { title: 'Relatório de Treinamento e Capacitação', summary: 'Resumo das ações de treinamento realizadas e avaliação dos participantes do mês.', status: 'accept', statusLabel: 'Concluído', creationDate: '28/03/2026', sector: 'Setor Nordeste' },
    { title: 'Avaliação de Impacto Ambiental da Mina Central', summary: 'Identificação das principais frentes de impacto ambiental e plano de mitigação.', status: 'pending', statusLabel: 'Em Revisão', creationDate: '25/03/2026', sector: 'Setor Nordeste' },
    { title: 'Estudo de Riscos Geológicos da Região Centro', summary: 'Mapeamento de falhas e áreas com risco geotécnico identificadas no semestre.', status: 'accept', statusLabel: 'Concluído', creationDate: '18/03/2026', sector: 'Setor Centro' },
    { title: 'Relatório de Produtividade da Mina Oeste', summary: 'Compara projeção de produção com volume realizado nos últimos três meses.', status: 'info', statusLabel: 'Em Andamento', creationDate: '12/03/2026', sector: 'Setor Nordeste' },
    { title: 'Análise de Custos Operacionais da Mina Leste', summary: 'Levantamento de custos diretos e indiretos, com sugestão de cortes para Q2.', status: 'accept', statusLabel: 'Concluído', creationDate: '04/03/2026', sector: 'Setor Nordeste' },
    { title: 'Monitoramento Hidrológico da Zona Leste', summary: 'Dados dos sensores hidrológicos e variações observadas nas últimas duas semanas.', status: 'pending', statusLabel: 'Em Revisão', creationDate: '25/02/2026', sector: 'Setor Nordeste' },
    // Desvio proposital do mock (que nunca emite 'canceled'): 1 relatório cancelado
    // pra exercitar o filtro "Cancelado" do admin, que sem isso ficaria morto.
    { title: 'Relatório de Condições Meteorológicas da Mina Norte', summary: 'Compilação de dados meteorológicos e impacto nas operações da última quinzena.', status: 'canceled', statusLabel: 'Cancelado', creationDate: '20/02/2026', sector: 'Setor Nordeste' },
    { title: 'Relatório de Segurança da Planta Sul', summary: 'Análise dos protocolos de segurança aplicados e ocorrências reportadas no mês.', status: 'info', statusLabel: 'Em Andamento', creationDate: '15/02/2026', sector: 'Setor Sul' },
    { title: 'Relatório de Sustentabilidade Corporativa', summary: 'Indicadores ESG do trimestre, metas atingidas e ações para os próximos ciclos.', status: 'accept', statusLabel: 'Concluído', creationDate: '10/02/2026', sector: 'Setor Nordeste' },
  ]
  const parseBrDate = (s: string): Date => {
    const [d, m, y] = s.split('/').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }

  // Re-seed limpo: apaga comentários e relatórios anteriores (idempotente).
  await prisma.comment.deleteMany({})
  await prisma.report.deleteMany({})

  const createdReports: { id: string }[] = []
  for (let i = 0; i < REPORTS_FX.length; i++) {
    const fx = REPORTS_FX[i]
    const workerN = (i % CONTACTS.length) + 1 // rotaciona 1..8
    const authorContact = CONTACTS.find((c) => c.n === workerN)!
    // 2 responsáveis reais, os dois colegas seguintes na roda — nunca o autor.
    const responsibles = [1, 2].map(
      (offset) => CONTACTS[(workerN - 1 + offset) % CONTACTS.length].name,
    )
    const r = await prisma.report.create({
      data: {
        authorId: contactIds.get(workerN)!,
        title: fx.title,
        summary: fx.summary,
        status: fx.status,
        statusLabel: fx.statusLabel,
        authorName: authorContact.name,
        authorAvatarKey: contactAvatarKeys.get(workerN) || null,
        creationDate: parseBrDate(fx.creationDate),
        sector: fx.sector,
        responsibles,
        details: REPORT_DETAILS,
        imageKeys: reportImageKeys,
        activities: REPORT_ACTIVITIES,
      },
    })
    createdReports.push({ id: r.id })
  }

  // Comentários demo em 2 relatórios (autor: admin e um worker).
  if (createdReports[0]) {
    await prisma.comment.create({
      data: { reportId: createdReports[0].id, authorId: admin.id, body: 'Revisado. Anexar as fotos do checklist de óleo antes de aprovar.' },
    })
  }
  if (createdReports[2]) {
    await prisma.comment.create({
      data: { reportId: createdReports[2].id, authorId: contactIds.get(3)!, body: 'Amostras coletadas na frente nova; laudo geoquímico sai até sexta.' },
    })
  }

  console.log('[seed] reports:', await prisma.report.count(), 'comments:', await prisma.comment.count())

  // ===== Fatia 6 (Clima): dedup pré-marcado =====
  // Pré-marca o alerta de demo (wx-0) como já notificado → o cron NÃO duplica a
  // notificação 'weather' que este seed já cria. O smoke prova o gatilho ao vivo
  // com um id fresco / truncando WeatherAlertSeen.
  await prisma.weatherAlertSeen.upsert({ where: { alertId: DEMO_STORM_ALERT_ID }, update: {}, create: { alertId: DEMO_STORM_ALERT_ID } })
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
