# 01: Fundação do baseline e registro de ambiente

**What to build:** qualquer pessoa que pegue este repositório consegue saber exatamente de que ponto a rodada partiu e reproduzi-lo: qual commit, qual branch, qual worktree, quais versões de runtime, e quais comandos de verificação cada projeto realmente oferece hoje. Sem isso, toda medição posterior vira opinião.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Existe um registro de baseline com o SHA completo do commit-base, a branch e o caminho do worktree em uso
- [x] O registro traz versão de Node, de npm e do sistema operacional
- [x] O registro lista, por projeto, quais scripts de gate existem e quais estão ausentes, sem inventar comando que o `package.json` não tem
- [x] O registro aponta a divergência entre os comandos que o plano manda executar e os comandos que existem de fato
- [x] Nenhum arquivo de código de produto é alterado por este ticket

## Answer

Evidência em `baseline/00-ambiente.md`.

Ponto de partida: commit `c93f02103075b8c432c8e9752f5837e41f42b3f7`, branch `main`, worktree `C:/Users/Gabriel/Documents/SWI-mobile`, Node `v22.23.2`, npm `10.9.8`, Windows `10.0.19045.6466`.

Quatro divergências entre plano e realidade foram registradas. A relevante para a sequência: `swi-admin` não tem `test:coverage` nem `verify`.

Achado não previsto pelo ticket: a árvore de trabalho não está limpa no commit-base. O plano desta rodada, o ADR 0001 e `docs/agents/` estão como não versionados, e `CLAUDE.md` está modificado. Um checkout limpo de `c93f021` não reproduz a documentação de governança, só o código de produto. Herdado pelo ticket 09.

## Comments

Verificação de partida: o plano assume `npm run test:coverage` nos três projetos. Confrontar com os `package.json` antes de aceitar.
