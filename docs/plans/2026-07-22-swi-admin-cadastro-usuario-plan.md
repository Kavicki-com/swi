# Cadastro de usuário pelo painel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `POST /users` (ADMIN) que cria colaborador/admin com a senha definida pelo admin (APPROVED + emailVerified), e fiar o form `AdminsCreate` a ele.

**Architecture:** Backend novo (UsersController/Service.create + DTO) + frontend (client `employeesApi.create`/`adminsApi.create` + wiring do form com validação e refresh da lista). Só identidade persiste; saúde/exames/username ficam inertes.

**Tech Stack:** NestJS + Prisma + class-validator + jest (backend); React + Vitest + `@kavicki/swi-design-system` (admin).

**Ref design:** `docs/plans/2026-07-22-swi-admin-cadastro-usuario-design.md`

**Paths:** cwd das ferramentas é `mobile/`; backend em `../swi-backend`, admin em `../swi-admin`.

---

## Unidade A — Backend `POST /users`

### Task A1: `UsersService.create()`
**Files:** `swi-backend/src/users/users.service.ts`, `users.service.spec.ts` (append).

**Step 1 (RED):** testes no spec (reusam o `prisma()`/`media()` helpers já lá; adicionar mock de `user.create` e `findUnique`/`findByEmail`):
```ts
describe('UsersService.create', () => {
  it('cria User+Profile APPROVED/verificado com role e companyId do admin', async () => {
    const db = prisma()
    db.user.findUnique
      .mockResolvedValueOnce(null)                    // findByEmail: não existe
      .mockResolvedValueOnce({ id: 'adm', companyId: 'c1' }) // findById(admin)
    db.user.create = jest.fn().mockResolvedValue({ id: 'new', name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', companyRole: null, createdAt: new Date(0), profile: null })
    const svc = new UsersService(db, media())
    await svc.create('adm', { name: 'Zé', email: 'ze@x.com', password: 'senha123', role: 'WORKER', phone: '11' })
    const arg = db.user.create.mock.calls[0][0]
    expect(arg.data).toMatchObject({ name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', emailVerified: true, companyId: 'c1' })
    expect(arg.data.passwordHash).toBeTruthy()
    expect(arg.data.profile.create).toMatchObject({ fullName: 'Zé', phone: '11' })
  })
  it('email já cadastrado → ConflictException', async () => {
    const db = prisma(); db.user.findUnique.mockResolvedValueOnce({ id: 'x' })
    await expect(new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('admin sem empresa → companyId null', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: null })
    db.user.create = jest.fn().mockResolvedValue({ id: 'n', name: 'Z', email: 'z@x.com', role: 'WORKER', approvalStatus: 'APPROVED', companyRole: null, createdAt: new Date(0), profile: null })
    await new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })
    expect(db.user.create.mock.calls[0][0].data.companyId).toBeNull()
  })
})
```
**Step 2:** `cd ../swi-backend && npx jest src/users/users.service.spec.ts` → FAIL (create não existe).
**Step 3 (GREEN):** implementar `create(adminId, dto)`. **Achar o helper de hash** que `auth.service.ts` importa (topo do arquivo: `hash`/`verifyHash`) e reusar `hash(dto.password)`. Fluxo: `findByEmail` → ConflictException se existe; `findById(adminId)` pra `companyId`; `prisma.user.create({ data: { name, email, passwordHash: await hash(dto.password), role: dto.role, approvalStatus: 'APPROVED', emailVerified: true, companyId, profile: { create: { fullName: dto.name, phone, cpf, birthDate: dto.birthDate ? new Date(dto.birthDate) : null } } }, include: { profile: true } })`; retornar `this.toSummaryDto(user)`. Só incluir campos de profile presentes.
**Step 4:** jest → PASS.
**Step 5:** commit `feat(backend): UsersService.create (admin cria usuário APPROVED)`.

### Task A2: DTO + rota `POST /users`
**Files:** `swi-backend/src/users/dto.ts` (criar) ou inline; `users.controller.ts`.
**Step 1 (RED):** não há teste de controller unitário no módulo — a validação/rota é coberta pelo smoke ao vivo. Pular teste unitário do controller (consistente com o resto do módulo). Escrever direto:
**Step 3:** `CreateUserDto` com class-validator (`@IsString @IsNotEmpty name`, `@IsEmail email`, `@MinLength(8) password`, `@IsIn(['WORKER','ADMIN']) role`, `@IsOptional` em phone/cpf/birthDate). Controller: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post() create(@CurrentUserId() adminId: string, @Body() dto: CreateUserDto) { return this.users.create(adminId, dto) }`. Importar `CurrentUserId` do `../auth/current-user.decorator`.
**Step 4:** `npx tsc --noEmit` (backend) exit 0; `npx jest` suíte inteira verde.
**Step 5:** commit `feat(backend): POST /users (ADMIN) + CreateUserDto`.

---

## Unidade B — Admin (client + form)

### Task B1: `employeesApi.create` / `adminsApi.create`
**Files:** `swi-admin/src/services/api/users.ts`, `users.test.ts` (append).
**Step 1 (RED):**
```ts
describe('create (real)', () => {
  it('employeesApi.create → POST /users role WORKER + identidade', async () => {
    const f = okJson({ id: 'n', name: 'Zé' }); vi.stubGlobal('fetch', f)
    const { error } = await employeesApi.create({ name: 'Zé', email: 'ze@x.com', password: 'senha123', phone: '11' })
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users'); expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ role: 'WORKER', name: 'Zé', email: 'ze@x.com', password: 'senha123', phone: '11' })
  })
  it('adminsApi.create → role ADMIN', async () => {
    const f = okJson({ id: 'n' }); vi.stubGlobal('fetch', f)
    await adminsApi.create({ name: 'A', email: 'a@x.com', password: 'senha123' })
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).role).toBe('ADMIN')
  })
  it('erro (409) → { data:null, error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'E-mail já cadastrado' }) } as Response))
    const { data, error } = await employeesApi.create({ name: 'A', email: 'a@x.com', password: 'senha123' })
    expect(data).toBeNull(); expect(error?.message).toMatch(/cadastrad/i)
  })
})
```
**Step 3:** `type CreateUserInput = { name; email; password; phone?; cpf?; birthDate? }`; helper `createUser(role, input)` → `apiFetch('/users', { method:'POST', body: JSON.stringify({ role, ...input }) })` no envelope try/catch (`errorMessage(e,'Falha ao cadastrar')`); adicionar `create: (input) => createUser('WORKER', input)` em `employeesApi` e `create: (input) => createUser('ADMIN', input)` em `adminsApi`. Omitir chaves undefined do body (não mandar `phone: undefined` — usar spread condicional ou limpar).
**Step 4:** vitest users.test.ts → PASS.
**Step 5:** commit `feat(admin): employeesApi/adminsApi.create contra POST /users`.

### Task B2: wiring do form `AdminsCreate`
**Files:** `swi-admin/src/pages/admins/AdminsCreate.tsx`; `AdminsCreate.test.tsx` (criar).
**Step 1 (RED):** teste (usar `fireEvent` como o resto do projeto; `vi.spyOn` no `adminsApi.create`/`employeesApi.create`; `renderPage`):
```tsx
it('submit sem obrigatórios não chama a api', ...)         // preencher nada → clicar Finalizar → create não chamado
it('submit válido chama create com identidade mapeada', ...) // preencher nome/email/senha(+telefone) → create chamado com { name,email,password,phone } e SEM tipoSanguineo/genero
it('sucesso chama onBack', ...)                             // mock create resolve { data:{...}, error:null } → onBack chamado
```
**Step 3:** adicionar ao `AdminsCreate`:
- `submitting` state + `error` state.
- `handleSubmit`: validar (nomeCompleto/email/senha obrigatórios; email regex; senha.length>=8) → se inválido, setar erro e não submeter; senão `setSubmitting(true)`, montar payload identidade, chamar `subject === 'funcionário' ? employeesApi.create : adminsApi.create`, no sucesso `onBack?.()` (+ toast), no erro setar mensagem; `finally setSubmitting(false)`.
- `parseBR(dataNascimento)`: `DD/MM/AAAA` → ISO (`new Date(aaaa, mm-1, dd).toISOString()`), undefined se vazio/incompleto.
- Ligar `onPress={handleSubmit}` e `disabled={submitting}` no botão "Finalizar Cadastro". Mostrar `error` (Text vermelho) acima do footer.
- NÃO enviar campos de saúde/usuário/exames.
**Step 4:** vitest AdminsCreate.test.tsx → PASS.
**Step 5:** commit `feat(admin): fia o Finalizar Cadastro ao POST /users (validação + submit)`.

### Task B3: refresh da lista pós-cadastro
**Files:** `EmployeesList.tsx`, `AdminsList.tsx`.
**Step 3:** adicionar `reloadKey` state em cada lista; incluir na dep do `useEffect` de fetch; passar pro `AdminsCreate` um `onBack` que faz `setTab('cadastrados')` E `setReloadKey(k => k+1)`. (Sem teste dedicado além do smoke — comportamento coberto ao vivo.)
**Step 4:** vitest run (suíte inteira) + `tsc --noEmit` + `vite build` → tudo verde.
**Step 5:** commit `feat(admin): recarrega a lista após cadastro`.

---

## Verificação final (ao vivo)
- Backend rebuild (`docker compose ... up -d --build api`).
- Playwright: login admin → /employees → aba Cadastrar → preencher nome/email/senha/telefone → Finalizar → volta pra Cadastrados com o novo colaborador → `POST /users` 200. Depois logout + login com o email+senha criados → entra (prova APPROVED+verified). 0 erros de console.
- Testar 409: cadastrar o mesmo email de novo → toast de erro.

## Riscos / notas
- **Hash helper:** reusar exatamente o `hash()` do auth (não reimplementar). Achar o import no topo de `auth.service.ts`.
- **birthDate:** o form manda `DD/MM/AAAA`; o backend espera ISO opcional. Parse no client.
- **Regra DS:** só compor DS + `useTheme()`. O form já usa DS (Input/Combobox/Radio/Button/ImageUploader) — não criar componentes.
- **NÃO commitar** eas.json, .playwright-mcp, screenshots, docker-compose.ports-alt.yml.
