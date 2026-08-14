# Higiene do código-fonte executável

## Objetivo

Preparar o código que será entregue ao cliente para leitura e execução, removendo
anotações internas de processo sem alterar comportamento, contratos públicos,
layout, dados de demonstração ou ativos de imagem.

## Escopo

Entram nesta limpeza:

- `mobile/`;
- `swi-admin/`;
- `swi-backend/`;
- `scripts/`;
- `.github/workflows/`;
- launchers e configurações executáveis da raiz.

Ficam fora desta etapa:

- imagens e seus metadados;
- histórico Git;
- documentação de planejamento e auditorias antigas;
- alterações funcionais ou visuais.

## Regras de limpeza

Comentários que registram processo serão removidos ou reescritos. Isso inclui
referências a ferramentas internas, ciclos de QA, datas de correções, números ou
coordenadas de arquivos de design, relatos de defeitos anteriores, fases de
implementação e marcadores de trabalho pendente.

Comentários técnicos permanecem quando explicam uma restrição vigente que o
código sozinho não deixa evidente, como ordem de rotas, isolamento por empresa,
compatibilidade de plataforma, segurança, limites de upload e semântica de datas.
Esses comentários serão redigidos no presente e sem narrativa histórica.

Um marcador de trabalho pendente só pode ser eliminado quando já estiver
resolvido ou quando apenas documentar uma escolha atual. Limitações funcionais
reais não serão escondidas: devem ser resolvidas no código ou reportadas como
pendência separada.

## Prevenção de regressão

Um verificador automatizado examinará comentários e arquivos textuais do escopo.
O verificador bloqueará identificadores de ferramentas internas, marcadores de
pendência, referências de QA, referências de design, datas de manutenção e
expressões inequívocas de relato histórico.

O parser deverá distinguir comentários de valores executáveis para não rejeitar
datas usadas por testes, textos de interface ou identificadores legítimos.

## Verificação

A mudança será aceita somente após:

1. testes unitários do verificador de higiene;
2. varredura limpa de todo o escopo executável;
3. lint, typecheck e testes dos três projetos;
4. builds do aplicativo, painel e backend;
5. revisão do diff confirmando ausência de mudanças funcionais e de arquivos de
   imagem.

