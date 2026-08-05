# Higienização e Entrega do Código-Fonte SWI — Desenho

**Data:** 2026-08-05
**Status:** aprovado
**Branch isolada:** `chore/repo-source-delivery`
**Baseline:** `42141fa`

## Objetivo

Higienizar o sistema SWI completo — aplicativo mobile, painel administrativo e backend — sem alterar o checkout atual, endurecer o comportamento de produção, verificar qualidade e segurança e, somente depois, exportar o código textual em uma entrega BagIt 1.0 composta exclusivamente por arquivos `.txt`.

## Escopo

Entram na higienização e na seleção textual final:

- `mobile/`: código Expo/React Native, configurações textuais e testes;
- `swi-admin/`: código Vite/React, configurações textuais e testes;
- `swi-backend/`: código NestJS, Prisma schema, migrations, configurações textuais e testes;
- lockfiles e manifests necessários para identificar dependências;
- SVGs e outros assets que sejam genuinamente textuais;
- metadados mínimos da entrega e referência externa do design system.

Não entram no payload final:

- histórico Git, mensagens de commit, diffs, branches, pull requests ou conteúdo de `.git`;
- documentação funcional ou interna do projeto;
- backend Amplify legado;
- capturas, auditorias e artefatos locais de QA;
- `.env` reais, credenciais, chaves, tokens e certificados;
- `node_modules`, builds, caches e arquivos temporários;
- PNG, JPG, MP4, fontes, GLB, TGZ e demais binários;
- código-fonte ou pacotes do design system.

## Decisões confirmadas

1. A entrega será exclusivamente textual, mas poderá conter múltiplos arquivos e diretórios.
2. Cada arquivo textual original terá correspondência 1:1, acrescentando `.txt` ao nome entregue.
3. O pacote seguirá a estrutura BagIt 1.0, com manifestos SHA-256.
4. O snapshot incluirá apenas a identificação do commit final, sem histórico Git.
5. Assets binários funcionais serão inventariados com caminho, tipo, tamanho, SHA-256 e motivo da exclusão; não serão convertidos para Base64.
6. O design system será apenas referenciado como dependência externa, incluindo as versões utilizadas por mobile e admin.
7. Admin e mobile usarão o backend real como padrão de produção. Mocks e simuladores existirão apenas sob configuração explícita de desenvolvimento ou teste.
8. Nenhuma alteração será mesclada em `main` ou enviada ao remoto sem autorização expressa.

## Isolamento e reversibilidade

Todo o trabalho será realizado em:

`C:\Users\Gabriel\.config\superpowers\worktrees\SWI-mobile\source-delivery`

A worktree usa a branch `chore/repo-source-delivery`, iniciada no commit `42141fa`. O checkout original permanece em `main` e limpo. Mudanças serão separadas em commits convencionais, pequenos e orientados por domínio. A reversão poderá ocorrer por commit, por fase ou pelo descarte integral da branch isolada.

## Baseline observado

### Mobile

- instalação limpa concluída;
- 72 suítes e 350 testes aprovados;
- export web concluído com 80 rotas estáticas;
- typecheck falha com oito problemas preexistentes: diretivas `@ts-expect-error` sem uso, tupla incompatível, tipos de expressão MapLibre, ausência de tipos para `three` e resolução de CSS do MapLibre;
- há aviso de configuração npm `node-linker` e dependências descontinuadas.

### Admin

- instalação limpa concluída;
- typecheck, testes e build aprovados;
- lint sem erros, mas com cinco avisos de dependências de hook em `useRescueRoute.ts`;
- testes emitem avisos de atualizações React fora de `act(...)`;
- build alerta para chunks acima de 500 kB;
- a configuração atual ainda mantém caminhos mock/demo que precisam ser isolados do comportamento de produção.

### Backend

- instalação limpa e geração do Prisma Client concluídas;
- build aprovado;
- 43 suítes e 440 testes aprovados;
- logs de teste exercitam simuladores e fallbacks esperados;
- não há scripts padronizados de lint, typecheck isolado ou coverage;
- o template de ambiente não cobre todo o contrato consumido pelo runtime;
- dependências instaladas emitiram avisos de pacotes descontinuados.

## Estratégia de higienização

### Portão 1 — Baseline e ferramentas

- preservar a evidência do baseline;
- padronizar scripts de lint, typecheck, testes, coverage e build por projeto;
- adicionar apenas as ferramentas estritamente necessárias;
- não iniciar com formatação massiva.

### Portão 2 — Segurança e configuração

- escanear o snapshot por segredos e padrões sensíveis;
- revisar `.env.example` e contratos de configuração;
- validar JWT, autorização, CORS, rate limiting, uploads, presigned URLs e mensagens de erro;
- executar auditoria de dependências e classificar achados por severidade e explorabilidade;
- impedir logs com segredos ou dados pessoais.

### Portão 3 — Verdade de produção

- tornar API real o padrão de produção em mobile e admin;
- confinar mocks, seeds, clima simulado e posições simuladas a ambientes explícitos de desenvolvimento/teste;
- remover referências Amplify que não façam parte da aplicação atual;
- fazer o processo falhar cedo quando uma configuração obrigatória estiver ausente;
- preservar o design system como dependência externa, sem substitutos locais.

### Portão 4 — Qualidade e refatoração

- corrigir os erros TypeScript do mobile;
- resolver warnings de hooks e testes assíncronos no admin;
- introduzir lint e typecheck padronizados no backend;
- resolver ou remover código morto, imports não usados, logs, TODOs, hacks e supressões sem justificativa;
- reduzir `any`, `@ts-*` e desativações de lint;
- dividir arquivos excessivamente grandes somente sob testes de caracterização;
- padronizar validação, tratamento de erro e retornos;
- manter atualizações imutáveis e funções focadas.

### Portão 5 — Verificação

- lint e typecheck sem erros nos três projetos;
- testes unitários, integração e E2E dos fluxos críticos aprovados;
- cobertura mínima de 80% por projeto, com relatório verificável;
- builds limpos após instalação do zero;
- auditoria de dependências revisada;
- revisão de segurança e revisão do diff completo;
- checkout original ainda limpo;
- nenhum segredo ou material fora de escopo na seleção de exportação.

## Testes e tratamento de falhas

Mudanças de comportamento seguirão teste primeiro: teste falha, implementação mínima, teste passa e refatoração. Refatorações estruturais começarão por testes de caracterização. Falhas preexistentes serão registradas e corrigidas separadamente de mudanças de produção. Se uma fase quebrar um gate anteriormente verde, ela não será integrada ao próximo checkpoint.

Os fluxos críticos cobrirão, no mínimo, autenticação e autorização, cadastro e perfil, relatórios, tarefas/jornada, chat, uploads, notificações, posições, clima e evacuação. Backend terá E2E HTTP; admin terá fluxo de navegador contra API; mobile terá integração e smoke web/nativo conforme suporte reproduzível do ambiente.

## Formato da entrega

```text
SWI-source-delivery-<versao>/
├── bagit.txt
├── bag-info.txt
├── manifest-sha256.txt
├── tagmanifest-sha256.txt
├── git-metadata.txt
├── file-map.tsv.txt
├── external-dependencies.txt
├── scope-exclusions.txt
└── data/
    ├── mobile/
    ├── swi-admin/
    └── swi-backend/
```

Todos os payloads serão UTF-8 sem BOM e usarão LF. Os caminhos serão relativos, usarão `/` no manifesto e serão validados contra caminhos absolutos ou traversal. `file-map.tsv.txt` relacionará caminho original, caminho entregue, extensão original, tamanho, SHA-256, modo Git e blob ID. `manifest-sha256.txt` cobrirá todo payload e `tagmanifest-sha256.txt` cobrirá os arquivos de controle.

## Critérios de aceite

A entrega só poderá ser gerada quando:

1. todos os portões estiverem verdes;
2. o commit final estiver identificado e aprovado;
3. o inventário de inclusão e exclusão estiver revisado;
4. o BagIt estiver completo e todos os hashes forem validados;
5. uma reconstrução de amostra dos TXT recuperar caminhos e conteúdos esperados;
6. a pasta original permanecer inalterada;
7. houver autorização explícita para entregar os arquivos ao cliente.
