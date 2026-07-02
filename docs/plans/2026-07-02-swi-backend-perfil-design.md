# SWI Backend — Fatia 1: Perfil (design)

> Doc **temporário** (família `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. Fatia 1 da rodada não-saúde
> (`docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md`).

## Contexto

Primeira fatia da migração dos domínios não-saúde pro container NestJS. O
schema `Profile` já existe (fundacional, Fatia 0). O mobile já tem
`services/profile/` completo (seam mock/amplify + `ProfileProvider` + telas
`complimentary-data/step-1` e `step-2`). Esta fatia constrói o lado servidor
REST e liga o seam do mobile ao real (`DATA_BACKEND==='api'`).

Perfil é a fatia mais enxuta (11 campos opcionais, sem relações complexas, sem
mídia/real-time) — funda o padrão HTTP compartilhado que as 6 fatias seguintes
reusam e assenta a identidade `user.id` do JWT.

## Decisões

| Tema | Decisão |
| --- | --- |
| **Endpoints** | `GET /profile/me` + `PUT /profile/me` (JWT), escopados ao `req.user.userId` |
| **Semântica do save** | **upsert com patch** (merge dos campos enviados) — espelha o mock `save(patch) = {...store, ...patch}` |
| **"Sem perfil ainda"** | `GET` devolve **404** → cliente mapeia pra `null` (contrato do seam `get(): Profile\|null`) |
| **Campos de exibição** | `sector/jobTitle/avatarKey` (do schema fundacional) **ficam fora do DTO** — são do diretório/admin (Fatia 4), o worker edita só os 11 do formulário |
| **birthDate** | conversão **DD/MM/YYYY ↔ ISO (YYYY-MM-DD) na fronteira do `apiProfileBackend`** — telas seguem em BR, mock intocado (resolve a pendência "Phase 6" da era Amplify) |
| **Helper HTTP** | extrair o `req()` de dentro do `apiAuthBackend` pra `services/api/http.ts` compartilhado (cliente-fundação das 7 fatias) |
| **user-info** | **movida pra Fatia 4 (Chat)** — sua fonte é o diretório de contatos, que nasce no chat; fazer agora exigiria endpoint de diretório antecipado |

## Backend (`feat/backend-perfil` a partir de `main`)

`src/profile/` espelhando `src/users/`:
- **`ProfileModule`** (importa PrismaModule).
- **`ProfileController`** (`@UseGuards(JwtAuthGuard)`):
  - `GET /profile/me` → `profileService.getByUserId(req.user.userId)`; se `null`, **`throw NotFoundException`** (404).
  - `PUT /profile/me` → `profileService.upsert(req.user.userId, dto)` → 200 com o profile.
- **`ProfileService`**: `getByUserId` (`prisma.profile.findUnique({where:{userId}})`); `upsert` (`prisma.profile.upsert` com `create: {userId, ...patch}` / `update: patch`).
- **`UpdateProfileDto`** (`class-validator`, estilo `auth/dto.ts`): os 11 campos, todos `@IsOptional()`; `birthDate` `@IsDateString()` (ISO — a conversão do BR acontece no cliente antes de enviar); `uf` `@IsString()` len 2. **NÃO** inclui sector/jobTitle/avatarKey.
- **Seed**: `prisma/seed.ts` cria um `Profile` pro `worker@swi.local` (conveniência de teste manual; upsert idempotente).

Model já existe (Fatia 0). Sem migration nova.

## Mobile

- **`services/api/http.ts`** (novo): `apiRequest(path, { method, body, auth })` — SecureStore token + `Bearer` + `fetch` + erro com `data.message`. Extraído verbatim do `req()` do `apiAuthBackend`; suporta `PUT` (o auth só usava GET/POST). `apiAuthBackend` passa a importá-lo (refactor puro — os testes existentes do auth provam equivalência).
- **`services/profile/apiProfileBackend.ts`** (novo, substitui `amplifyProfileBackend.ts` que é **deletado**):
  - `get()` → `GET /profile/me`; **404 → `null`** (try/catch no status, como o `getCurrentUser` faz); converte `birthDate` ISO→DD/MM/YYYY na saída.
  - `save(patch)` → converte `birthDate` DD/MM/YYYY→ISO na entrada, `PUT /profile/me`, converte de volta na resposta.
  - Helpers de data puros e testáveis (`brToIso`/`isoToBr`), tolerantes a `undefined`.
- **`getProfileBackend.ts`**: despina → `DATA_BACKEND === 'api' ? apiProfileBackend : mockProfileBackend`. **Primeiro selector a honrar a flag.**
- **`getProfileBackend.test.ts`**: o caso `'api'` passa a esperar `apiProfileBackend` (não mais o pin).
- **Telas + `ProfileProvider` intocados** — o seam absorve.

## Tratamento de erro

Backend: DTO inválido → 400; sem JWT → 401; `GET` sem perfil → 404 (semântico, cliente→null). Mobile: `apiProfileBackend.get()` trata 404 como `null`; `save()` propaga erro com `data.message` (as telas já capturam via `saveProfile`).

## Testes + verificação

- **Backend unit** (Prisma mockado): `ProfileService.getByUserId` (achou/null), `upsert` (cria quando não existe, faz merge quando existe).
- **Backend e2e** (supertest, Postgres real): login worker → `GET /profile/me` **404** → `PUT` com subset → `GET` devolve o subset → `PUT` com outro subset → `GET` devolve o **merge** (prova o patch). Sem JWT → 401.
- **Mobile jest**: `http.apiRequest` (fetch mockado: método, Bearer, erro); `apiProfileBackend` (404→null, roundtrip de birthDate BR↔ISO, PUT com patch); `getProfileBackend` (mock vs api). Testes do auth seguem verdes (provam o refactor do http).
- **Docker smoke**: `PUT`+`GET /profile/me` via curl com token do worker.
- **Tripé mobile**: tsc 8 baseline (0 novos), jest verde, expo export web exit 0.
- **Teste manual** (usuário, dev build `EXPO_PUBLIC_DATA_BACKEND=api`): abrir complimentary-data, preencher step-1/step-2, reabrir → dados persistidos no Postgres.

## Não-objetivos (YAGNI)

- Avatar/upload → Fatia 2 (MinIO). `avatarKey` fica sem escrita nesta fatia.
- `user-info` → Fatia 4 (Chat).
- health-data / step-3 → mock permanente (smartband).
- Deletar `amplify*Backend.ts` dos outros domínios / a dep `aws-amplify` → fim da rodada.
