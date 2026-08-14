# Plano de implementação — higiene do código executável

**Objetivo:** remover anotações internas e narrativas históricas do código
entregável, mantendo comportamento, layout, imagens e dados funcionais intactos.

**Estratégia:** criar primeiro um portão automatizado com testes; em seguida
limpar cada aplicação separadamente e executar a verificação específica da área
antes de avançar. O verificador examina comentários, mas não confunde datas de
fixtures, migrations, políticas de segurança ou textos da interface com
anotações históricas.

---

## Tarefa 1 — Portão automatizado de higiene

**Arquivos:**

- Criar: `scripts/quality/assert-client-hygiene.mjs`
- Criar: `scripts/quality/assert-client-hygiene.test.mjs`
- Modificar: `.github/workflows/ci.yml`

1. Escrever testes que reprovem comentários contendo referências internas,
   marcadores de QA, referências de design, datas de manutenção, relatos
   históricos e marcadores `TODO`, `FIXME`, `HACK` ou `XXX`.
2. Escrever testes negativos para preservar datas em strings de teste,
   migrations, políticas de segurança, textos de interface e a palavra
   portuguesa “todo”.
3. Executar os testes e confirmar que falham antes da implementação.
4. Implementar a coleta de arquivos, extração de comentários por tipo de arquivo
   e relatório com caminho, linha e regra violada.
5. Restringir a coleta a código, testes, scripts e configurações executáveis;
   excluir documentação, lockfiles, dependências, gerados e mídia.
6. Adicionar o portão e seus testes ao job `security` da CI.
7. Executar os testes do portão e confirmar que passam; executar o portão no
   repositório e guardar a lista inicial de violações para as tarefas seguintes.

## Tarefa 2 — Aplicativo mobile

**Áreas:**

- Modificar: `mobile/app/`
- Modificar: `mobile/components/`
- Modificar: `mobile/lib/`
- Modificar: `mobile/services/`
- Modificar: `mobile/hooks/`
- Modificar: `mobile/__tests__/` e `mobile/e2e/`
- Modificar quando apontados pelo portão: arquivos de configuração em `mobile/`

1. Remover IDs, coordenadas e referências de design; manter somente invariantes
   atuais de geometria ou plataforma.
2. Remover números, datas e relatos de QA de comentários e descrições de teste;
   conservar o comportamento que cada teste protege.
3. Retirar os marcadores pendentes de `mobile/app/(app)/dashboard.tsx` sem mudar
   as propriedades atuais do design system.
4. Remover o logger desativado de
   `mobile/components/Smartwatch3D.native.tsx` e qualquer import que fique sem
   uso, mantendo a renderização inalterada.
5. Reescrever justificativas necessárias no presente, com foco em contratos de
   navegação, rede, datas, teclado, cache e compatibilidade nativa.
6. Executar o portão limitado ao mobile, lint, typecheck e testes unitários.

## Tarefa 3 — Painel administrativo

**Áreas:**

- Modificar: `swi-admin/src/`
- Modificar: `swi-admin/e2e/`
- Modificar: `swi-admin/index.html`
- Modificar: `swi-admin/vite.config.ts`
- Modificar: `swi-admin/playwright.config.ts`
- Modificar quando apontados pelo portão: demais configurações em `swi-admin/`

1. Limpar comentários e títulos de teste de chat, mapas, monitoramento,
   relatórios, funcionários, administradores e configurações.
2. Em `swi-admin/src/services/chat/ChatProvider.tsx`, retirar o marcador de
   pendência sem esconder a limitação: o risco funcional será reportado fora do
   código, pois corrigi-lo mudaria comportamento e está fora deste lote.
3. Preservar explicações atuais sobre CORS, rotas, autorização, fallback de mapa,
   layout responsivo e estados assíncronos, retirando a narrativa de correção.
4. Executar o portão limitado ao painel, lint, typecheck e testes unitários.

## Tarefa 4 — Backend, infraestrutura e scripts

**Áreas:**

- Modificar: `swi-backend/src/`, `swi-backend/test/` e `swi-backend/prisma/`
- Modificar quando apontados pelo portão: Dockerfiles e Compose em `swi-backend/`
- Modificar: `scripts/client/`, `scripts/e2e/`, `scripts/quality/`,
  `scripts/security/` e `scripts/source-delivery/`
- Modificar: `.github/workflows/ci.yml`, `.gitignore`, `.gitleaks.toml`,
  `docker-compose.client.yml`, `START-SWI.cmd` e `STOP-SWI.cmd`

1. Converter comentários históricos em contratos atuais sobre escopo por
   empresa, autorização, paginação, uploads, notificações, filas e datas.
2. Preservar suppressions justificadas e compatibilidade de módulos, descrevendo
   somente a restrição técnica vigente.
3. Remover referências a planos, fases, decisões datadas, deploys e incidentes
   dos scripts e da CI; conservar instruções necessárias para execução local,
   Docker, segredos, portas e limpeza segura.
4. Manter intactas datas funcionais de migrations, fixtures, testes e
   `scripts/security/audit-policy.json`.
5. Executar o portão limitado ao backend/infra, lint, typecheck e testes do
   backend, além dos testes Node dos scripts alterados.

## Tarefa 5 — Verificação integral e revisão

1. Executar o portão de higiene no repositório completo até não restar violação.
2. Confirmar com `git diff --stat` e `git diff --word-diff` que imagens, valores
   funcionais e layout não foram alterados.
3. Mobile: executar `expo-doctor`, lint, typecheck, cobertura e `build:all`.
4. Painel: executar lint, typecheck, cobertura, portão de tamanho, build e build
   do Storybook.
5. Backend: gerar Prisma Client, executar lint, typecheck, cobertura, build e
   integração com Postgres.
6. Executar o fluxo local do cliente, validar health check, login e abertura do
   painel; encerrar sem remover volumes do usuário.
7. Solicitar revisão independente do diff e corrigir achados críticos ou altos.
8. Entregar relatório com comandos executados, resultados, arquivos alterados e
   qualquer limitação funcional mantida deliberadamente.

