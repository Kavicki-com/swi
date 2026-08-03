# Exames clínicos: fonte única + novos tipos de arquivo — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer o exame clínico enviado pelo painel aparecer de verdade no perfil (hoje some), unificando tudo na tabela `Exam`, e aceitar PDF/JPG/PNG/TXT.

**Architecture:** O upload do painel grava hoje em `Profile.examKeys` e a tela só mostra um contador, enquanto o resto do produto lê a tabela `Exam`. Unificamos na tabela `Exam` (que tem nome + validade + arquivo, o que o `ExamInfoCard` do design precisa), deprecamos `examKeys` sem removê-lo, e ligamos o detalhe do funcionário ao dado real. O content-type do presign passa a ser validado **por prefixo**, então só `exams` ganha pdf/txt.

**Tech Stack:** NestJS + Prisma + class-validator (backend, jest); React + Vite + `@kavicki/swi-design-system` (painel, vitest); S3 presign contra Cloudflare R2 / MinIO.

**Desenho:** ver `docs/plans/2026-08-03-exames-fonte-unica-design.md`

**Fora deste plano:** o PR 3 (mobile) exige `expo-document-picker`, que não está instalado e é módulo nativo, logo demanda build EAS nova. Fica para quando houver build.

---

## PR 1 — `feat/backend-exam-filetypes`

Bloqueia o PR 2. Sem schema change, logo **sem migration**.

Antes de começar:

```bash
cd C:\Users\Gabriel\Documents\SWI-mobile
git checkout -b feat/backend-exam-filetypes
cd swi-backend
```

---

### Task 1: Content-type permitido por prefixo

Hoje `PresignDto` valida `contentType` com um `@IsIn` global, sem olhar o `prefix`. Liberar pdf/txt ali afrouxaria chat, tarefa, ordem e avatar. A regra passa a viver numa função pura, testável, e o DTO deixa de validar tipo sozinho.

**Files:**
- Create: `src/media/allowedContentTypes.ts`
- Create: `src/media/allowedContentTypes.spec.ts`
- Modify: `src/media/dto.ts:6`
- Modify: `src/media/media.service.ts:60-69` (`presignPut`)

**Step 1: Escrever o teste que falha**

Criar `src/media/allowedContentTypes.spec.ts`:

```ts
import { isContentTypeAllowed, IMAGE_TYPES, EXAM_TYPES } from './allowedContentTypes'

describe('isContentTypeAllowed', () => {
  it('aceita imagem em qualquer prefixo', () => {
    for (const p of ['reports', 'task', 'chat', 'order', 'avatars', 'exams']) {
      expect(isContentTypeAllowed('image/jpeg', p)).toBe(true)
      expect(isContentTypeAllowed('image/png', p)).toBe(true)
    }
  })

  // O ponto do PR: documento SÓ em exams.
  it('aceita pdf e txt apenas em exams', () => {
    expect(isContentTypeAllowed('application/pdf', 'exams')).toBe(true)
    expect(isContentTypeAllowed('text/plain', 'exams')).toBe(true)
    for (const p of ['reports', 'task', 'chat', 'order', 'avatars']) {
      expect(isContentTypeAllowed('application/pdf', p)).toBe(false)
      expect(isContentTypeAllowed('text/plain', p)).toBe(false)
    }
  })

  it('recusa tipo desconhecido em qualquer prefixo', () => {
    expect(isContentTypeAllowed('application/x-msdownload', 'exams')).toBe(false)
    expect(isContentTypeAllowed('', 'exams')).toBe(false)
  })

  // prefix ausente cai no default 'reports' (mesmo default do presignPut).
  it('trata prefix indefinido como reports', () => {
    expect(isContentTypeAllowed('image/png', undefined)).toBe(true)
    expect(isContentTypeAllowed('application/pdf', undefined)).toBe(false)
  })

  it('expõe as listas usadas pelo resto do módulo', () => {
    expect(IMAGE_TYPES).toEqual(['image/jpeg', 'image/png'])
    expect(EXAM_TYPES).toContain('application/pdf')
  })
})
```

**Step 2: Rodar e ver falhar**

Run: `npx jest src/media/allowedContentTypes.spec.ts`
Expected: FAIL, `Cannot find module './allowedContentTypes'`

**Step 3: Implementar o mínimo**

Criar `src/media/allowedContentTypes.ts`:

```ts
// Tipos aceitos POR PREFIXO. Antes o PresignDto validava contentType com um
// @IsIn global: liberar pdf pra exame liberaria pdf pra chat, tarefa, ordem e
// avatar. Nenhum deles conseguiria ANEXAR o arquivo (cada consumidor valida a
// própria key contra `.(jpg|png)`), mas o presign assinaria a URL e o arquivo
// subiria pro bucket, órfão: lixo de storage e vetor de abuso.
export const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const

// Exame clínico costuma vir em PDF; txt entra a pedido do cliente.
export const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain'] as const

// Mesmo default do presignPut — prefix ausente significa 'reports'.
const DEFAULT_PREFIX = 'reports'

export function isContentTypeAllowed(contentType: string, prefix?: string): boolean {
  const allowed: readonly string[] = (prefix ?? DEFAULT_PREFIX) === 'exams' ? EXAM_TYPES : IMAGE_TYPES
  return allowed.includes(contentType)
}
```

**Step 4: Rodar e ver passar**

Run: `npx jest src/media/allowedContentTypes.spec.ts`
Expected: PASS

**Step 5: Ligar no DTO e no service**

Em `src/media/dto.ts`, remover o `@IsIn` de `contentType` (a regra agora depende do `prefix`, que o DTO não consegue cruzar de forma legível) e deixar só `@IsString()`:

```ts
  // Sem @IsIn aqui: o tipo permitido DEPENDE do prefix (ver allowedContentTypes).
  // O presignPut valida e devolve 400 com a lista certa.
  @IsString() contentType!: string
```

Em `src/media/media.service.ts`, dentro de `presignPut`, logo após a guarda de `configured` e antes de montar a key:

```ts
    if (!isContentTypeAllowed(contentType, prefix)) {
      throw new BadRequestException(`Tipo de arquivo não permitido para ${prefix}`)
    }
```

E o import no topo do arquivo:

```ts
import { isContentTypeAllowed } from './allowedContentTypes'
```

**Step 6: Rodar a suíte inteira do backend**

Run: `npx jest`
Expected: PASS. Se algum teste de `media` esperava 400 vindo do ValidationPipe por content-type, ele agora recebe o 400 do service. Ajustar a expectativa, não a regra.

**Step 7: Commit**

```bash
git add src/media/allowedContentTypes.ts src/media/allowedContentTypes.spec.ts src/media/dto.ts src/media/media.service.ts
git commit -m "feat(backend): tipo de arquivo permitido por prefixo, so exame aceita pdf e txt"
```

---

### Task 2: `ext()` mapeia pdf e txt

Hoje `ext()` é um ternário que devolve `png` ou `jpg`. Um PDF viraria key `.jpg`, e o regex do `CreateExamDto` recusaria depois do upload já ter subido.

**Files:**
- Modify: `src/media/media.service.ts:40-42`
- Test: `src/media/media.service.spec.ts`

**Step 1: Escrever o teste que falha**

Acrescentar em `src/media/media.service.spec.ts` (seguir o estilo já usado no arquivo para instanciar o service):

```ts
describe('key do presign por content-type', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['application/pdf', 'pdf'],
    ['text/plain', 'txt'],
  ])('%s vira .%s', async (contentType, esperado) => {
    const { key } = await service.presignPut(contentType, 1234, 'exams')
    expect(key).toMatch(new RegExp(`^exams/[0-9a-f-]{36}\\.${esperado}$`))
  })
})
```

**Step 2: Rodar e ver falhar**

Run: `npx jest src/media/media.service.spec.ts -t "vira"`
Expected: FAIL nos casos pdf e txt (key sai `.jpg`)

**Step 3: Implementar**

Substituir `ext()` em `src/media/media.service.ts`:

```ts
  // Extensão derivada do content-type JÁ VALIDADO por allowedContentTypes.
  // Default 'jpg' só é alcançável por tipo permitido sem entrada no mapa.
  private ext(contentType: string): string {
    const MAP: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    }
    return MAP[contentType] ?? 'jpg'
  }
```

**Step 4: Rodar e ver passar**

Run: `npx jest src/media/media.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/media/media.service.ts src/media/media.service.spec.ts
git commit -m "feat(backend): extensao da key acompanha o content-type do arquivo"
```

---

### Task 3: `CreateExamDto` aceita as novas extensões

**Files:**
- Modify: `src/profile/dto.ts:43`
- Test: `src/profile/dto.spec.ts`

Atenção: **não** mexer em `UpdateProfileDto.examKeys` (linha 34). Depois deste plano nada mais escreve nele, então ampliá-lo seria mudança morta.

**Step 1: Escrever o teste que falha**

Acrescentar em `src/profile/dto.spec.ts`, seguindo o estilo de validação já usado no arquivo:

```ts
describe('CreateExamDto.fileKey', () => {
  const UUID = '3f4a2b1c-5d6e-4f70-8a9b-0c1d2e3f4a5b'

  it.each(['jpg', 'png', 'pdf', 'txt'])('aceita exams/<uuid>.%s', async (ext) => {
    const dto = plainToInstance(CreateExamDto, {
      name: 'Exame de reciclagem',
      date: '2027-03-05',
      fileKey: `exams/${UUID}.${ext}`,
    })
    expect(await validate(dto)).toHaveLength(0)
  })

  it.each([
    `avatars/${UUID}.pdf`,   // prefixo errado
    `exams/${UUID}.exe`,     // extensão fora da lista
    `exams/nao-e-uuid.pdf`,  // id malformado
  ])('recusa %s', async (fileKey) => {
    const dto = plainToInstance(CreateExamDto, {
      name: 'Exame', date: '2027-03-05', fileKey,
    })
    expect(await validate(dto)).not.toHaveLength(0)
  })
})
```

**Step 2: Rodar e ver falhar**

Run: `npx jest src/profile/dto.spec.ts -t "fileKey"`
Expected: FAIL nos casos pdf e txt

**Step 3: Implementar**

Em `src/profile/dto.ts`, na `CreateExamDto`:

```ts
  @Matches(/^exams\/[0-9a-f-]{36}\.(jpg|png|pdf|txt)$/) fileKey!: string
```

**Step 4: Rodar e ver passar**

Run: `npx jest src/profile/dto.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/profile/dto.ts src/profile/dto.spec.ts
git commit -m "feat(backend): exame aceita chave de pdf e txt"
```

---

### Task 4: `GET /users/:id` devolve os exames do worker

É o que permite o painel mostrar histórico real no detalhe do funcionário, em vez do vazio de hoje.

**Files:**
- Modify: `src/users/users.service.ts:182-189` (`getOne`) e `:215-230` (`toDetailDto`)
- Test: `src/users/users.service.spec.ts`

**Step 1: Escrever o teste que falha**

Acrescentar em `src/users/users.service.spec.ts`:

```ts
it('detalhe do usuário inclui os exames, com URL assinada e data de calendário', async () => {
  prisma.user.findUnique.mockResolvedValue({
    ...usuarioBase,          // helper já existente no arquivo
    exams: [
      { id: 'e1', name: 'Audiometria', date: new Date('2027-03-05T00:00:00.000Z'), fileKey: 'exams/k.pdf' },
    ],
  })

  const dto = await service.getOne(usuarioBase.id, usuarioBase.companyId)

  expect(dto.exams).toEqual([
    { id: 'e1', name: 'Audiometria', date: '2027-03-05', fileUrl: 'signed:exams/k.pdf' },
  ])
})

it('usuário sem exame devolve lista vazia, nunca undefined', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...usuarioBase, exams: [] })
  const dto = await service.getOne(usuarioBase.id, usuarioBase.companyId)
  expect(dto.exams).toEqual([])
})
```

Conferir o mock de `media.presignGet` já existente no arquivo; o `signed:` acima assume o padrão usado nos testes de avatar. Alinhar com o que estiver lá.

**Step 2: Rodar e ver falhar**

Run: `npx jest src/users/users.service.spec.ts -t "exames"`
Expected: FAIL, `dto.exams` é `undefined`

**Step 3: Implementar**

Em `getOne`, incluir a relação (ordem igual à do `ProfileService.listExams`, validade mais distante primeiro):

```ts
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        company: true,
        exams: { orderBy: { date: 'desc' } },
      },
    })
```

Em `toDetailDto`, acrescentar ao objeto devolvido:

```ts
      // Histórico clínico REAL do worker. O detalhe do painel já tinha a UI
      // (ExamInfoCard) mas o DTO nunca trouxe os exames, então a seção ficava
      // vazia para todo mundo. Data de CALENDÁRIO ('AAAA-MM-DD'): mandar ISO
      // datetime faria o dia recuar um em fuso negativo na formatação.
      exams: await Promise.all(
        (u.exams ?? []).map(async (e) => ({
          id: e.id,
          name: e.name,
          date: e.date.toISOString().slice(0, 10),
          fileUrl: await this.media.presignGet(e.fileKey),
        })),
      ),
```

Ajustar o tipo `UserWithProfileCompany` para incluir `exams` (seguir como `profile`/`company` já estão declarados no arquivo).

**Step 4: Rodar e ver passar**

Run: `npx jest src/users/users.service.spec.ts`
Expected: PASS

**Step 5: Suíte inteira + tipos**

Run: `npx jest && npx tsc --noEmit`
Expected: PASS nos dois

**Step 6: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(backend): detalhe do usuario devolve o historico de exames"
```

---

### Fechamento do PR 1

```bash
npx jest && npx tsc --noEmit
git push -u origin feat/backend-exam-filetypes
```

Abrir PR com link `/compare/main...feat/backend-exam-filetypes?expand=1`.

**Depois do merge, o backend precisa ir pra produção** para o PR 2 funcionar no QA. Sem schema change, então o deploy é build local + SFTP, sem `prisma migrate deploy`. Ver o runbook de deploy.

---

## PR 2 — `feat/admin-exam-unify`

Depende do PR 1 estar em produção (ou apontar o painel pro backend local).

```bash
cd C:\Users\Gabriel\Documents\SWI-mobile
git checkout main && git pull
git checkout -b feat/admin-exam-unify
cd swi-admin
```

---

### Task 5: `uploadImage` aceita os novos tipos

**Files:**
- Modify: `src/services/api/upload.ts:10,42`
- Test: `src/services/api/upload.test.ts`

**Step 1: Escrever o teste que falha**

```ts
it('aceita pdf e txt quando o prefixo é exams', async () => {
  const pdf = new File(['x'], 'exame.pdf', { type: 'application/pdf' })
  await expect(uploadImage(pdf, 'exams')).resolves.toBeDefined()
})

it('recusa pdf fora de exams, com mensagem acionável', async () => {
  const pdf = new File(['x'], 'foto.pdf', { type: 'application/pdf' })
  await expect(uploadImage(pdf, 'chat')).rejects.toThrow(/JPG ou PNG/)
})
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/api/upload.test.ts`
Expected: FAIL, o pdf é recusado mesmo em `exams`

**Step 3: Implementar**

Em `src/services/api/upload.ts`, trocar a constante e a guarda. Espelha `allowedContentTypes.ts` do backend; divergir só troca um erro claro no client por um 400 do servidor:

```ts
const IMAGE_TYPES = ['image/jpeg', 'image/png']
const EXAM_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain']
```

E dentro de `uploadImage`, no lugar da checagem atual:

```ts
  const allowed = prefix === 'exams' ? EXAM_TYPES : IMAGE_TYPES
  if (!allowed.includes(file.type)) {
    throw new Error(
      prefix === 'exams'
        ? 'Selecione arquivos do tipo: PDF, JPG, PNG ou TXT'
        : 'Selecione arquivos do tipo: JPG ou PNG',
    )
  }
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/services/api/upload.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/api/upload.ts src/services/api/upload.test.ts
git commit -m "feat(admin): upload de exame aceita pdf, txt e imagem"
```

---

### Task 6: Formulário de exame + cards no `UserSettings`

**O núcleo do bug reportado.** Sai o upload em lote que só incrementava um contador; entra nome + validade + arquivo, gravando na tabela `Exam`, com os exames renderizados como `ExamInfoCard`.

**Regra do DS:** usar `Input`, `Button` e `ExamInfoCard` de `@kavicki/swi-design-system` como estão. Nenhum componente local.

**Files:**
- Create: `src/services/api/exams.ts`
- Modify: `src/pages/user/UserSettings.tsx:300,349,446-467,591-617`
- Modify: `src/pages/user/UserSettings.tsx:521-524` (`accept` do input)
- Test: `src/pages/user/UserSettings.test.tsx`

**Step 1: Client de exames do painel**

Criar `src/services/api/exams.ts`, espelhando `mobile/services/api/exams.ts` (mesmo contrato, mesmo backend):

```ts
import type { MockResponse } from '@/services/mockApi/types'
import { apiFetch } from './http'

export type Exam = { id: string; name: string; date: string; fileUrl: string }

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export const examsApi = {
  list: async (): Promise<MockResponse<Exam[]>> => {
    try {
      return { data: await apiFetch<Exam[]>('/profile/exams'), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar exames') } }
    }
  },
  // `date` é a VALIDADE, em data de calendário 'AAAA-MM-DD'.
  create: async (input: { name: string; date: string; fileKey: string }): Promise<MockResponse<Exam>> => {
    try {
      const created = await apiFetch<Exam>('/profile/exams', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { data: created, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao enviar exame') } }
    }
  },
}
```

**Step 2: Escrever o teste que falha**

Em `src/pages/user/UserSettings.test.tsx`:

```ts
it('lista os exames existentes como card, com nome e ação de baixar', async () => {
  mockExamsList([{ id: 'e1', name: 'Audiometria', date: '2027-03-05', fileUrl: 'https://x/e1.pdf' }])
  render(<UserSettings />)
  expect(await screen.findByText('Audiometria')).toBeInTheDocument()
})

it('exige nome e validade antes de deixar anexar', async () => {
  render(<UserSettings />)
  await userEvent.click(await screen.findByRole('button', { name: /enviar exame/i }))
  expect(await screen.findByText(/informe o nome/i)).toBeInTheDocument()
})

it('some com o estado vazio depois que o exame é enviado', async () => {
  mockExamsList([])
  render(<UserSettings />)
  expect(await screen.findByText(/nenhum exame enviado/i)).toBeInTheDocument()
  // preencher nome + validade, escolher arquivo, submeter
  // …
  expect(await screen.findByText('Audiometria')).toBeInTheDocument()
})
```

**Step 3: Rodar e ver falhar**

Run: `npx vitest run src/pages/user/UserSettings.test.tsx`
Expected: FAIL

**Step 4: Implementar**

Trocar o estado `examKeys` por `exams: Exam[]`, carregar com `examsApi.list()` no mount (junto do prefill), e substituir `onExamsSelected` por um fluxo com nome e validade:

- Dois `Input` do DS: "Nome do exame" e "Validade" (`dd/mm/aaaa`)
- Botão que abre o seletor de arquivo (`examsInputRef`), **desabilitado até nome e validade serem válidos**, mesma ordem do mobile (anexar é o último passo)
- No `change` do input: `uploadImage(file, 'exams')` → `examsApi.create({ name, date, fileKey })` → prepend em `exams`, limpar campos
- Renderizar `exams.map(...)` como `ExamInfoCard` com `onActionPress` abrindo `fileUrl`; estado vazio explícito "Nenhum exame enviado."
- Converter `dd/mm/aaaa` → `AAAA-MM-DD` no envio, como `health-data.tsx:88-91`
- Remover o contador `(N no perfil)` e o `setExamKeys(data.examKeys ?? [])` do prefill

Atualizar o `accept` do input de exames (linha ~524):

```tsx
          accept="application/pdf,image/jpeg,image/png,text/plain"
```

Deixar o `accept` do input de **avatar** (linha ~516) como está: avatar continua só imagem.

**Step 5: Rodar e ver passar**

Run: `npx vitest run src/pages/user/UserSettings.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/services/api/exams.ts src/pages/user/UserSettings.tsx src/pages/user/UserSettings.test.tsx
git commit -m "fix(admin): exame enviado aparece no perfil, com nome, validade e download"
```

---

### Task 7: Detalhe do funcionário mostra exame real

**Files:**
- Modify: `src/services/api/users.ts:36-46` (`UserDetailDto`), `:90-105` (`toEmployee`), `:109-124` (`toAdmin`)
- Test: `src/services/api/users.test.ts`

**Step 1: Escrever o teste que falha**

```ts
it('mapeia os exames do DTO para o examHistory da UI', () => {
  const e = toEmployee({
    ...dtoBase,
    exams: [{ id: 'e1', name: 'Audiometria', date: '2027-03-05', fileUrl: 'https://x/e1.pdf' }],
  })
  expect(e.examHistory).toEqual([
    expect.objectContaining({ id: 'e1', title: 'Audiometria', year: '2027' }),
  ])
})

it('sem exames não inventa histórico', () => {
  expect(toEmployee({ ...dtoBase, exams: [] }).examHistory).toBeUndefined()
})
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/api/users.test.ts -t "exame"`
Expected: FAIL

**Step 3: Implementar**

Acrescentar ao `UserDetailDto`:

```ts
  // Histórico clínico real (backend PR feat/backend-exam-filetypes). Ausente em
  // respostas antigas, por isso opcional.
  exams?: ReadonlyArray<{ id: string; name: string; date: string; fileUrl: string }>
```

E um mapper que quebra `AAAA-MM-DD` nas partes que o `ExamInfoCard` pede. **Fatiar texto, não usar `Date`**: a validade é data de calendário e `new Date('2027-03-05')` é meia-noite UTC, que em UTC-3 volta pro dia 4. Mesma pegadinha já documentada em `mobile/services/api/examCard.ts`.

```ts
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function toExamHistory(exams: UserDetailDto['exams']): WorkerExamEntry[] | undefined {
  if (!exams || exams.length === 0) return undefined
  return exams.map((e) => {
    const [y, m, d] = e.date.split('-')
    return {
      id: e.id,
      title: e.name,
      year: y ?? '',
      date: `${d ?? ''} ${MESES[Number(m) - 1] ?? ''}`.trim(),
      fileUrl: e.fileUrl,
    }
  })
}
```

Chamar em `toEmployee` e `toAdmin`: `examHistory: toExamHistory(detail.exams)`.

Conferir o shape exato de `WorkerExamEntry` em `src/pages/_shared/WorkerDetailsLayout.tsx:32` e alinhar os nomes de campo.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/services/api/users.test.ts`
Expected: PASS

**Step 5: Suíte inteira + tipos + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS nos três

**Step 6: Commit**

```bash
git add src/services/api/users.ts src/services/api/users.test.ts
git commit -m "feat(admin): detalhe do funcionario mostra o historico de exames real"
```

---

### Fechamento do PR 2

```bash
npx vitest run && npx tsc --noEmit && npm run build
git push -u origin feat/admin-exam-unify
```

**Verificação manual antes de dar por pronto:** subir um PDF em Meu perfil e confirmar que o card aparece com nome, validade e download funcionando. É exatamente o sintoma reportado; teste automatizado não substitui olhar a tela.

---

## Notas de execução

- **Commits:** neste projeto o commit espera luz verde explícita. Os `git commit` acima são o ponto de parada sugerido, não autorização.
- **Sem rastro de IA:** nada de `Co-Authored-By` de assistente nem rodapé "Generated with" nas mensagens de commit ou no corpo do PR.
- **Uma app por branch:** `swi-backend/` e `swi-admin/` não se misturam no mesmo PR.
- **Design system:** qualquer lacuna encontrada vira proposta de bump do DS, nunca componente local.
