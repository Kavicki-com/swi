# SWI Backend — Fatia 2: Relatórios + MinIO (design)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Fatia 2 da rodada dos domínios não-saúde
> (`2026-07-02-swi-backend-dominios-nao-saude-design.md`). Sucede as fatias 0
> (Fundação, PR #23) e 1 (Perfil, PR #25), ambas mergeadas na `main`.

## Contexto

O model `Report` já existe (Fatia 0). O seam mobile de Relatórios já está pronto
da era Amplify: `ReportsBackend` (`list/get/create`), `ReportsProvider`, telas
`reports/index|[id]|new` com estados loading/empty/error, e `getReportsBackend`
**pinado em mock** (ignora `DATA_BACKEND`). Esta fatia constrói o lado servidor
NestJS, introduz a **1ª infra de mídia** (MinIO) e troca o stub pinado por um
cliente REST `apiReportsBackend`, destravando o selector para `'api'`.

Contrato mobile (intocado): `list()`, `get(id)`, `create(input)` — **sem
update/delete** (a UI não edita nem apaga). Mídia: o app lida com URIs locais
(`expo-image-picker`), o backend com keys de objeto.

## Decisões (2026-07-02)

| Tema | Decisão |
| --- | --- |
| **Mídia** | **Presigned URLs (MinIO direto)**: app faz `PUT` direto no MinIO via URL presigned; fotos renderizam por `GET` presigned (assinatura na query, sem header de auth na `<Image>`). Paridade S3 real, código de servidor enxuto. |
| **Cliente S3** | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Contra MinIO: `endpoint` + `forcePathStyle:true`; em AWS remove ambos via env, código intacto ("em AWS vira S3 sem mudar código"). |
| **Caminho de leitura** | Backend **embute as URLs presigned GET na resposta** do relatório (`images`, `authorAvatarUri` já vêm prontos). `apiReportsBackend` fica quase identidade; sem endpoint de presign-GET exposto ao cliente. |
| **Escopo do inbox** | `GET /reports` devolve **todos** os relatórios (org-wide), `createdAt desc` — paridade com o mock (10 seeds de autores variados). |
| **Autoria** | `authorId` do JWT; **denorm** `authorName = profile.fullName ?? user.name`, `authorAvatarKey = profile.avatarKey`, `sector = profile.sector`. Defaults na criação: `status:'pending'`, `statusLabel:'Em Revisão'`, `activities:[]`. |
| **Sem update/delete** | Contrato mobile não tem — YAGNI. |

## Arquitetura

Espelha a Fatia 1 (profile): módulo Nest `controller → guard JWT → service →
Prisma`, mais o módulo de mídia reutilizável (Chat reusa na Fatia 4).

### Infra — `docker-compose.yml`
- Novo serviço `minio` (`minio/minio server /data --console-address ":9001"`),
  portas 9000 (S3 API) + 9001 (console), volume `swi_minio`,
  `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, healthcheck.
- Novo serviço `minio-init` (`minio/mc`, roda uma vez): espera o MinIO,
  `mc alias set` + `mc mb --ignore-existing swi-media`. **Criação do bucket sai
  do app** (em AWS = IaC), então o Nest não faz rede pro MinIO no boot — o e2e
  sobe o `AppModule` inteiro sem MinIO up.
- `api` ganha env:
  - `MINIO_PUBLIC_URL` — endpoint que as URLs presigned usam (a assinatura é
    atada ao host). Dev/QA: `http://localhost:9000` (iOS sim/web) ou
    `http://10.0.2.2:9000` (Android emu) ou túnel ngrok do MinIO (device físico);
    AWS: **unset** → SDK usa o endpoint real do S3.
  - `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`, `MINIO_BUCKET=swi-media`,
    `MINIO_REGION=us-east-1` (MinIO ignora; o SigV4 exige uma região).

### Backend — `src/media/` (reutilizável)
- `MediaService`: **um** client S3 (`@aws-sdk/client-s3`) com
  `endpoint = MINIO_PUBLIC_URL` (unset em AWS), `forcePathStyle:true`, `region`,
  `credentials`. **Só presigna** — computação pura, **zero rede em runtime**
  (o cliente faz PUT/GET direto no MinIO). Sem `onModuleInit`, sem `ensureBucket`.
  - Métodos: `presignPut(contentType) → {url, key}` (key namespaced
    `reports/<uuid>.<ext>`), `presignGet(key) → url` (TTL curto), `presignGetMany`.
  - `presignPut` assina só `Bucket`+`Key` (não constrange content-type) → o
    cliente RN faz `PUT` do blob sem risco de signature-mismatch de header.
- `MediaController`: `POST /media/presign` (guarded, valida
  `contentType ∈ {image/jpeg, image/png}`) → `{url, key}`. Genérico — Chat reusa
  com prefixo `chat/`.

### Backend — `src/reports/` (espelha profile)
- `ReportsController` (`@UseGuards(JwtAuthGuard)`):
  - `GET /reports` → todos, `createdAt desc`.
  - `GET /reports/:id` → 404 se sumido.
  - `POST /reports` → cria.
- `ReportsService`: `list/get` + `create(authorId, dto)` (denorm + defaults).
  Um `toDto()` **async** mapeia `imageKeys → presignGet`, `authorAvatarKey →
  presignGet`, formata `creationDate → dd/mm/yyyy` e coalesce `null → ''` nos
  campos string que as telas exigem (`summary`, `sector`, `authorAvatarUri`, …).
- `CreateReportDto` (class-validator; **whitelist** já é global no APP_PIPE):
  `title` obrigatório; `summary`/`details` opcionais; `responsibles: string[]`;
  `imageKeys: string[]`. Cliente **não** seta `status`/`authorId`/`authorName`
  (anti mass-assignment).

### Mobile
- `services/api/uploadMedia.ts` (novo, **fundação** p/ Chat):
  `uploadToPresigned(url, uri, contentType)` — `fetch(uri)` → `.blob()` → `PUT`.
  Content-type inferido da extensão (default `image/jpeg`).
- `services/reports/apiReportsBackend.ts` (novo):
  - `list()` / `get(id)` via `apiRequest` (get com 404→null, como profile).
  - `create(input)`: p/ cada `imageUri` → `POST /media/presign` + upload →
    coleta keys → `POST /reports {…, imageKeys}` → `fromApi`.
  - `fromApi` quase identidade (server já devolve URLs + formato prontos).
- `services/reports/getReportsBackend.ts`: passa a honrar `DATA_BACKEND` (igual
  `getProfileBackend`). `getReportsBackend.test.ts` atualizado p/ esperar api
  quando `flag=api` (mesmo shape do `getProfileBackend.test`).

## Fluxo de dados (create com foto)

```
app  -- POST /media/presign {contentType} -->  backend --> {url, key}
app  -- PUT bytes -------------------------->  MinIO (via url presigned)
app  -- POST /reports {..., imageKeys:[key]} -->  backend (denorm + persiste)
app  -- GET /reports ----------------------->  backend --> images:[presignedGetUrl]
<Image source={{ uri: presignedGetUrl }}>   renderiza direto
```

## Tratamento de erros

Corpo consistente `{statusCode, message}` (padrão auth/profile). `apiRequest` já
anexa `.status` (404 esperado vs 500/rede). Presign valida content-type
(400 em tipo inválido). Falha de upload no `create` propaga — a tela já tem
estado de erro.

## Testes + verificação (disciplina da rodada)

- **Backend**:
  - unit `reports.service.spec` (Prisma mockado: ordem `desc`, denorm, defaults)
    + `media.service.spec` (geração de key + shape do presign, S3 client mockado).
  - e2e `reports.e2e-spec` (supertest vs Postgres real, usuário throwaway):
    401 sem token; `create` → `list` contém e newest-first; `get` 404 p/ inexistente;
    whitelist descarta `status`/`authorId` (anti mass-assignment). Presign e2e:
    `POST /media/presign` devolve `{url,key}` (URL é computada — **não** precisa
    MinIO up).
  - **docker smoke** (com MinIO real): presign → PUT bytes → create com key →
    GET → a URL da imagem responde 200 e entrega os bytes.
- **Mobile**: jest (`apiReportsBackend` com fetch mockado: sequência
  presign+upload+create; `fromApi`; selector `getReportsBackend`), tsc 0 novos
  (8 baseline), expo export web exit 0.
- Two-gate (spec + quality) por metade + review holística por fatia; commit por
  task **só com luz verde explícita** do usuário.
- Teste manual no dev build (`EXPO_PUBLIC_DATA_BACKEND=api` no `.env` do Metro).

## Não-objetivos / notas

- **Sem update/delete** (contrato mobile não tem).
- `activities` não são geradas (sem UI admin); persistem `[]` e round-trip.
- **Custo de QA aceito**: teste em device sobre ngrok exige expor o MinIO num
  túnel próprio (3º) + `MINIO_PUBLIC_URL`. No emulador/web na mesma máquina,
  `localhost:9000` basta.
- Avatar sem `avatarKey` → `authorAvatarUri: ''` (DS Avatar cai no fallback);
  upload de avatar real é concern do Profile, fora desta fatia.
- **Deploy** (herança da rodada): MinIO → S3 (dropar `endpoint`/`forcePathStyle`),
  bucket + policy via IaC, secrets via SSM.
