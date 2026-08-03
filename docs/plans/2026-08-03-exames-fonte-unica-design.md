# Exames clínicos: fonte única + novos tipos de arquivo

**Data:** 2026-08-03
**Status:** desenho aprovado, pendente de implementação

## Problema

O usuário reportou que o exame clínico "não é enviado e salvo no perfil", pelo
painel admin, em Meu perfil / Configurações.

### Causa raiz (investigada, com evidência)

O upload **funciona e persiste**. O que não existe é a exibição de volta.

`swi-admin/src/pages/user/UserSettings.tsx` sobe o arquivo com
`uploadImage(f, 'exams')` e grava via `profileApi.update({ examKeys })`, ou seja
`PUT /profile/me` → coluna `Profile.examKeys`. A tela então mostra apenas um
contador textual `(N no perfil)` ao lado do botão. Não há card, nome, validade
nem link de download. Do ponto de vista do usuário, o exame sumiu.

Evidência colhida em produção (leitura, com token admin):

- `GET /profile/exams` → `200 []` (tabela `Exam` vazia, e o 200 prova que a
  tabela existe em produção)
- `GET /profile/me` → `examKeys: ["exams/b8ee7cc9-…png"]` com `examUrls`
  presignado, e `exams: []`

Ou seja, o arquivo enviado está em `examKeys`, e todas as telas que renderizam
histórico de exame leem de outro lugar.

### O problema real é arquitetural: três representações desconexas

| Superfície | Escreve/lê | Situação |
| --- | --- | --- |
| Painel, Meu perfil (`UserSettings`) | `Profile.examKeys` via `PUT /profile/me` | Persiste, mas só exibe contador |
| App mobile, Dados de saúde (`health-data`) | Tabela `Exam` via `POST /profile/exams` | Coerente, exibe `ExamInfoCard` |
| Painel, detalhe do funcionário (`WorkerDetailsLayout`) | `examHistory` | O mapper real (`services/api/users.ts`) nunca preenche o campo, então a seção fica vazia. Os dados de exemplo só existem em `mockApi/`, fora do caminho real |

A tabela `Exam` é a representação correta: tem `name`, `date` (validade) e
`fileKey`, que é exatamente o que o `ExamInfoCard` do design precisa.

## Decisão

Unificar tudo na tabela `Exam` e ligar o detalhe do funcionário ao dado real.
`Profile.examKeys` fica **deprecado**: nada volta a escrever nele. A coluna
permanece no schema (remover exigiria migration destrutiva, sem ganho agora).

### Contrato de arquivo

- Tipos aceitos: **PDF, JPG, PNG, TXT**
- Teto: **15 MB** (inalterado)
- Cadastro no painel: **nome + validade + arquivo, um por vez**, igual ao mobile
  e ao Figma

### Escopo de content-type é POR PREFIXO

O `PresignDto` valida `contentType` com um `@IsIn` **global**, independente do
`prefix`. Liberar pdf/txt ali afrouxaria todos os domínios de mídia.

O dano seria limitado, porque cada consumidor valida a própria key com
`.(jpg|png)`: chat (`chat/…`), tarefa (`task/…`), ordem (`order/…`), avatar
(`avatars/…`). Um PDF não conseguiria ser anexado a nenhum deles. Mas o presign
ainda assinaria a URL e o arquivo subiria pro bucket, órfão: lixo de storage e
vetor de abuso.

Por isso a validação passa a ser **por prefixo**: só `exams` aceita pdf/txt, o
resto continua imagem. O resultado é mais restrito que hoje, não menos.

## Sequência: 3 PRs, um app por branch

O mobile exige `expo-document-picker`, que **não está instalado** e é módulo
nativo, logo demanda build EAS nova. O painel é web e usa `<input type="file">`,
sem dependência nova. Como o bug reportado é no painel, ele vem primeiro e o
mobile fica desacoplado.

### PR 1 `feat/backend-exam-filetypes` (bloqueia os demais)

- `media/dto.ts` + `media.service.ts`: content-type validado por prefixo; só
  `exams` aceita `application/pdf` e `text/plain`
- `media.service.ts` `ext()`: mapeia content-type para extensão
  (`pdf`, `txt`, `jpg`, `png`)
- `profile/dto.ts`: regex de `CreateExamDto.fileKey` passa a
  `(jpg|png|pdf|txt)`. **`UpdateProfileDto.examKeys` fica como está**, porque
  nada mais escreve nele
- `GET /users/:id` passa a devolver `exams: [{id,name,date,fileUrl}]` do worker,
  presignados

### PR 2 `feat/admin-exam-unify`

- `UserSettings.tsx`: troca o upload em lote por formulário (nome + validade +
  arquivo), grava via `POST /profile/exams` e renderiza os exames como
  `ExamInfoCard` com download. **É isto que conserta o bug reportado**
- `services/api/upload.ts` (`ALLOWED`) e `accept` do input: novos tipos
- `services/api/users.ts`: o mapper passa a preencher `examHistory` a partir do
  `exams` real do `/users/:id`

### PR 3 `feat/mobile-exam-filetypes` (depois, junto da próxima build)

- Instalar `expo-document-picker`
- `health-data.tsx`: troca `pickFromGallery` por document picker, com
  `copyToCacheDirectory: true` (sem isso o Android devolve `content://` e o
  `new File(uri)` do `expo-file-system` não lida)
- `uploadMedia.ts` `contentTypeFor`: infere pdf/txt além das imagens

## Design system

Regra do projeto: usar `@kavicki/swi-design-system` como está. O formulário novo
do painel usa `Input`, `Button` e `ExamInfoCard` do DS, sem componente local.
Nenhuma lacuna de DS identificada, logo nenhum bump previsto.

## Fluxo depois da mudança

Worker sobe exame pelo app e admin sobe o próprio pelo painel: ambos gravam na
tabela `Exam`. O admin abre um worker e o `/users/:id` traz os exames dele. As
telas do mobile (`my-stats`, `health-data`) já leem dessa tabela. Uma fonte só.

## Testes

- Backend (jest): presign aceita os 4 tipos em `exams` e recusa pdf/txt nos
  demais prefixos; `ext()` mapeia corretamente; `/users/:id` inclui exames;
  `/profile/exams` segue intacto
- Painel (vitest): `UserSettings` renderiza card após upload e no prefill;
  detalhe do funcionário exibe exame real
- Mobile (PR 3): `contentTypeFor` cobre pdf/txt

## Riscos declarados

- **Privacidade:** expor arquivos de exame do worker a qualquer admin é um
  degrau acima do que já existe. Há precedente (`/users/:id` já devolve
  alergias, doenças crônicas e tipo sanguíneo), então é coerente, mas é escolha
  consciente, não efeito colateral
- **`uploadImage` passa a subir documento** e o nome fica impreciso. Renomear
  para `uploadFile` toca call sites de reports/chat/task/avatar. Decisão adiada
- **`expo-file-system` não está declarado** no `package.json` do mobile, embora
  seja importado por `uploadMedia.ts`. Funciona por dependência transitiva.
  Fragilidade registrada, fora do escopo

## Fora de escopo

- Remover a coluna `Profile.examKeys` (migration destrutiva)
- Migrar o registro órfão que existe hoje em produção. O usuário re-envia pelo
  fluxo novo
