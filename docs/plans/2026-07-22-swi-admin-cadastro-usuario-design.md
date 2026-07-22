# Design — Cadastro de colaborador/admin pelo painel (POST /users)

**Data:** 2026-07-22
**Fatia:** follow-up #2 do Passo 2 (ver `project_swi_admin_backend_roadmap` na memória)
**Branch:** `feat/backend-admin-cadastro` (empilhada em `feat/backend-admin-users`)

## Problema

O form `AdminsCreate.tsx` (compartilhado por Admins e Funcionários via prop `subject`) tem "Finalizar Cadastro" como **no-op** — o admin não consegue cadastrar ninguém pelo painel. Não existe endpoint de "admin cria usuário": só `POST /auth/signup` (self-signup mobile → WORKER/PENDING + código) e `POST /auth/signup-company` (empresa + admin por link). Precisa de um `POST /users` novo.

## Decisões (do brainstorming)

1. **Ativação:** o admin **define a senha** no form → usuário nasce `approvalStatus=APPROVED` + `emailVerified=true` → **loga imediatamente** com email+senha. (Confirmado contra `auth.service.login`: exige `emailVerified===true` E `approvalStatus==='APPROVED'`.)
2. **Só identidade persiste:** name, email, password, telefone, cpf, nascimento + empresa + role. Os campos de saúde (tipo sanguíneo, gênero, alergias, doenças crônicas), **nome de usuário** e **exames** ficam no form (fidelidade Figma) mas **inertes** — mesma lacuna smartband/clínica da fatia de leitura.
3. **Admin sem empresa:** se o admin logado não tem `companyId` (ex.: admin do seed), cria o usuário com `companyId=null` (sem bloqueio).

## Arquitetura

### Backend (`swi-backend`)
- **`POST /users`** (ADMIN) — controller usa `@CurrentUserId()` pra pegar o admin logado; body `CreateUserDto`.
- `CreateUserDto`: `{ name (req), email (req, @IsEmail), password (req, min 8), role: 'WORKER'|'ADMIN' (req), phone?, cpf?, birthDate? (ISO opcional) }` — class-validator, mesmo estilo dos DTOs existentes.
- `UsersService.create(adminId, dto)`:
  1. Se `findByEmail(dto.email)` existe → `ConflictException` (409).
  2. Lê o admin (`findById(adminId)`) pra pegar `companyId` (pode ser null).
  3. `passwordHash` = **mesmo helper `hash()` que o auth usa** (reusar; NÃO reimplementar bcrypt).
  4. Cria `User { name, email, passwordHash, role: dto.role, approvalStatus:'APPROVED', emailVerified:true, companyId }` com `Profile` aninhado `{ fullName: name, phone, cpf, birthDate }` (só os presentes).
  5. Devolve o `toSummaryDto` do usuário criado (reusa o mapper existente).
- Sem throttle (rota ADMIN autenticada, consistente com as outras rotas de /users).

### Admin (`swi-admin`)
- **Client (`services/api/users.ts`):** `employeesApi.create(input)` (role WORKER) + `adminsApi.create(input)` (role ADMIN), compartilhando um helper `createUser(role, input)`; envelope `MockResponse`. `input = { name, email, password, phone?, cpf?, birthDate? }`.
- **`AdminsCreate.tsx`:** fia o "Finalizar Cadastro":
  - **Validação** antes do submit: obrigatórios `nomeCompleto`, `email`, `senha`; email válido; senha ≥8. Erros mostrados inline (Input já tem estado de erro no DS) ou via toast; botão desabilitado enquanto `submitting`.
  - Monta payload **só identidade**: `{ name: nomeCompleto, email, password: senha, phone: telefone||undefined, cpf: cpf||undefined, birthDate: parseBR(dataNascimento) }` — `parseBR('DD/MM/AAAA')→ISO` (undefined se vazio/inválido).
  - Escolhe a api pelo `subject` (`'funcionário'→employeesApi.create`, senão `adminsApi.create`).
  - Sucesso → `showToast('Cadastro concluído', ...)` + `onBack()` + dispara refetch da lista (ver abaixo). Erro (ex. 409) → toast com a mensagem.
- **Refresh da lista:** hoje `EmployeesList`/`AdminsList` só buscam no mount. Adicionar um `reloadKey` (state) que o `onBack` de sucesso incrementa, e incluí-lo na dep do `useEffect` de fetch — assim ao voltar pra "Cadastrados" a lista recarrega e o novo usuário aparece. (Alternativa: `onCreated` callback; escolher a mais limpa na implementação.)
- Campos de saúde/usuário/exames: **permanecem renderizados** (fidelidade) mas não entram no payload.

## Fluxo de erro
- 409 (email duplicado) → toast "E-mail já cadastrado" (mensagem do backend).
- Falha de rede → toast genérico; form permanece preenchido (não limpa).
- Validação client-side bloqueia o submit antes de bater no backend.

## Testes (TDD)
**Backend (`users.service.spec.ts`):**
- `create()` cria User+Profile com APPROVED/emailVerified=true, role e companyId do admin; hash chamado.
- `create()` com email existente → `ConflictException`.
- `create()` com admin sem empresa → `companyId: null` no create (sem erro).

**Client (`api/users.test.ts`):**
- `employeesApi.create` → `POST /users` com `role:'WORKER'` + body de identidade; `adminsApi.create` → `role:'ADMIN'`.
- erro (409) → `{ data:null, error }`.

**Form (`AdminsCreate.test.tsx` — novo ou expandir):**
- Submit sem obrigatórios → não chama a api (validação bloqueia).
- Submit válido → chama `create` com o payload mapeado (só identidade, sem os campos de saúde).
- Sucesso → chama `onBack`.

**Gate:** vitest + `tsc` + `vite build` (admin); jest + `tsc` (backend). **Playwright ao vivo:** cadastrar um colaborador pelo form → aparece em "Cadastrados" → logar com o email+senha criados.

## Não-objetivos
- Editar usuário existente (só criação).
- Persistir saúde/exames/username (sem casa no backend; follow-up do módulo clínico).
- Upload real dos exames (o `ImageUploader` fica visual).
- `jobTitle`/`sector` no cadastro (não estão no form; usuário nasce sem eles → linhas com role/spec em branco, editável depois).
