import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

/**
 * Profile  — personal + address data the worker edits about themselves
 *            (complementary-data step-1 + step-2). owner = the worker.
 * HealthData — clinical data (step-3 / settings health-data). Decision 5:
 *            edited by admin/occupational-health, READ-ONLY for the worker.
 *            `workerId` carries the worker's Cognito sub so the worker can
 *            read their own record even though an admin created it.
 *            NOTE: HealthData is defined now so the schema is correct, but
 *            it is NOT wired to the app in this slice (admin tooling first).
 */
const schema = a.schema({
  Profile: a
    .model({
      fullName: a.string(),
      phone: a.string(),
      cpf: a.string(),
      birthDate: a.date(),
      cep: a.string(),
      street: a.string(),
      number: a.string(),
      complement: a.string(),
      neighborhood: a.string(),
      city: a.string(),
      uf: a.string(),
    })
    .authorization((allow) => [
      allow.owner().to(['read', 'create', 'update']),
      allow.group('admin'),
    ]),

  HealthData: a
    .model({
      workerId: a.string().required(),
      gender: a.string(),
      height: a.float(),
      weight: a.float(),
      bloodType: a.string(),
      disability: a.string(),
    })
    .authorization((allow) => [
      allow.group('admin'),
      allow.ownerDefinedIn('workerId').to(['read']),
    ]),

  VitalsSample: a
    .model({
      workerId: a.string().required(),
      recordedAt: a.datetime().required(),
      heartRate: a.integer(),
      bloodPressureSys: a.integer(),
      bloodPressureDia: a.integer(),
      oxygenation: a.float(),
      caloriesPerHour: a.integer(),
      steps: a.integer(),
      distanceKm: a.float(),
      effortPct: a.float(),
      fatiguePct: a.float(),
      fatigueEtaMin: a.integer(),
      status: a.enum(['good', 'alert', 'low']),
      expiresAt: a.integer(), // epoch seconds — DynamoDB TTL (raw-data cost cap)
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['create', 'read']),
      allow.group('admin').to(['read']),
    ]),

  LocationSample: a
    .model({
      workerId: a.string().required(),
      recordedAt: a.datetime().required(),
      lat: a.float().required(),
      lng: a.float().required(),
      accuracy: a.float(),
      expiresAt: a.integer(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['create', 'read']),
      allow.group('admin').to(['read']),
    ]),

  Report: a
    .model({
      title: a.string().required(),
      summary: a.string(),
      status: a.enum(['accept', 'pending', 'canceled', 'info']),
      statusLabel: a.string(),
      authorName: a.string(),
      authorAvatarKey: a.string(),
      creationDate: a.datetime(),
      sector: a.string(),
      responsibles: a.string().array(),
      details: a.string(),
      imageKeys: a.string().array(),
      // [{ id,title,sector,progress(0-100),tone:'success'|'warning'|'error',avatars:string[],overflowCount? }]
      activities: a.json(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.owner().to(['create', 'read']),
      allow.group('admin'),
    ]),

  Journey: a
    .model({
      workerId: a.string().required(),     // Cognito sub
      date: a.date(),                       // o dia ("Hoje")
      state: a.enum(['idle', 'ongoing', 'paused']),
      activeTaskId: a.string(),
      startedAt: a.datetime(),              // 1ª task iniciada
      accumulatedSeconds: a.integer(),      // tempo do turno antes da pausa atual
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['read', 'create', 'update']),
      allow.group('admin'),
    ]),

  Task: a
    .model({
      assignedTo: a.string().required(),    // Cognito sub do worker
      title: a.string().required(),
      description: a.string(),
      objective: a.string(),
      estimatedMinutes: a.integer(),
      status: a.enum(['pending', 'in_progress', 'paused', 'done']),
      startedAt: a.datetime(),              // âncora p/ progresso real
      accumulatedSeconds: a.integer(),      // tempo trabalhado antes da pausa
      progressPct: a.float(),               // snapshot gravado nas transições
      scheduledDate: a.date(),              // "Hoje" — escopo da lista
      imageKeys: a.string().array(),        // S3 keys (uris no mock)
      interestedCount: a.integer(),
      interestedAvatarKeys: a.string().array(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('assignedTo').to(['read', 'update']),
      allow.group('admin'),
    ]),

  Conversation: a
    .model({
      participants: a.string().array().required(),   // [meSub, themSub] (Cognito subs)
      participantNames: a.string().array(),          // snapshot denorm paralelo (sem join)
      participantSubtitles: a.string().array(),      // "Setor Leste"
      participantAvatarKeys: a.string().array(),     // avatar keys (uris no mock)
      lastMessageBody: a.string(),                   // preview do inbox (compartilhado)
      lastMessageAt: a.datetime(),                   // ordenação do inbox
      unreadByJson: a.json(),                         // { [sub]: count } — unread POR-viewer
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participants'),
      allow.group('admin'),
    ]),

  Message: a
    .model({
      conversationId: a.string().required(),         // FK lógico (lista por conversationId; sem hasMany)
      participants: a.string().array().required(),   // denormaliza p/ ownersDefinedIn
      senderId: a.string().required(),               // autor (define me/them na bubble)
      body: a.string(),                              // texto (pode ser vazio se só imagem)
      imageKey: a.string(),                          // anexo S3 opcional (uri no mock)
      sentAt: a.datetime().required(),               // ordenação + "time" da bubble
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participants'),
      allow.group('admin'),
    ]),

  Contact: a
    .model({
      workerId: a.string().required(),               // Cognito sub
      name: a.string().required(),
      sector: a.string(),                            // → subtitle do card
      role: a.string(),                              // "Operador de escavadeira" (header user-info)
      avatarKey: a.string(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),            // roster público não-sensível
      allow.group('admin'),
    ]),

  Notification: a
    .model({
      workerId: a.string().required(),               // Cognito sub do destinatário
      title: a.string().required(),
      body: a.string(),
      domain: a.enum(['weather', 'chat', 'reports', 'journey', 'faq']), // → rota no cliente
      targetId: a.string(),                          // id de recurso específico (deep-link futuro)
      read: a.boolean(),                             // por-destinatário (1 destinatário → boolean)
      // ordenação por recência usa o timestamp de sistema `createdAt` do Amplify;
      // o mirror do mobile carrega um createdAt ISO próprio (sem campo redundante).
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('workerId').to(['read', 'update']), // worker lê + marca lida
      allow.group('admin'),                                    // backend/admin cria
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
