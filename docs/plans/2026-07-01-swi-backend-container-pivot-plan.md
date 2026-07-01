# Pivô p/ backend conteinerizado — vertical de auth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Design: `docs/plans/2026-07-01-swi-backend-container-pivot-design.md`. Doc
> **temporário** (família `docs/plans/*backend*`): deletar quando o backend inteiro
> estiver implementado.

**Goal:** Repropositar `swi-backend/` como uma API **NestJS + PostgreSQL + Prisma** que
sobe local no Docker (`docker compose up`) e serve o **vertical de auth real** (signup/
login/JWT + confirmação de e-mail via MailHog + reset de senha + **gate de aprovação de
worker**), com o mobile batendo na API de verdade através do seam existente.

**Architecture:** REST + JWT. `docker-compose` sobe 3 serviços (Postgres, MailHog, a API
Nest). Auth = controllers finos → guards (JWT/Roles) → services (regra) → Prisma (Postgres)
/ MailService (MailHog). No mobile, o caminho não-mock do seam de auth vira um cliente REST
(`apiAuthBackend`) que guarda o JWT no `expo-secure-store`; **as telas não mudam** porque o
cliente relança as mesmas mensagens que o mock lança.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, MailHog, `@nestjs/jwt` + Passport-JWT,
bcrypt, class-validator, Jest + supertest (backend); Expo/React Native + `expo-secure-store`
+ Jest (mobile). Ambiente: Windows, Docker Desktop, Git Bash. **NÃO toca `swi-admin/`.**

**⚠️ Execução:** o hook fact-forcing intercepta o 1º Bash do turno + cada Edit/Write —
apresente os fatos e re-tente a MESMA op. Edits um de cada vez.

**Branch:** `feat/backend-container-auth` (já criada, `b56dd87`, com o design doc). Todo o
trabalho aqui.

**Baselines a anotar na Task 0** (alvo = **0 regressões** no mobile):
- `mobile`: `npx tsc --noEmit` (8 erros baseline), `npx jest` (108 baseline), `npx expo export --platform web` (exit 0).
- `swi-backend`: hoje é Amplify; passa a ser Nest (baseline novo).

---

### Task 0: Baseline + confirmar ferramentas

**Step 1:** confirmar branch e árvore:
```bash
git branch --show-current            # feat/backend-container-auth
git log --oneline -1                 # b56dd87 (design doc)
git status --short                   # vazio
```

**Step 2:** confirmar Docker e Node:
```bash
docker --version && docker compose version   # Docker Desktop de pé
node --version                                # >= 20
```
Se `docker` não responder, PARAR e pedir pro usuário abrir o Docker Desktop.

**Step 3:** baseline do mobile (anotar os números):
```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -5 ; npx jest 2>&1 | tail -5 ; cd ..
```
Anotar: X erros de tsc (esperado 8), Y testes jest (esperado 108). Estes são os alvos de
"0 regressões". **Sem commit.**

---

### Task 1: Repropositar `swi-backend/` como scaffold NestJS

Remove o projeto Amplify do build (o `amplify/` **fica como referência read-only**) e cria
o esqueleto Nest.

**Files:**
- Delete: `swi-backend/package.json`, `swi-backend/package-lock.json`, `swi-backend/node_modules/` (Amplify)
- Create: `swi-backend/package.json`, `swi-backend/tsconfig.json`, `swi-backend/tsconfig.build.json`, `swi-backend/nest-cli.json`, `swi-backend/.gitignore`, `swi-backend/README.md`

**Step 1:** limpar o projeto Amplify do build (mantém `amplify/` no disco):
```bash
cd swi-backend
rm -rf node_modules package-lock.json package.json
```

**Step 2: `swi-backend/package.json`**
```json
{
  "name": "swi-backend",
  "version": "1.0.0",
  "description": "SWI backend — NestJS + Prisma + Postgres (container)",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "ts-node prisma/seed.ts",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "prisma": { "seed": "ts-node prisma/seed.ts" },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.22.0",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "nodemailer": "^6.9.15",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/testing": "^10.4.0",
    "@types/bcrypt": "^5.0.2",
    "@types/jest": "^29.5.13",
    "@types/node": "^20.19.43",
    "@types/nodemailer": "^6.4.16",
    "@types/passport-jwt": "^4.0.1",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "testEnvironment": "node"
  }
}
```

**Step 3: `swi-backend/tsconfig.json`** (exclui `amplify/` — referência, não buildada)
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "esModuleInterop": true,
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", "dist", "amplify"]
}
```

**Step 4: `swi-backend/tsconfig.build.json`**
```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "dist", "amplify", "test", "**/*spec.ts"] }
```

**Step 5: `swi-backend/nest-cli.json`**
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

**Step 6: `swi-backend/.gitignore`**
```
node_modules
dist
.env
```

**Step 7: `swi-backend/README.md`**
```markdown
# swi-backend — API (NestJS + Prisma + Postgres)

Backend conteinerizado do SWI. Loop local: `docker compose up` (API :3000,
MailHog :8025, Postgres :5432). Design: `../docs/plans/2026-07-01-swi-backend-container-pivot-design.md`.

`amplify/` é **referência read-only** do backend Amplify anterior (não buildado,
excluído do tsconfig) — removido quando a migração dos domínios terminar.
```

**Step 8:** instalar:
```bash
cd swi-backend && npm install 2>&1 | tail -5
```
Expected: instala sem erro (sem lockfile → gera novo).

**Step 9: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add -A swi-backend
git commit -m "chore(backend): repropositar swi-backend p/ scaffold NestJS (amplify/ retido como referência)"
```

---

### Task 2: docker-compose + Dockerfile + .env

**Files:**
- Create: `swi-backend/docker-compose.yml`, `swi-backend/Dockerfile`, `swi-backend/.dockerignore`, `swi-backend/.env.example`, `swi-backend/.env`

**Step 1: `swi-backend/docker-compose.yml`**
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: swi
      POSTGRES_PASSWORD: swi
      POSTGRES_DB: swi
    ports: ["5432:5432"]
    volumes: ["swi_pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U swi"]
      interval: 5s
      timeout: 3s
      retries: 10

  mailhog:
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]   # 1025 SMTP · 8025 UI web

  api:
    build: .
    depends_on:
      db: { condition: service_healthy }
      mailhog: { condition: service_started }
    environment:
      DATABASE_URL: postgresql://swi:swi@db:5432/swi
      JWT_SECRET: dev-secret-change-in-prod
      SMTP_HOST: mailhog
      SMTP_PORT: 1025
      MAIL_FROM: no-reply@swi.local
      PORT: 3000
    ports: ["3000:3000"]
    command: sh -c "npx prisma migrate deploy && node dist/main"

volumes:
  swi_pgdata:
```

**Step 2: `swi-backend/Dockerfile`**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3000
CMD ["node", "dist/main"]
```

**Step 3: `swi-backend/.dockerignore`**
```
node_modules
dist
.env
amplify
```

**Step 4: `swi-backend/.env.example`** (e copiar p/ `.env` p/ dev fora do container)
```
DATABASE_URL="postgresql://swi:swi@localhost:5432/swi"
JWT_SECRET="dev-secret-change-in-prod"
SMTP_HOST="localhost"
SMTP_PORT="1025"
MAIL_FROM="no-reply@swi.local"
PORT="3000"
```
```bash
cd swi-backend && cp .env.example .env
```
> `.env` (com `localhost`) é p/ rodar Nest fora do container (dev/migrate/seed). Dentro do
> compose, o serviço `api` usa `db`/`mailhog` como host (env do compose).

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/docker-compose.yml swi-backend/Dockerfile swi-backend/.dockerignore swi-backend/.env.example
git commit -m "feat(backend): docker-compose (postgres+mailhog+api) + Dockerfile"
```
> `.env` NÃO é commitado (está no `.gitignore`).

---

### Task 3: Prisma — schema `User` + PrismaService + migração inicial

**Files:**
- Create: `swi-backend/prisma/schema.prisma`, `swi-backend/src/prisma/prisma.service.ts`, `swi-backend/src/prisma/prisma.module.ts`

**Step 1: `swi-backend/prisma/schema.prisma`**
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role           { WORKER  ADMIN }
enum ApprovalStatus { PENDING APPROVED REJECTED }

model User {
  id             String         @id @default(uuid())
  email          String         @unique
  passwordHash   String
  name           String
  role           Role           @default(WORKER)
  emailVerified  Boolean        @default(false)
  approvalStatus ApprovalStatus @default(PENDING)

  confirmationCodeHash String?
  confirmationExpires  DateTime?
  resetCodeHash        String?
  resetExpires         DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Step 2: `swi-backend/src/prisma/prisma.service.ts`**
```ts
import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect() }
}
```

**Step 3: `swi-backend/src/prisma/prisma.module.ts`**
```ts
import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**Step 4:** subir o Postgres e criar a migração (precisa do db de pé):
```bash
cd swi-backend
docker compose up -d db
npx prisma migrate dev --name init 2>&1 | tail -15
```
Expected: cria `prisma/migrations/<ts>_init/` e aplica; "Your database is now in sync".

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/prisma swi-backend/src/prisma
git commit -m "feat(backend): schema Prisma User + PrismaService + migração init"
```

---

### Task 4: App skeleton Nest + health-check

**Files:**
- Create: `swi-backend/src/main.ts`, `swi-backend/src/app.module.ts`, `swi-backend/src/health.controller.ts`

**Step 1: `swi-backend/src/main.ts`**
```ts
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(Number(process.env.PORT ?? 3000))
}
bootstrap()
```

**Step 2: `swi-backend/src/health.controller.ts`**
```ts
import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  check() { return { status: 'ok' } }
}
```

**Step 3: `swi-backend/src/app.module.ts`** (módulos de auth/mail/users entram nas tasks seguintes)
```ts
import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health.controller'

@Module({ imports: [PrismaModule], controllers: [HealthController] })
export class AppModule {}
```

**Step 4:** build (db já de pé da Task 3):
```bash
cd swi-backend && npm run build 2>&1 | tail -5
```
Expected: build exit 0. (Smoke do endpoint acontece no `docker compose up` da Task final.)

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/main.ts swi-backend/src/app.module.ts swi-backend/src/health.controller.ts
git commit -m "feat(backend): app skeleton Nest + health-check + ValidationPipe global"
```

---

### Task 5: MailModule + MailService (nodemailer → MailHog) — TDD

**Files:**
- Test: `swi-backend/src/mail/mail.service.spec.ts`
- Create: `swi-backend/src/mail/mail.service.ts`, `swi-backend/src/mail/mail.module.ts`

**Step 1: teste que falha — `mail.service.spec.ts`**
```ts
import { MailService } from './mail.service'

describe('MailService', () => {
  it('envia código de confirmação via transporte SMTP', async () => {
    const sendMail = jest.fn().mockResolvedValue({})
    const svc = new MailService({ sendMail } as any)
    await svc.sendConfirmationCode('joao@ex.com', '123456')
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'joao@ex.com', subject: expect.stringContaining('onfirm') }),
    )
    expect(sendMail.mock.calls[0][0].text).toContain('123456')
  })
})
```

**Step 2:** rodar e ver falhar: `cd swi-backend && npx jest mail.service` → FAIL (módulo não existe).

**Step 3: `swi-backend/src/mail/mail.service.ts`**
```ts
import { Injectable } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class MailService {
  private readonly from = process.env.MAIL_FROM ?? 'no-reply@swi.local'
  // transporter injetável p/ teste; default = SMTP do MailHog
  constructor(
    private readonly transporter: nodemailer.Transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    }),
  ) {}

  async sendConfirmationCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI — Confirm seu e-mail',
      text: `Seu código de confirmação é: ${code}`,
    })
  }

  async sendResetCode(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from, to, subject: 'SWI — Redefinição de senha',
      text: `Seu código de redefinição é: ${code}`,
    })
  }
}
```
> Nota: o `subject` de confirmação contém "Confirm" (o teste checa `onfirm`). Mantenha essa substring.

**Step 4: `swi-backend/src/mail/mail.module.ts`**
```ts
import { Module } from '@nestjs/common'
import { MailService } from './mail.service'

@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
```

**Step 5:** rodar e ver passar: `npx jest mail.service` → PASS.

**Step 6: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/mail
git commit -m "feat(backend): MailService (nodemailer -> MailHog) + teste"
```

---

### Task 6: UsersService — TDD

Acesso a usuário reutilizado por auth (regra) e admin (approve).

**Files:**
- Test: `swi-backend/src/users/users.service.spec.ts`
- Create: `swi-backend/src/users/users.service.ts`, `swi-backend/src/users/users.module.ts`

**Step 1: teste que falha — `users.service.spec.ts`**
```ts
import { NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn() } }) as any

describe('UsersService', () => {
  it('approve() vira approvalStatus p/ APPROVED', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED' })
    const svc = new UsersService(db)
    const r = await svc.approve('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'APPROVED' } })
    expect(r.approvalStatus).toBe('APPROVED')
  })

  it('approve() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db).approve('nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})
```

**Step 2:** `npx jest users.service` → FAIL.

**Step 3: `swi-backend/src/users/users.service.ts`**
```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { User } from '@prisma/client'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }) }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }

  async approve(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u) throw new NotFoundException('Usuário não encontrado')
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'APPROVED' } })
  }
}
```

**Step 4: `swi-backend/src/users/users.module.ts`**
```ts
import { Module } from '@nestjs/common'
import { UsersService } from './users.service'

@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

**Step 5:** `npx jest users.service` → PASS.

**Step 6: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/users
git commit -m "feat(backend): UsersService (findByEmail/findById/approve) + teste"
```

---

### Task 7: AuthService — signup — TDD

**Files:**
- Test: `swi-backend/src/auth/auth.service.spec.ts`
- Create: `swi-backend/src/auth/auth.service.ts`, `swi-backend/src/auth/codes.ts`

**Step 1: helper `swi-backend/src/auth/codes.ts`**
```ts
import * as bcrypt from 'bcrypt'

// código de 6 dígitos legível no MailHog
export function generateCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10)
  return s
}
export const hash = (v: string) => bcrypt.hash(v, 10)
export const verifyHash = (v: string, h: string) => bcrypt.compare(v, h)
```
> `Math.random` é ok aqui (código efêmero de dev, não chave). Em prod → `crypto.randomInt`.

**Step 2: teste que falha — `auth.service.spec.ts`** (só signup nesta task)
```ts
import { ConflictException } from '@nestjs/common'
import { AuthService } from './auth.service'

function deps() {
  const users = { findByEmail: jest.fn(), findById: jest.fn(), approve: jest.fn() }
  const prisma = { user: { create: jest.fn(), update: jest.fn() } }
  const mail = { sendConfirmationCode: jest.fn().mockResolvedValue(undefined), sendResetCode: jest.fn().mockResolvedValue(undefined) }
  const jwt = { sign: jest.fn().mockReturnValue('jwt-token') }
  const svc = new AuthService(prisma as any, users as any, mail as any, jwt as any)
  return { svc, users, prisma, mail, jwt }
}

describe('AuthService.signup', () => {
  it('cria worker pendente/não-verificado, gera código e manda e-mail', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u1' })
    const r = await svc.signup({ email: 'joao@ex.com', password: 'senha123', name: 'João' })
    expect(r).toEqual({ nextStep: 'CONFIRM' })
    const data = prisma.user.create.mock.calls[0][0].data
    expect(data.email).toBe('joao@ex.com')
    expect(data.role).toBe('WORKER')
    expect(data.emailVerified).toBe(false)
    expect(data.approvalStatus).toBe('PENDING')
    expect(data.passwordHash).not.toBe('senha123')          // hasheada
    expect(mail.sendConfirmationCode).toHaveBeenCalledWith('joao@ex.com', expect.any(String))
  })

  it('lança Conflict se o e-mail já existe', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'x' })
    await expect(svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' }))
      .rejects.toBeInstanceOf(ConflictException)
  })
})
```

**Step 3:** `npx jest auth.service` → FAIL.

**Step 4: `swi-backend/src/auth/auth.service.ts`** (só signup + shape das deps; métodos seguintes chegam nas Tasks 8-10)
```ts
import { ConflictException, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { MailService } from '../mail/mail.service'
import { generateCode, hash } from './codes'

const CODE_TTL_MIN = 30

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {}

  async signup(p: { email: string; password: string; name: string }): Promise<{ nextStep: 'CONFIRM' }> {
    if (await this.users.findByEmail(p.email)) throw new ConflictException('E-mail já cadastrado')
    const code = generateCode()
    await this.prisma.user.create({
      data: {
        email: p.email,
        name: p.name,
        passwordHash: await hash(p.password),
        role: 'WORKER',
        emailVerified: false,
        approvalStatus: 'PENDING',
        confirmationCodeHash: await hash(code),
        confirmationExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000),
      },
    })
    await this.mail.sendConfirmationCode(p.email, code)
    return { nextStep: 'CONFIRM' }
  }
}
```

**Step 5:** `npx jest auth.service` → PASS (2/2).

**Step 6: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/auth
git commit -m "feat(backend): AuthService.signup (worker pendente + código + e-mail) + teste"
```

---

### Task 8: AuthService — confirm — TDD

**Files:** Modify `swi-backend/src/auth/auth.service.ts`; Modify `swi-backend/src/auth/auth.service.spec.ts`

**Step 1: adicionar o teste** (append)
```ts
describe('AuthService.confirm', () => {
  it('valida o código, marca emailVerified e limpa o código', async () => {
    const { svc, users, prisma } = deps()
    const { hash } = await import('./codes')
    users.findByEmail.mockResolvedValue({
      id: 'u1', email: 'j@ex.com', emailVerified: false,
      confirmationCodeHash: await hash('123456'),
      confirmationExpires: new Date(Date.now() + 60_000),
    })
    prisma.user.update.mockResolvedValue({})
    await svc.confirm({ email: 'j@ex.com', code: '123456' })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
    })
  })

  it('rejeita código errado', async () => {
    const { svc, users } = deps()
    const { hash } = await import('./codes')
    users.findByEmail.mockResolvedValue({
      id: 'u1', confirmationCodeHash: await hash('111111'),
      confirmationExpires: new Date(Date.now() + 60_000),
    })
    await expect(svc.confirm({ email: 'j@ex.com', code: '999999' })).rejects.toThrow()
  })
})
```

**Step 2:** `npx jest auth.service` → FAIL (confirm não existe).

**Step 3: adicionar em `auth.service.ts`** (atualizar imports p/ `BadRequestException` e `verifyHash`)
```ts
async confirm(p: { email: string; code: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  if (!u || !u.confirmationCodeHash || !u.confirmationExpires) throw new BadRequestException('Código inválido')
  if (u.confirmationExpires < new Date()) throw new BadRequestException('Código expirado')
  if (!(await verifyHash(p.code, u.confirmationCodeHash))) throw new BadRequestException('Código inválido')
  await this.prisma.user.update({
    where: { id: u.id },
    data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
  })
}
```
Imports: `import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'` e `import { generateCode, hash, verifyHash } from './codes'`.

**Step 4:** `npx jest auth.service` → PASS.

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/auth
git commit -m "feat(backend): AuthService.confirm (valida código -> emailVerified) + teste"
```

---

### Task 9: AuthService — login (2 portas) + JWT — TDD

**Files:** Modify `auth.service.ts` + spec.

**Step 1: testes** (append)
```ts
describe('AuthService.login (2 portas)', () => {
  const { hash } = jest.requireActual('./codes')
  async function userWith(over: any) {
    return { id: 'u1', email: 'j@ex.com', name: 'J', role: 'WORKER',
      passwordHash: await hash('senha123'), emailVerified: true, approvalStatus: 'APPROVED', ...over }
  }
  it('barra e-mail não verificado (403 reason confirme)', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({ emailVerified: false }))
    await expect(svc.login({ email: 'j@ex.com', password: 'senha123' })).rejects.toMatchObject({ response: { reason: 'EMAIL_NOT_VERIFIED' } })
  })
  it('barra não aprovado (403 reason aprovação)', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({ approvalStatus: 'PENDING' }))
    await expect(svc.login({ email: 'j@ex.com', password: 'senha123' })).rejects.toMatchObject({ response: { reason: 'NOT_APPROVED' } })
  })
  it('senha errada = 401', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({}))
    await expect(svc.login({ email: 'j@ex.com', password: 'errada' })).rejects.toThrow()
  })
  it('as 2 portas ok -> emite JWT + user', async () => {
    const { svc, users, jwt } = deps(); users.findByEmail.mockResolvedValue(await userWith({}))
    const r = await svc.login({ email: 'j@ex.com', password: 'senha123' })
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', role: 'WORKER' })
    expect(r).toEqual({ accessToken: 'jwt-token', user: { id: 'u1', email: 'j@ex.com', name: 'J' } })
  })
})
```

**Step 2:** `npx jest auth.service` → FAIL.

**Step 3: adicionar em `auth.service.ts`** (imports `UnauthorizedException`, `ForbiddenException`; `verifyHash` já importado)
```ts
async login(p: { email: string; password: string }): Promise<{ accessToken: string; user: { id: string; email: string; name: string } }> {
  const u = await this.users.findByEmail(p.email)
  if (!u || !(await verifyHash(p.password, u.passwordHash))) throw new UnauthorizedException('Credenciais inválidas')
  if (!u.emailVerified) throw new ForbiddenException({ reason: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail antes de entrar' })
  if (u.approvalStatus !== 'APPROVED') throw new ForbiddenException({ reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' })
  return { accessToken: this.jwt.sign({ sub: u.id, role: u.role }), user: { id: u.id, email: u.email, name: u.name } }
}
```

**Step 4:** `npx jest auth.service` → PASS.

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/auth
git commit -m "feat(backend): AuthService.login (2 portas: verificado + aprovado) + JWT + teste"
```

---

### Task 10: AuthService — forgot/reset senha — TDD

**Files:** Modify `auth.service.ts` + spec.

**Step 1: testes** (append)
```ts
describe('AuthService reset de senha', () => {
  it('forgot é sempre silencioso (não vaza e-mail inexistente)', async () => {
    const { svc, users, mail } = deps(); users.findByEmail.mockResolvedValue(null)
    await expect(svc.forgotPassword({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(mail.sendResetCode).not.toHaveBeenCalled()
  })
  it('forgot com usuário real gera código + e-mail', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', email: 'j@ex.com' }); prisma.user.update.mockResolvedValue({})
    await svc.forgotPassword({ email: 'j@ex.com' })
    expect(mail.sendResetCode).toHaveBeenCalledWith('j@ex.com', expect.any(String))
  })
  it('reset valida código e troca a senha', async () => {
    const { svc, users, prisma } = deps(); const { hash } = jest.requireActual('./codes')
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('123456'), resetExpires: new Date(Date.now() + 60_000) })
    prisma.user.update.mockResolvedValue({})
    await svc.resetPassword({ email: 'j@ex.com', code: '123456', newPassword: 'nova123' })
    const data = prisma.user.update.mock.calls[0][0].data
    expect(data.passwordHash).toBeDefined()
    expect(data.resetCodeHash).toBeNull()
  })
})
```

**Step 2:** `npx jest auth.service` → FAIL.

**Step 3: adicionar em `auth.service.ts`**
```ts
async forgotPassword(p: { email: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  if (!u) return                                     // silencioso de propósito
  const code = generateCode()
  await this.prisma.user.update({
    where: { id: u.id },
    data: { resetCodeHash: await hash(code), resetExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
  })
  await this.mail.sendResetCode(p.email, code)
}

async resetPassword(p: { email: string; code: string; newPassword: string }): Promise<void> {
  const u = await this.users.findByEmail(p.email)
  if (!u || !u.resetCodeHash || !u.resetExpires) throw new BadRequestException('Código inválido')
  if (u.resetExpires < new Date()) throw new BadRequestException('Código expirado')
  if (!(await verifyHash(p.code, u.resetCodeHash))) throw new BadRequestException('Código inválido')
  await this.prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await hash(p.newPassword), resetCodeHash: null, resetExpires: null },
  })
}
```

**Step 4:** `npx jest auth.service` → PASS.

**Step 5: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src/auth
git commit -m "feat(backend): AuthService forgot/reset de senha + testes"
```

---

### Task 11: Guards JWT/Roles + controllers (auth + approve) + AppModule wiring

**Files:**
- Create: `swi-backend/src/auth/jwt.strategy.ts`, `swi-backend/src/auth/jwt-auth.guard.ts`, `swi-backend/src/auth/roles.guard.ts`, `swi-backend/src/auth/roles.decorator.ts`, `swi-backend/src/auth/dto.ts`, `swi-backend/src/auth/auth.controller.ts`, `swi-backend/src/auth/auth.module.ts`, `swi-backend/src/users/users.controller.ts`
- Modify: `swi-backend/src/app.module.ts`, `swi-backend/src/users/users.module.ts`

**Step 1: `dto.ts`**
```ts
import { IsEmail, IsString, MinLength } from 'class-validator'
export class SignupDto { @IsEmail() email!: string; @MinLength(6) password!: string; @IsString() name!: string }
export class ConfirmDto { @IsEmail() email!: string; @IsString() code!: string }
export class LoginDto { @IsEmail() email!: string; @IsString() password!: string }
export class ForgotDto { @IsEmail() email!: string }
export class ResetDto { @IsEmail() email!: string; @IsString() code!: string; @MinLength(6) newPassword!: string }
```

**Step 2: `jwt.strategy.ts`**
```ts
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
    })
  }
  validate(payload: { sub: string; role: string }) { return { userId: payload.sub, role: payload.role } }
}
```

**Step 3: `jwt-auth.guard.ts`, `roles.decorator.ts`, `roles.guard.ts`**
```ts
// jwt-auth.guard.ts
import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
@Injectable() export class JwtAuthGuard extends AuthGuard('jwt') {}
```
```ts
// roles.decorator.ts
import { SetMetadata } from '@nestjs/common'
export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
```
```ts
// roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', ctx.getHandler())
    if (!roles?.length) return true
    const { user } = ctx.switchToHttp().getRequest()
    return roles.includes(user?.role)
  }
}
```

**Step 4: `auth.controller.ts`**
```ts
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { SignupDto, ConfirmDto, LoginDto, ForgotDto, ResetDto } from './dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly users: UsersService) {}

  @Post('signup') signup(@Body() b: SignupDto) { return this.auth.signup(b) }
  @Post('confirm') @HttpCode(200) confirm(@Body() b: ConfirmDto) { return this.auth.confirm(b) }
  @Post('login') @HttpCode(200) login(@Body() b: LoginDto) { return this.auth.login(b) }
  @Post('password/forgot') @HttpCode(200) forgot(@Body() b: ForgotDto) { return this.auth.forgotPassword(b) }
  @Post('password/reset') @HttpCode(200) reset(@Body() b: ResetDto) { return this.auth.resetPassword(b) }

  @UseGuards(JwtAuthGuard) @Get('me')
  async me(@Req() req: any) {
    const u = await this.users.findById(req.user.userId)
    return u ? { id: u.id, email: u.email, name: u.name } : null
  }
}
```

**Step 5: `users.controller.ts`** (approve, só admin)
```ts
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string) { const u = await this.users.approve(id); return { id: u.id, approvalStatus: u.approvalStatus } }
}
```

**Step 6: `auth.module.ts`** + wire `users.module.ts` (add controller) + `app.module.ts`
```ts
// auth.module.ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './jwt.strategy'
import { UsersModule } from '../users/users.module'
import { MailModule } from '../mail/mail.module'

@Module({
  imports: [
    UsersModule, MailModule, PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod', signOptions: { expiresIn: '7d' } }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
```
- `users.module.ts`: adicionar `import { UsersController } from './users.controller'` + `controllers: [UsersController]`.
- `app.module.ts`: `imports: [PrismaModule, AuthModule, UsersModule]`.

**Step 7:** build + suíte: `cd swi-backend && npm run build 2>&1 | tail -8 && npx jest 2>&1 | tail -8` → exit 0 + verde.

**Step 8: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/src
git commit -m "feat(backend): guards JWT/Roles + controllers auth/approve + wiring dos módulos"
```

---

### Task 12: Prisma seed (admin + worker-demo aprovado)

**Files:** Create `swi-backend/prisma/seed.ts`

**Step 1: `swi-backend/prisma/seed.ts`**
```ts
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
const prisma = new PrismaClient()

async function main() {
  const hash = (p: string) => bcrypt.hash(p, 10)
  await prisma.user.upsert({
    where: { email: 'admin@swi.local' }, update: {},
    create: { email: 'admin@swi.local', name: 'Admin', passwordHash: await hash('admin123'),
      role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' },
  })
  await prisma.user.upsert({
    where: { email: 'worker@swi.local' }, update: {},
    create: { email: 'worker@swi.local', name: 'Worker Demo', passwordHash: await hash('worker123'),
      role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },   // demo entra direto
  })
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
```

**Step 2:** rodar (db de pé): `cd swi-backend && npx prisma db seed 2>&1 | tail -5` → cria admin + worker-demo.

**Step 3: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/prisma/seed.ts
git commit -m "feat(backend): seed (admin + worker-demo aprovado)"
```

---

### Task 13: e2e — fluxo inteiro (signup→confirm→login403→approve→login200→/me)

**Files:** Create `swi-backend/test/auth.e2e-spec.ts`, `swi-backend/test/jest-e2e.json`

**Step 1: `swi-backend/test/jest-e2e.json`**
```json
{ "moduleFileExtensions": ["js","json","ts"], "rootDir": ".", "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$", "transform": { "^.+\\.(t|j)s$": "ts-jest" } }
```

**Step 2: `swi-backend/test/auth.e2e-spec.ts`** — Postgres local (db do compose) + MailService espionado p/ capturar o código
```ts
import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { MailService } from '../src/mail/mail.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Auth e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const codes: Record<string, string> = {}

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService).useValue({
        sendConfirmationCode: (to: string, c: string) => { codes[to] = c; return Promise.resolve() },
        sendResetCode: () => Promise.resolve(),
      }).compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    prisma = app.get(PrismaService)
    await prisma.user.deleteMany({ where: { email: { in: ['e2e@ex.com','admin-e2e@ex.com'] } } })
    const bcrypt = await import('bcrypt')
    await prisma.user.create({ data: { email: 'admin-e2e@ex.com', name: 'A', passwordHash: await bcrypt.hash('admin123', 10),
        role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' } })
  })
  afterAll(async () => { await prisma.user.deleteMany({ where: { email: { in: ['e2e@ex.com','admin-e2e@ex.com'] } } }); await app.close() })

  it('fluxo completo até /me', async () => {
    const http = app.getHttpServer()
    await request(http).post('/auth/signup').send({ email: 'e2e@ex.com', password: 'senha123', name: 'E2E' }).expect(201)
    await request(http).post('/auth/confirm').send({ email: 'e2e@ex.com', code: codes['e2e@ex.com'] }).expect(200)
    await request(http).post('/auth/login').send({ email: 'e2e@ex.com', password: 'senha123' }).expect(403)  // não aprovado

    const admin = await request(http).post('/auth/login').send({ email: 'admin-e2e@ex.com', password: 'admin123' }).expect(200)
    const created = await prisma.user.findUnique({ where: { email: 'e2e@ex.com' } })
    await request(http).post(`/users/${created!.id}/approve`).set('Authorization', `Bearer ${admin.body.accessToken}`).expect(200)

    const login = await request(http).post('/auth/login').send({ email: 'e2e@ex.com', password: 'senha123' }).expect(200)
    expect(login.body.accessToken).toBeDefined()
    const me = await request(http).get('/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200)
    expect(me.body.email).toBe('e2e@ex.com')
  })
})
```

**Step 3:** rodar (db de pé + `.env` com localhost): `cd swi-backend && npx prisma migrate deploy && npm run test:e2e 2>&1 | tail -15` → PASS.

**Step 4: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add swi-backend/test
git commit -m "test(backend): e2e do fluxo de auth (signup->confirm->approve->login->/me)"
```

---

### Task 14: Mobile — `apiAuthBackend` (REST + token) substituindo `amplifyAuthBackend` — TDD

**Files:**
- Rename/Rewrite: `mobile/services/auth/amplifyAuthBackend.ts` → `mobile/services/auth/apiAuthBackend.ts`
- Create: `mobile/services/auth/apiConfig.ts`, `mobile/services/auth/apiAuthBackend.test.ts`
- Modify: `mobile/services/auth/getAuthBackend.ts` (import)
- Maybe: `npx expo install expo-secure-store` (se não instalado)

**Step 1:** conferir `expo-secure-store`:
```bash
cd mobile && node -e "require.resolve('expo-secure-store') && console.log('ok')" 2>/dev/null || npx expo install expo-secure-store
```

**Step 2: `mobile/services/auth/apiConfig.ts`**
```ts
// URL base da API. Emulador Android usa 10.0.2.2; device físico usa o IP da LAN.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
```

**Step 3: teste que falha — `apiAuthBackend.test.ts`**
```ts
import { apiAuthBackend } from './apiAuthBackend'

jest.mock('expo-secure-store', () => {
  let v: string | null = null
  return { setItemAsync: jest.fn(async (_k, x) => { v = x }), getItemAsync: jest.fn(async () => v), deleteItemAsync: jest.fn(async () => { v = null }) }
})

const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body })
const errJson = (status: number, body: any) => ({ ok: false, status, json: async () => body })

describe('apiAuthBackend', () => {
  beforeEach(() => { (global as any).fetch = jest.fn() })

  it('signIn guarda o token e devolve o user', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    const u = await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    expect(u).toEqual({ id: 'u1', email: 'j@ex.com', name: 'J' })
    const store = require('expo-secure-store')
    expect(store.setItemAsync).toHaveBeenCalledWith(expect.any(String), 't1')
  })

  it('signIn relança a mensagem de "aguardando aprovação" no 403 NOT_APPROVED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(403, { reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' }))
    await expect(apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' }))
      .rejects.toThrow(/aguardando aprovação/)
  })

  it('getCurrentUser sem token = null', async () => {
    const store = require('expo-secure-store'); await store.deleteItemAsync('x')
    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
  })
})
```

**Step 4:** `cd mobile && npx jest apiAuthBackend` → FAIL.

**Step 5: `mobile/services/auth/apiAuthBackend.ts`** (implementa `AuthBackend`)
```ts
import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { API_URL } from './apiConfig'

const TOKEN_KEY = 'swi.auth.token'

async function req(path: string, body?: unknown, auth = false): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) { const t = await SecureStore.getItemAsync(TOKEN_KEY); if (t) headers.Authorization = `Bearer ${t}` }
  const res = await fetch(`${API_URL}${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? 'Erro de rede')   // message já vem pronta do backend (2 portas incluídas)
  return data
}

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await req('/auth/login', { email, password })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
    return user
  },
  async signUp({ email, password, name }) { return req('/auth/signup', { email, password, name }) },
  async confirmSignUp({ email, code }) { await req('/auth/confirm', { email, code }) },
  async signOut() { await SecureStore.deleteItemAsync(TOKEN_KEY) },
  async resetPassword({ email }) { await req('/auth/password/forgot', { email }) },
  async confirmReset({ email, code, newPassword }) { await req('/auth/password/reset', { email, code, newPassword }) },
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try { return await req('/auth/me', undefined, true) } catch { return null }
  },
}
```
> A mensagem das 2 portas chega pronta no `data.message` (backend). Relançar o `message`
> já casa com a cópia esperada nas telas.

**Step 6:** deletar o arquivo antigo e repointar o selector:
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git rm mobile/services/auth/amplifyAuthBackend.ts
```
- Em `mobile/services/auth/getAuthBackend.ts`: trocar o import `./amplifyAuthBackend` (símbolo `amplifyAuthBackend`) por `./apiAuthBackend` (símbolo `apiAuthBackend`) e ajustar o nome no ramo não-mock. **Valor da flag `DATA_BACKEND` intacto** (`'amplify'` continua selecionando o ramo real). Conferir/atualizar `getAuthBackend.test.ts` se ele referencia o símbolo antigo.

**Step 7:** `cd mobile && npx jest apiAuthBackend getAuthBackend 2>&1 | tail -8` → PASS.

**Step 8: commit**
```bash
cd /c/Users/Gabriel/Documents/SWI-mobile && git add mobile/services/auth
git commit -m "feat(mobile): apiAuthBackend REST + token (expo-secure-store) substitui amplifyAuthBackend"
```

---

### Task 15: Verificação final (tripé + smoke do Docker)

**Step 1: backend verde**
```bash
cd swi-backend && npm run build 2>&1 | tail -5 && npx jest 2>&1 | tail -8
```
Expected: build exit 0; todos os `.spec` verdes.

**Step 2: smoke do loop no Docker** (o teste-título do usuário: rodando de verdade)
```bash
cd swi-backend && docker compose up --build -d 2>&1 | tail -10
curl -s localhost:3000/health                                  # {"status":"ok"}
curl -s -X POST localhost:3000/auth/signup -H "Content-Type: application/json" -d '{"email":"smoke@ex.com","password":"senha123","name":"Smoke"}'
# abrir http://localhost:8025 (MailHog) e CONFERIR que o e-mail com o código chegou
docker compose logs api 2>&1 | tail -20
```
Expected: `/health` ok, signup 201, **e-mail visível no MailHog**. Derrubar depois: `docker compose down`.

**Step 3: mobile sem regressão**
```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -5      # 0 erros novos vs baseline (8)
npx jest 2>&1 | tail -8                            # baseline (108) + novos, verde
npx expo export --platform web 2>&1 | tail -5      # exit 0
```

**Step 4:** se tudo verde, **sem commit** (verificação). Se algum ajuste for preciso, corrigir + commit pontual. **NÃO** mergear — merge é passo separado com OK do usuário (pós-review).

---

## Definition of Done

- [ ] `docker compose up` sobe db+mailhog+api; `/health` ok; migração aplicada.
- [ ] Fluxo real: signup → e-mail no MailHog → confirm → login barrado (não aprovado) → admin aprova → login emite JWT → `/me` ok.
- [ ] Backend: `npm run build` exit 0, todos os `.spec` + e2e verdes.
- [ ] Mobile: `apiAuthBackend` substitui `amplifyAuthBackend`, token no `expo-secure-store`, telas **intocadas**; tsc 0 novos, jest verde, expo export web exit 0.
- [ ] `swi-backend/amplify/` retido como referência (não buildado); `swi-admin/` **não tocado**.
- [ ] Commits na `feat/backend-container-auth`.

## Pós-plano (fora desta rodada)

Migrar os 10 domínios restantes + 2 passthroughs em fatias; WebSocket (chat/notif.);
MinIO→S3 (mídia); rename `'amplify'`→`'api'` no seam; UI de aprovação no swi-admin
(Figma); deploy AWS (ECS/RDS/SES). Ver "Pendências de deploy" no design doc.
