# SWI Backend (container) — Hardening H1 (Auth security) — design

> Doc **temporário** (como os outros `docs/plans/*backend*`): deletar quando o backend
> inteiro estiver implementado. **1ª fatia da fase de hardening pré-produção** (pós
> roadmap de domínios completo — Fundação→…→Clima→Evacuação). Fase escolhida pelo
> usuário: "hardening pré-produção, segurança primeiro" (código puro contra o Docker
> local, sem depender de deploy AWS).
>
> **Distinto** do `2026-06-24-swi-backend-hardening-admin-design.md` (macro Amplify-era
> de integração admin B/A/C, obsoleto pós-pivô container). Aqui = segurança do auth Nest.

## Contexto

Com os 8 domínios não-saúde entregues, a próxima frente sem deploy AWS é **endurecer o
backend pra produção**. H1 = os achados de **segurança do `AuthService`** (do code-review
de segurança da 1ª fatia de auth). **Fatia pure-backend**: só `swi-backend/src/auth/`,
**zero mobile**. Branch **`feat/backend-auth-hardening`** de `main` (independente da
Evacuação — auth já está em `main`).

### Estado real do módulo (auditado — memória estava desatualizada)

Já em `main` (NÃO refazer): **`JWT_SECRET` hard-fail** (`requireJwtSecret()`, sem fallback,
em `auth.module` + `jwt.strategy`); **rate-limit no login** (`@Throttle` 10/min em
`/auth/login` + global 100/min no `app.module`); testes parciais (login 2-portas,
código errado no confirm, forgot silencioso).

Gaps reais que H1 fecha: códigos previsíveis, bcrypt cost, timing-oracle no login,
rate-limit dos endpoints de código, órfão no signup, cobertura de testes.

## Decisões

1. **Códigos via CSPRNG (`codes.ts`).** `generateCode()` troca `Math.random()` por
   **`crypto.randomInt(0, 1_000_000)`** → `String(n).padStart(6, '0')`. Uniforme
   000000–999999, sync, `node:crypto` (sem dep nova). Fecha takeover por código de
   confirm/reset adivinhável (o `Math.random` é previsível, não é CSPRNG).
2. **bcrypt cost 10 → 12 (`codes.ts`).** `const BCRYPT_COST = 12` extraído;
   `hash = v => bcrypt.hash(v, BCRYPT_COST)`. Hashes cost-10 antigos **continuam
   verificando** (cost embutido no hash). Fixtures do e2e chumbam `bcrypt.hash(...,10)`
   → intocados. Sem rehash-on-login (YAGNI pro piloto).
3. **Timing-oracle no login (`auth.service.ts`).** Hoje e-mail inexistente retorna
   **antes** do bcrypt; existe+senha-errada roda o compare (~lento) → o delta de tempo
   vaza quais e-mails existem. Fix = **sempre 1 bcrypt compare**:
   ```ts
   const u = await this.users.findByEmail(p.email)
   const ok = await verifyHash(p.password, u?.passwordHash ?? DUMMY_HASH)
   if (!u || !ok) throw new UnauthorizedException('Credenciais inválidas')
   ```
   `DUMMY_HASH` = bcrypt cost-12 de string aleatória fixa, constante em `codes.ts`.
   Pareado com o `@Throttle` 10/min já existente.
4. **Rate-limit nos endpoints de código (`auth.controller.ts`).** Adicionar `@Throttle`
   em **`confirm`, `password/forgot`, `password/reset`**: `{ limit: 5, ttl: 60000 }`
   (5/min/IP). Brute-force de 6 dígitos a 5/min = inviável; e-mail-bombing no forgot
   barrado. `/login` fica 10/min. e2e mal toca esses endpoints (confirm 1×, forgot/reset
   0× no run serial) → sem quebra; confirmado no gate.
5. **Rollback do órfão no signup (`auth.service.ts`).** Hoje o `create` do User commita
   **antes** do `sendConfirmationCode`; se o e-mail falhar, a linha fica órfã (não
   re-cadastra → Conflict; não confirma → sem código). Fix:
   ```ts
   const user = await this.prisma.user.create({ ... })
   try { await this.mail.sendConfirmationCode(p.email, code) }
   catch (err) { await this.prisma.user.delete({ where: { id: user.id } }); throw err }
   ```
   Sem órfão; usuário refaz o signup. **Resend-code endpoint + botão mobile = DEFERIDO**
   (decisão do usuário) pra fatia do QA build端-a-端 (precisa tocar o mobile).
6. **Cobertura de testes (`auth.service.spec.ts`).** Novos: confirm **código expirado**
   → BadRequest · reset **expirado** + **código errado** → throw · login com e-mail
   inexistente **ainda chama `verifyHash`** (prova do timing-fix) · signup: `mail.send`
   throws → `prisma.user.delete` chamado + rethrow · `generateCode` = 6 dígitos.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `swi-backend/src/auth/codes.ts` | `crypto.randomInt` no `generateCode`; `BCRYPT_COST=12`; export `DUMMY_HASH`. |
| `swi-backend/src/auth/auth.service.ts` | login sempre-1-compare (timing); signup try/catch + rollback. |
| `swi-backend/src/auth/auth.controller.ts` | `@Throttle 5/min` em confirm/forgot/reset. |
| `swi-backend/src/auth/auth.service.spec.ts` | +5 casos (expiração, wrong-code reset, timing, rollback). |
| `swi-backend/src/auth/codes.spec.ts` (novo, opcional) | `generateCode` 6 dígitos + range. |

## Tratamento de erro
Tipos de exceção inalterados (`Unauthorized`/`BadRequest`/`Forbidden`/`Conflict`). O
rollback re-lança o **erro original** do mail (500). O `DUMMY_HASH` garante que o caminho
sem-usuário e o caminho senha-errada custem ~o mesmo (1 bcrypt compare cada).

## Testes / gate
- **Unit:** os 5 casos novos + os existentes verdes.
- **e2e:** `auth.e2e` (signup→confirm→login403→approve→login200→/me) **mantido verde**;
  os 33 e2e no total mantidos (rate-limits novos não estouram no run serial).
- **Gate:** backend build 0 / unit verde / e2e **33**. **Sem mobile** → gate mobile
  inalterado (tsc 8 / jest 172 / expo não precisam rodar, mas confirmo que nada mobile
  mudou). **Docker smoke (rebuild):** signup→confirm→login íntegro; código 6 dígitos;
  (opcional) timing ~igual entre e-mail inexistente e senha errada.

## Não-objetivos / deferidos
- **Resend-code endpoint + botão mobile** (órfão UX-friendly) → fatia QA build端-a-端.
- REJECTED-vs-PENDING message (cosmético; precisa o mobile tratar novo `reason`).
- Account-lockout com estado, rehash-on-login, 2FA — overkill pro piloto.
- Correctness (Chat TOCTOU, Jornada `$transaction`/idempotência) = **fatia H2**;
  Notif fila / Reports / Perfil = **H3**.

## Execução (subagent-driven)
1. **`codes.ts`** — crypto RNG + `BCRYPT_COST` + `DUMMY_HASH` (+spec opcional). TDD.
2. **`auth.service.ts`** — timing-fix no login + rollback no signup (+casos no spec). TDD.
3. **`auth.controller.ts`** — `@Throttle` em confirm/forgot/reset.
4. **Verificação + docker smoke + PR** (controller = eu).

Cada unidade **two-gate** (spec + code-quality). Commit local por task; **push/PR só com
luz verde explícita, sem rastros de IA**.
