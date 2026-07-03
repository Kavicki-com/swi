import { PrismaClient, type NotificationDomain } from '@prisma/client'
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
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
