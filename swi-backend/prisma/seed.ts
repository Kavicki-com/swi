import { PrismaClient, type NotificationDomain } from '@prisma/client'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEMO_STORM_ALERT_ID } from '../src/weather/weather.types'
import { hash } from '../src/auth/codes'
import { distributeMinutes } from '../src/work-orders/order-status'
const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.user.upsert({
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
  const dueIn = (days: number) => new Date(today.getTime() + days * 86_400_000)

  // ===== Fatia 4 (Chat): diretório + conversas/mensagens demo (Opção A) =====
  // conversationKey: paridade EXATA com mobile/services/chat/chatReducers.ts
  const convKey = (a: string, b: string) => [a, b].sort().join('#')

  const CONTACTS = [
    { n: 1, email: 'romulo@swi.local',   name: 'Romulo Cardoso',          sector: 'Setor Leste', role: 'Operador' },
    { n: 2, email: 'ezequiel@swi.local', name: 'Ezequiel Almeida',        sector: 'Setor Leste', role: 'Operador' },
    { n: 3, email: 'josue@swi.local',    name: 'Josué Oliveira',          sector: 'Setor Leste', role: 'Técnico de Manutenção' },
    { n: 4, email: 'carlos@swi.local',   name: 'Carlos Santos',           sector: 'Setor Leste', role: 'Operador' },
    { n: 5, email: 'antonio@swi.local',  name: 'Antonio Carlos Figueira', sector: 'Setor Leste', role: 'Supervisor' },
    { n: 6, email: 'jennifer@swi.local', name: 'Jennifer Gomes',          sector: 'Setor Leste', role: 'Analista de Segurança' },
    { n: 7, email: 'adriana@swi.local',  name: 'Adriana Santos Almeida',  sector: 'Setor Leste', role: 'Operadora' },
    { n: 8, email: 'compressor@swi.local', name: 'Carlos Santos (Manut.)', sector: 'Setor Leste', role: 'Operador' },
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
  const uploadChatAvatar = async (n: number): Promise<string> => {
    const key = `chat/avatars/worker-${n}.png`
    await chatS3.send(new PutObjectCommand({
      Bucket: chatBucket, Key: key,
      Body: readFileSync(join(__dirname, 'fixtures', 'chat-avatars', `worker-${n}.png`)),
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
      update: { approvalStatus: 'APPROVED', emailVerified: true },
      create: { email: c.email, name: c.name, passwordHash: chatPass, role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
    })
    contactIds.set(c.n, u.id)
    await prisma.profile.upsert({
      where: { userId: u.id },
      update: { fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey },
      create: { userId: u.id, fullName: c.name, sector: c.sector, jobTitle: c.role, avatarKey },
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

  // ===== Fatia 6 (Clima): dedup pré-marcado =====
  // Pré-marca o alerta de demo (wx-0) como já notificado → o cron NÃO duplica a
  // notificação 'weather' que este seed já cria. O smoke prova o gatilho ao vivo
  // com um id fresco / truncando WeatherAlertSeen.
  await prisma.weatherAlertSeen.upsert({ where: { alertId: DEMO_STORM_ALERT_ID }, update: {}, create: { alertId: DEMO_STORM_ALERT_ID } })
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
