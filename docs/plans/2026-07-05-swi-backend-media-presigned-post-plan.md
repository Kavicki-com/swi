# Media presigned-POST + content-length-range Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) to implement this plan task-by-task.
>
> Doc **temporário** (`docs/plans/*backend*`). Design irmão: `2026-07-05-swi-backend-media-presigned-post-design.md`.

**Goal:** Impor um limite real de tamanho (15 MB) + Content-Type nos uploads de imagem, trocando o presigned **PUT** (sem constraint) por presigned **POST** com policy `content-length-range` — coordenado backend + mobile.

**Architecture:** Backend `MediaService.presignPut` → `presignPost` via `@aws-sdk/s3-presigned-post` (Conditions `content-length-range [0,15MB]` + `Content-Type`), controller devolve `{url,fields,key}`. Mobile `uploadImage` monta FormData (fields + file **last**) e faz **POST** multipart. Endpoints de create (reports/journey/chat) inalterados (recebem keys). Mock path intocado. Branch `feat/backend-media-presigned-post` de `main`@`1ace63a`.

**Tech Stack:** NestJS 10 + `@aws-sdk/client-s3`/`s3-presigned-post` + MinIO (S3), React Native/Expo (FormData + fetch), Jest.

---

## Convenções de comando

- **Backend** (de `swi-backend/`): `npm run build` (exit 0); unit 1 arquivo `npx jest media.service`; suíte `npm test`; e2e `DATABASE_URL='postgresql://swi:swi@localhost:5432/swi' npm run test:e2e` (precisa Docker db up + migrate).
- **Mobile** (de `mobile/`): `npx jest uploadMedia`; typecheck `npx tsc --noEmit` (baseline: 8 erros pré-existentes não-relacionados); `npx expo export --platform web` (exit 0).
- **Docker** (de `swi-backend/`): `docker compose up --build -d api` (REBUILDA; sobe db/minio/mailhog). Se `docker info` DOWN, subir Docker Desktop e pollar.
- **NUNCA rastros de IA** nos commits. Commit local por task. **git de fora de `swi-backend/`**: usar `git -C <repo-root>` OU rodar da raiz (o CWD do shell pode estar em `swi-backend/`).

---

## Task 1: Backend — `presignPost` + dep + controller

**Files:**
- Modify: `swi-backend/package.json` (dep nova via `npm install`)
- Modify: `swi-backend/src/media/media.service.ts`
- Modify: `swi-backend/src/media/media.controller.ts:13`
- Modify/Test: `swi-backend/src/media/media.service.spec.ts`
- Check: qualquer `test/*.e2e-spec.ts` que use `/media/presign` (shape mudou)

**Step 1: instalar a dep** — de `swi-backend/`:
`npm install @aws-sdk/s3-presigned-post` (alinhar ao major 3.x dos outros `@aws-sdk/*`; se resolver uma minor diferente, tudo bem — mesmo major). Confirmar que entrou em `dependencies` (não devDep).

**Step 2: escrever/adaptar o teste (TDD)** — `swi-backend/src/media/media.service.spec.ts`. Leia o spec atual (testa `presignPut` mockando `getSignedUrl`). Reescreva pro `presignPost`, mockando `createPresignedPost`:
```ts
jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn().mockResolvedValue({ url: 'http://minio/bucket', fields: { key: 'x', Policy: 'p', 'Content-Type': 'image/jpeg' } }),
}))
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
// ...
it('presignPost: key com prefixo+ext, policy com content-length-range 15MB + content-type', async () => {
  const svc = new MediaService()
  const out = await svc.presignPost('image/png', 'task')
  expect(out.key).toMatch(/^task\/[0-9a-f-]{36}\.png$/)
  expect(out.url).toBeDefined(); expect(out.fields).toBeDefined()
  const arg = (createPresignedPost as jest.Mock).mock.calls[0][1]
  expect(arg.Conditions).toContainEqual(['content-length-range', 0, 15 * 1024 * 1024])
  expect(arg.Conditions).toContainEqual(['eq', '$Content-Type', 'image/png'])
  expect(arg.Fields).toEqual({ 'Content-Type': 'image/png' })
})
```
Manter/adaptar os testes de `presignGet`/`presignGetMany` (inalterados). Rode `npx jest media.service` → **FAIL** (presignPost não existe).

**Step 3: implementar** — `swi-backend/src/media/media.service.ts`:
- Import: `import { createPresignedPost } from '@aws-sdk/s3-presigned-post'`.
- Constante: `const MAX_UPLOAD_BYTES = 15 * 1024 * 1024` (perto do `PUT_TTL`).
- Trocar `presignPut` por:
```ts
async presignPost(contentType: string, prefix = 'reports'): Promise<{ url: string; fields: Record<string, string>; key: string }> {
  const key = `${prefix}/${randomUUID()}.${this.ext(contentType)}`
  const { url, fields } = await createPresignedPost(this.s3, {
    Bucket: this.bucket,
    Key: key,
    Expires: 300,
    Conditions: [
      ['content-length-range', 0, MAX_UPLOAD_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
  })
  return { url, fields, key }
}
```
`presignGet`/`presignGetMany` **inalterados**. Rode `npx jest media.service` → **PASS**.

**Step 4: controller** — `swi-backend/src/media/media.controller.ts:13`: trocar `presignPut` por `presignPost`:
```ts
return this.media.presignPost(dto.contentType, dto.prefix ?? 'reports')
```

**Step 5: e2e shape** — grep `test/` por `/media/presign`. Se algum e2e assertar `{url,key}` do presign, atualizar pra esperar `fields` também. Se nenhum e2e cobre o presign diretamente, adicionar um caso mínimo (em `test/reports.e2e-spec.ts` ou um `media.e2e`): `POST /media/presign {contentType:'image/jpeg'}` autenticado → **201** com `body.url`, `body.fields`, `body.key` definidos. (Nota: `createPresignedPost` é assinatura local, não faz rede → roda no e2e sem MinIO.)

**Step 6: build + unit + e2e**
- `npm run build` → exit 0.
- `npm test` → verde (media.service adaptado passa).
- Docker db up + migrate → `DATABASE_URL=... npm run test:e2e` → verde (8 suites, +eventual caso de presign).

**Step 7: commit**
```bash
git add swi-backend/
git commit -m "feat(backend): presigned POST com content-length-range 15MB (limite real de upload)"
```

---

## Task 2: Mobile — `uploadImage` POST multipart

**Files:**
- Modify: `mobile/services/api/uploadMedia.ts`
- Modify: `mobile/services/api/uploadMedia.test.ts`

**Step 1: reescrever o teste (TDD)** — `mobile/services/api/uploadMedia.test.ts`. O fluxo novo faz **1** `fetch` (o POST), sem `fetch(uri).blob()`, e monta FormData. Mockar `FormData` (como já mocka `fetch`) pra capturar os `append`:
```ts
beforeEach(() => {
  (apiRequest as jest.Mock).mockReset();
  (global as any).fetch = jest.fn();
  (global as any).FormData = class {
    parts: [string, any][] = [];
    append(k: string, v: any) { this.parts.push([k, v]); }
  };
});

it('uploadImage: presign → POST multipart (fields + file last) → devolve key', async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://minio/bucket', fields: { key: 'reports/k.jpg', Policy: 'p', 'Content-Type': 'image/jpeg' }, key: 'reports/k.jpg' });
  (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 204 });
  const key = await uploadImage('file:///a/b.jpg');
  expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'reports' }, auth: true });
  const call = (global as any).fetch.mock.calls[0];
  expect(call[0]).toBe('https://minio/bucket');
  expect(call[1].method).toBe('POST');
  const form = call[1].body;
  // fields todos presentes, e 'file' por ÚLTIMO
  expect(form.parts.map((p: any) => p[0])).toEqual(['key', 'Policy', 'Content-Type', 'file']);
  expect(form.parts[form.parts.length - 1][0]).toBe('file');
  expect(form.parts[form.parts.length - 1][1]).toEqual({ uri: 'file:///a/b.jpg', name: 'k.jpg', type: 'image/jpeg' });
  // NÃO seta header Content-Type (RN gera o boundary)
  expect(call[1].headers?.['Content-Type']).toBeUndefined();
  expect(key).toBe('reports/k.jpg');
});

it('uploadImage repassa o prefixo', async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', fields: {}, key: 'task/k.jpg' });
  (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 204 });
  await uploadImage('file:///a/b.jpg', 'task');
  expect(apiRequest).toHaveBeenCalledWith('/media/presign', { method: 'POST', body: { contentType: 'image/jpeg', prefix: 'task' }, auth: true });
});

it('uploadImage propaga falha do POST (policy violation)', async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', fields: {}, key: 'k' });
  (global as any).fetch.mockResolvedValueOnce({ ok: false, status: 400 });
  await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/400/);
});
```
Manter o teste de `contentTypeFor` (inalterado). Rode `npx jest uploadMedia` → **FAIL**.

**Step 2: implementar** — `mobile/services/api/uploadMedia.ts` (manter `contentTypeFor`):
```ts
export async function uploadImage(uri: string, prefix = 'reports'): Promise<string> {
  const contentType = contentTypeFor(uri);
  const { url, fields, key } = await apiRequest<{ url: string; fields: Record<string, string>; key: string }>(
    '/media/presign', { method: 'POST', body: { contentType, prefix }, auth: true },
  );
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  // O arquivo TEM que ser o último campo (o S3 ignora campos após 'file').
  form.append('file', { uri, name: key.split('/').pop(), type: contentType } as any);
  // SEM header Content-Type: o RN gera o boundary do multipart/form-data.
  const res = await fetch(url, { method: 'POST', body: form as any });
  if (!res.ok) throw new Error(`Falha ao subir imagem (${res.status})`);
  return key;
}
```
Rode `npx jest uploadMedia` → **PASS**.

**Step 3: typecheck + export**
- `npx tsc --noEmit` → **8 erros baseline** (pré-existentes, não-relacionados); **0 novos**.
- `npx expo export --platform web` → exit 0.

**Step 4: commit**
```bash
git add mobile/services/api/
git commit -m "feat(mobile): upload via POST multipart (presigned POST) no lugar do PUT"
```

---

## Task 3: Verificação + docker smoke + PR (controller = eu)

**Step 1: gate** — backend build 0 / unit / e2e; mobile tsc (8 baseline, 0 novos) / `npx jest` / expo export web 0.

**Step 2: docker smoke REAL (rebuild)** — `docker compose up --build -d api`; então (com JWT do worker seedado `worker@swi.local`/`worker123`):
- `POST /media/presign {contentType:'image/jpeg', prefix:'reports'}` → **201** com `url`+`fields`+`key`.
- **POST multipart de arquivo pequeno** (curl `-F` com os fields + `-F file=@small.jpg` por último) → **204** (upload aceito). Depois `GET` presigned da key → 200.
- **POST de arquivo >15MB** (gerar um blob >15MB) → **rejeitado** (policy `content-length-range`; 400/403).
- **POST com Content-Type divergente** do assinado → **rejeitado**.
- create do domínio com a key (ex.: `POST /reports` com `imageKeys:[key]`) → 201; `GET` embute URL da imagem.
- **Confirmar diff zero-admin** (`git diff --stat main..HEAD -- swi-admin/` VAZIO).
- Scan de rastros de IA (`git log main..HEAD` sem `Co-Authored-By`/`Generated`).

**Step 3: review holística** + fixes de achados Critical/Important (amend/commit focado).

**Step 4: PR** — só com luz verde explícita do usuário (corpo em `<scratchpad>/pr-body-media-presigned-post.md`).

---

## Ordem de execução (subagent-driven)

| Task | Escopo | Isolamento |
| --- | --- | --- |
| 1 | Backend: dep + presignPost + controller + spec + e2e shape | Isolada (`swi-backend/src/media/`) |
| 2 | Mobile: uploadImage POST multipart + test | Isolada (`mobile/services/api/`) |
| 3 | Gate + docker smoke + PR | Controller (eu) |

Tasks 1 e 2 = implementer + **two-gate** (spec + code-quality). Continuar agents com `SendMessage` pra fixes (amend no commit da task). Commit local por task; **push/PR só com luz verde, sem rastros de IA**.

## Diferidos (continuam)

Cursor pagination real (quebrante); fan-out notif→fila (backend-only). Documentados no design das fatias anteriores.
