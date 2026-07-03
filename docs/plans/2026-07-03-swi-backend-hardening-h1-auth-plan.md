# Hardening H1 (Auth security) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Design: `docs/plans/2026-07-03-swi-backend-hardening-h1-auth-design.md`.
> **Commits e PR SÓ com luz verde explícita** ([[Commit only when approved]]) e **SEM rastros de IA** ([[No AI traces]]). Cada unidade é **two-gate** (spec + code-quality) via subagent-driven. Fatia **pure-backend** (só `swi-backend/src/auth/`, zero mobile).

**Goal:** Fechar os achados de segurança do `AuthService` — códigos CSPRNG, bcrypt 12, timing-oracle no login, rate-limit dos endpoints de código, rollback do órfão no signup.

**Architecture:** Mudanças cirúrgicas em 3 arquivos de `swi-backend/src/auth/` (`codes.ts`, `auth.service.ts`, `auth.controller.ts`) + cobertura de testes. Sem model novo, sem migração, sem dep nova (`node:crypto` é builtin). Espelha os padrões/testes já existentes no módulo.

**Tech Stack:** NestJS 10, `bcrypt`, `node:crypto` (`randomInt`), `@nestjs/throttler` (já instalado), Jest + ts-jest, Supertest (e2e).

**Baseline a preservar:** backend `build` 0 · `test` verde · `test:e2e` **33/33**. Nada mobile muda.

**Comandos (de dentro de `swi-backend/`):**
- Unit 1 arquivo: `npx jest codes` · `npx jest auth.service` · full: `npm test`
- e2e: `npm run test:e2e` (precisa Postgres — `docker compose up -d db`, `DATABASE_URL=postgresql://swi:swi@localhost:5432/swi`)

**Branch:** `feat/backend-auth-hardening` de `main` (o controller cria no setup).

---

## Task 1: `codes.ts` — CSPRNG + bcrypt 12 + DUMMY_HASH (TDD)

**Files:**
- Create: `swi-backend/src/auth/codes.spec.ts`
- Modify: `swi-backend/src/auth/codes.ts`

**Estado atual** (`codes.ts`): `generateCode()` usa `Math.random()`; `hash = bcrypt.hash(v, 10)`.

**Step 1: Escrever o teste que falha** (`codes.spec.ts`):
```ts
import * as bcrypt from 'bcrypt'
import { generateCode, hash, BCRYPT_COST, DUMMY_HASH } from './codes'

describe('generateCode (CSPRNG)', () => {
  it('sempre 6 dígitos', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  })
})

describe('bcrypt cost', () => {
  it('BCRYPT_COST=12 e hash() usa esse cost', async () => {
    expect(BCRYPT_COST).toBe(12)
    expect((await hash('x')).startsWith('$2b$12$')).toBe(true)
  })
})

describe('DUMMY_HASH (guard de timing do login)', () => {
  it('é um bcrypt cost-12 válido e não bate com nada', () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$12\$/)
    expect(bcrypt.compareSync('qualquer-senha', DUMMY_HASH)).toBe(false)
  })
})
```

**Step 2: Rodar → falha** — `cd swi-backend && npx jest codes` → FAIL (`BCRYPT_COST`/`DUMMY_HASH` não exportados).

**Step 3: Implementar** (`codes.ts` completo):
```ts
import * as bcrypt from 'bcrypt'
import { randomInt } from 'node:crypto'

export const BCRYPT_COST = 12

// código de 6 dígitos legível no MailHog — CSPRNG (crypto.randomInt), NÃO Math.random previsível.
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export const hash = (v: string) => bcrypt.hash(v, BCRYPT_COST)
export const verifyHash = (v: string, h: string) => bcrypt.compare(v, h)

// Hash bcrypt fixo (cost 12), computado 1× no load. O login compara a senha contra
// ele quando o e-mail NÃO existe, pra esse caminho custar ~o mesmo que "senha errada"
// (fecha o timing-oracle de enumeração). O valor em si nunca precisa bater.
export const DUMMY_HASH = bcrypt.hashSync('swi-timing-guard', BCRYPT_COST)
```

**Step 4: Rodar → passa** — `npx jest codes` → PASS. Também `npx jest auth.service` (os specs existentes usam `hash` real, agora cost 12 — só mais lentos, verdes).

**Step 5: Commit** (com luz verde)
```bash
git add swi-backend/src/auth/codes.ts swi-backend/src/auth/codes.spec.ts
git commit -m "feat(backend): endurece codes do auth — crypto.randomInt + bcrypt 12 + DUMMY_HASH"
```

---

## Task 2: `auth.service.ts` — timing-fix no login + rollback do signup (TDD)

**Files:**
- Modify: `swi-backend/src/auth/auth.service.ts`
- Modify: `swi-backend/src/auth/auth.service.spec.ts`

**Step 1: Escrever os testes que falham** — adicionar ao `auth.service.spec.ts`. Primeiro, o mock `deps()` precisa de `prisma.user.delete` e dos imports de `bcrypt`/exceções. No topo do arquivo:
```ts
import * as bcrypt from 'bcrypt'
import { UnauthorizedException, BadRequestException } from '@nestjs/common'
```
No `deps()`, trocar a linha do prisma por:
```ts
  const prisma = { user: { create: jest.fn(), update: jest.fn(), delete: jest.fn() } }
```

Novos describes (adicionar ao final do arquivo):
```ts
describe('AuthService.signup rollback', () => {
  it('e-mail falha → deleta o User recém-criado e re-lança', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    ;(mail.sendConfirmationCode as jest.Mock).mockRejectedValue(new Error('smtp down'))
    await expect(svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' })).rejects.toThrow('smtp down')
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u9' } })
  })
})

describe('AuthService.login timing-guard', () => {
  it('e-mail inexistente AINDA roda bcrypt.compare (anti-enumeração) e dá 401', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.login({ email: 'nao@existe.com', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedException)
    expect(spy).toHaveBeenCalled()   // comparou contra o DUMMY_HASH
    spy.mockRestore()
  })
})

describe('AuthService expiração', () => {
  const { hash } = jest.requireActual('./codes')
  it('confirm com código expirado → BadRequest', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', confirmationCodeHash: await hash('123456'), confirmationExpires: new Date(Date.now() - 1000) })
    await expect(svc.confirm({ email: 'j@ex.com', code: '123456' })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('reset com código expirado → BadRequest', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('123456'), resetExpires: new Date(Date.now() - 1000) })
    await expect(svc.resetPassword({ email: 'j@ex.com', code: '123456', newPassword: 'nova123' })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('reset com código errado → throw', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('111111'), resetExpires: new Date(Date.now() + 60_000) })
    await expect(svc.resetPassword({ email: 'j@ex.com', code: '999999', newPassword: 'nova123' })).rejects.toThrow()
  })
})
```

**Step 2: Rodar → falha** — `npx jest auth.service` → FAIL (login não chama bcrypt no caminho null; `delete` não é chamado).

**Step 3: Implementar** — em `auth.service.ts`:
- No import de `./codes`: `import { generateCode, hash, verifyHash, DUMMY_HASH } from './codes'`.
- Trocar as 2 primeiras linhas do `login`:
```ts
  async login(p: { email: string; password: string }) {
    const u = await this.users.findByEmail(p.email)
    const ok = await verifyHash(p.password, u?.passwordHash ?? DUMMY_HASH)
    if (!u || !ok) throw new UnauthorizedException('Credenciais inválidas')
    if (!u.emailVerified) throw new ForbiddenException({ reason: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail antes de entrar' })
    if (u.approvalStatus !== 'APPROVED') throw new ForbiddenException({ reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' })
    return { accessToken: this.jwt.sign({ sub: u.id, role: u.role }), user: { id: u.id, email: u.email, name: u.name } }
  }
```
- Trocar o final do `signup` (do `create` em diante):
```ts
    const user = await this.prisma.user.create({
      data: {
        email: p.email, name: p.name, passwordHash: await hash(p.password),
        role: 'WORKER', emailVerified: false, approvalStatus: 'PENDING',
        confirmationCodeHash: await hash(code),
        confirmationExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000),
      },
    })
    try {
      await this.mail.sendConfirmationCode(p.email, code)
    } catch (err) {
      await this.prisma.user.delete({ where: { id: user.id } })   // sem órfão
      throw err
    }
    return { nextStep: 'CONFIRM' }
```

**Step 4: Rodar → passa** — `npx jest auth.service` → PASS (novos + existentes).

**Step 5: Commit** (com luz verde)
```bash
git add swi-backend/src/auth/auth.service.ts swi-backend/src/auth/auth.service.spec.ts
git commit -m "feat(backend): fecha timing-oracle no login + rollback do orfao no signup"
```

---

## Task 3: `auth.controller.ts` — rate-limit dos endpoints de código

**Files:**
- Modify: `swi-backend/src/auth/auth.controller.ts`

`@Throttle` já está importado (usado no `/login`). Adicionar o decorator (limite 5/min) em `confirm`, `password/forgot`, `password/reset` (login fica 10/min; signup só no global):
```ts
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('confirm') @HttpCode(200) confirm(@Body() b: ConfirmDto) { return this.auth.confirm(b) }
  @Throttle({ default: { limit: 10, ttl: 60000 } }) @Post('login') @HttpCode(200) login(@Body() b: LoginDto) { return this.auth.login(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/forgot') @HttpCode(200) forgot(@Body() b: ForgotDto) { return this.auth.forgotPassword(b) }
  @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('password/reset') @HttpCode(200) reset(@Body() b: ResetDto) { return this.auth.resetPassword(b) }
```

**Verificar:** `cd swi-backend && npm run build` (exit 0), `npx tsc --noEmit -p tsconfig.json` (0). Sem teste unit (é decorator); o e2e do gate confirma que confirm/forgot/reset ainda respondem (≤5/min no run serial).

**Commit** (com luz verde)
```bash
git add swi-backend/src/auth/auth.controller.ts
git commit -m "feat(backend): rate-limit 5/min em confirm/forgot/reset (anti brute-force de codigo)"
```

---

## Task 4: Gate + docker smoke + PR (controller = eu)

**Step 1: Gate full-branch** — `cd swi-backend`: `npm run build` (0), `npm test` (verde, +`codes.spec` +casos novos), `npm run test:e2e` (**33/33** — Postgres up). Confirmar `git diff --stat main..HEAD` **não toca `mobile/`** (fatia pure-backend → não precisa rodar tsc/jest/expo do mobile).

**Step 2: Docker smoke REAL** (rebuild — o container roda código velho):
```bash
docker compose up --build -d api
# signup novo → conferir no MailHog (localhost:8025) que o código tem 6 dígitos (crypto)
# login worker seedado → 200; login e-mail inexistente → 401 (~mesmo tempo que senha errada)
# (opcional) POST /auth/password/forgot 6× rápido → 6ª = 429 (throttle)
```
Evidência: signup 201 + código 6-díg no MailHog; login 200; login inexistente 401; (opcional) 429 no 6º forgot.

**Step 3: Review holística** — subagent lê o diff da branch vs `main`: os 6 fixes corretos, exceções inalteradas, `DUMMY_HASH` cost-12 válido, sem regressão nos fluxos auth, sem toque no mobile.

**Step 4: PR** (SÓ com luz verde, SEM rastros de IA) — `git push -u origin feat/backend-auth-hardening`; corpo em `<scratchpad>/pr-body-h1-auth.md`; usuário abre/mergeia. `git log origin/main..HEAD | grep -iE 'claude|co-author|generated'` = VAZIO.

**Step 5: Memória** — anotar H1 em `project_swi_aws_backend.md` (1ª fatia de hardening; deferidos: resend-code endpoint + botão, REJECTED msg → H2/QA build).

---

## Pós-plano (próximas fatias de hardening)
- **H2** — Chat TOCTOU (upsert atômico), Jornada `$transaction` + idempotência de start/resume.
- **H3** — Notif fan-out→fila / consolidar sockets, Reports POST-policy/paginação, Perfil validação-de-data/`@CurrentUser()`.
- **QA build端-a-端** — resend-code endpoint + botão mobile (deferido daqui).
