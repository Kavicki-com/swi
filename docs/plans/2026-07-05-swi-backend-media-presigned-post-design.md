# SWI Backend (container) — Media presigned-POST + content-length-range (limite de tamanho de upload) — design

> Doc **temporário** (`docs/plans/*backend*`): deletar quando o backend inteiro estiver
> implementado. **Primeiro dos "diferidos pós-H3"** (a fase de hardening H1–H3 está completa:
> #32/#33/#34/#35). Era o item 1 dos diferidos do H3b: o fix **real** do limite de tamanho de
> upload, que o usuário mandou fazer "após terminar o H3".

## Contexto

Hoje `MediaService.presignPut` (`media.service.ts:36`) assina **só Bucket+Key** via
`PutObjectCommand` + `getSignedUrl` → o cliente PUTa **qualquer tamanho**. O content-type já é
restrito **no presign** (`PresignDto` `IsIn` jpeg/png + extensão da key), mas nada impõe o
tamanho nem garante que os bytes enviados batam com o content-type assinado. Vetor de abuso:
um worker autenticado craftando um PUT gigante pra key presigned.

O fix **real** (não meia-solução) = **presigned POST** com uma **policy** que o S3/MinIO impõe no
ato do upload: `content-length-range [0, 15MB]` + `Content-Type` travado. É **quebrante** porque
muda o shape de `POST /media/presign` (`{url,key}`→`{url,fields,key}`) e o mecanismo de upload no
mobile (PUT→**POST multipart**) — por isso ficou fora do H3b (backend-only) e virou fatia
coordenada backend+mobile.

**Decisão do usuário (2026-07-05):** limite = **15 MB** (generoso — o `useMediaPicker` já comprime
via `quality`, fotos ficam 1-3MB; 15MB nunca rejeita upload legítimo, só barra o absurdo).

## Escopo / não-quebra do resto

- Branch `feat/backend-media-presigned-post` de `main`@`1ace63a`. Toca **`swi-backend/` + `mobile/`**
  (permitido pra `feat/backend-*`; NÃO toca `swi-admin/`).
- **Mock path (`DATA_BACKEND=mock`) intocado** — `uploadImage` é só do api-path; os mock backends
  devolvem keys canned sem chamar `/media/presign`.
- **Endpoints de create inalterados** — reports/journey/chat continuam recebendo **keys**; a leitura
  (`presignGet`/`toDto` embutindo URLs GET) segue igual. Blast radius: `MediaService` +
  `MediaController` + `mobile/services/api/uploadMedia.ts` (+ specs).

## Estado real auditado (código, não memória)

- `media.service.ts:34-40` — `presignPut(contentType, prefix='reports')`: `key =
  ${prefix}/${randomUUID()}.${ext}`; `getSignedUrl(s3, new PutObjectCommand({Bucket,Key}), {expiresIn:300})`
  → `{url, key}`. `presignGet`/`presignGetMany` separados (inalterados nesta fatia).
- `media.controller.ts:11-14` — `POST /media/presign` (JWT) → `this.media.presignPut(dto.contentType, dto.prefix ?? 'reports')`.
- `media/dto.ts` — `PresignDto`: `contentType` `IsIn(['image/jpeg','image/png'])`, `prefix?` `IsIn(['reports','task','chat'])`.
- `mobile/services/api/uploadMedia.ts` — `uploadImage(uri, prefix='reports')`: presign → `fetch(uri).blob()`
  → `fetch(url, {method:'PUT', headers:{'Content-Type'}, body:blob})` → key. Callers: `apiReportsBackend`
  (N imagens, `Promise.all`), `apiJourneyBackend` (prefix `task`), `apiChatBackend` (prefix `chat`).
- Deps: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` presentes; **`@aws-sdk/s3-presigned-post` NÃO** → dep nova.

## Decisões

### Backend

**Dep nova:** `@aws-sdk/s3-presigned-post` (mesma linha `^3.10xx` dos outros `@aws-sdk/*`, evita mismatch).

**`MediaService.presignPut` → `presignPost(contentType, prefix)`:**

```ts
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024   // 15 MB (decisão do usuário)

async presignPost(contentType: string, prefix = 'reports'): Promise<{ url: string; fields: Record<string, string>; key: string }> {
  const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
  const { url, fields } = await createPresignedPost(this.s3, {
    Bucket: this.bucket,
    Key: key,
    Expires: 300,                                   // 5 min pra subir (paridade com o PUT_TTL)
    Conditions: [
      ['content-length-range', 0, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
  })
  return { url, fields, key }
}
```

`presignGet`/`presignGetMany` **inalterados**. A config do `S3Client` (endpoint/forcePathStyle p/
MinIO; credenciais condicionais p/ IAM em AWS) já suporta POST policy — o `url` aponta pro
`MINIO_PUBLIC_URL` (host-facing), igual ao PUT de hoje.

**`MediaController`** `POST /media/presign` → devolve `{ url, fields, key }` (era `{url,key}`).

### Mobile

**`uploadImage(uri, prefix)`** — presign → FormData (**fields primeiro, file por ÚLTIMO** —
requisito do S3 POST: campos após `file` são ignorados) → `POST` multipart:

```ts
const { url, fields, key } = await apiRequest<{ url: string; fields: Record<string,string>; key: string }>(
  '/media/presign', { method: 'POST', body: { contentType, prefix }, auth: true })
const form = new FormData()
Object.entries(fields).forEach(([k, v]) => form.append(k, v))
form.append('file', { uri, name: key.split('/').pop(), type: contentType } as any)  // RN file, LAST
const res = await fetch(url, { method: 'POST', body: form })   // SEM header Content-Type (RN seta o boundary do multipart)
if (!res.ok) throw new Error(`Falha ao subir imagem (${res.status})`)
return key
```

**Footgun evitado:** não setar `Content-Type` no `fetch` do POST — o RN precisa gerar o
`multipart/form-data; boundary=...`. O `key` devolvido é o que gerei (== `fields.key`).

## Data flow

Idêntico exceto o upload: presign `{url,fields,key}` → FormData(fields+file) → POST direto no
MinIO/S3 → 204 → devolve `key` → create do domínio recebe `key` (inalterado). Leitura `presignGet` igual.

## Tratamento de erro

- **Upload viola a policy** (tamanho > 15MB **ou** Content-Type ≠ assinado) → S3/MinIO **rejeita o
  POST (403/400)** → `res.ok=false` → `uploadImage` lança `Falha ao subir imagem (<status>)`. O
  create do domínio **nunca é chamado** com key inválida. Melhor que hoje (PUT aceitava qualquer tamanho).
- **Reports N fotos** (`Promise.all`) — 1 falha → create inteiro falha (comportamento atual). Órfãos
  parciais = condição já documentada da Fatia 2 (TTL/lifecycle limpa).
- Sem HeadObject redundante no create — a policy é a fonte da imposição (YAGNI). Nenhuma falha nova engolida.

## Testes / gate

- **Backend unit** (`media.service.spec.ts`): mock `createPresignedPost`; assert `{url,fields,key}`, o
  `key` (prefixo+ext), e as `Conditions` (`content-length-range [0, 15728640]` + `eq $Content-Type`).
- **Backend e2e:** `POST /media/presign` (JWT) → 201 com `url`+`fields`+`key`; `fields` contém
  `Content-Type` + `key` + `Policy`.
- **Mobile** (`uploadMedia.test.ts`): presign mock com `fields`; `uploadImage` monta FormData
  (fields + file **last**), faz **POST** (não PUT), devolve key; erro em `!res.ok`. Atualiza os 3 casos.
- **Docker smoke REAL (rebuild):** presign → **POST arquivo pequeno → 204** + GET 200; **POST >15MB →
  rejeitado** (policy); **POST content-type errado → rejeitado**; reports/journey/chat create com a key OK.
- **Gate:** backend build 0 / unit / e2e; mobile tsc (8 baseline) / jest / expo export web 0.

## Não-objetivos / diferidos (continuam pós-esta-fatia)

- **Cursor pagination real** (envelope `{items,nextCursor}` + infinite-scroll; quebrante).
- **Fan-out notif → fila** (escalabilidade, backend-only).
- Presigned POST pra outros tipos de mídia além de imagem (só jpeg/png hoje; YAGNI).

## Execução (subagent-driven)

Branch `feat/backend-media-presigned-post` de `main`@`1ace63a`. Tasks:

1. **Backend** — dep `@aws-sdk/s3-presigned-post` + `MediaService.presignPost` + controller + spec (TDD).
2. **Mobile** — `uploadImage` POST multipart + `uploadMedia.test.ts` (TDD).
3. **Verificação + docker smoke real** (POST 204 / oversize rejeitado / wrong-type rejeitado / create
   end-to-end) **+ PR** (controller = eu).

Cada task backend/mobile = implementer + **two-gate** (spec + code-quality). Commit local por task;
**push/PR só com luz verde explícita, sem rastros de IA**.
