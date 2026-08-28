# 07: Evidência da matriz: telemetria, saúde e derivados

**What to build:** as linhas da matriz que dependem de medição corporal ficam com a fronteira honesta desenhada: onde existe apenas interface, onde existe apenas simulador, e onde não existe nada. É aqui que se impede a confusão mais cara do projeto, tratar tela alimentada por simulação como capacidade entregue.

**Blocked by:** 03

**Status:** resolved

Linhas da matriz cobertas por este ticket:

1. Dashboard admin: BPM, MPM e temperatura
2. Alertas de desgaste
3. Smartband via Bluetooth
4. Saúde individual
5. Bateria da smartband
6. Predição de fadiga

- [x] Cada uma das seis linhas tem evidência checável, inclusive quando a evidência é a ausência comprovada de implementação
- [x] Todo ponto do código que hoje alimenta tela de saúde com valor simulado está localizado, com caminho verificável
- [x] Está registrado se alguma tela de produção importa simulador direto, sem passar por seleção de provedor
- [x] Está registrado se existe qualquer código de Bluetooth ou pareamento no mobile, confirmando ou refutando a linha da matriz
- [x] Nenhuma linha desta categoria é classificada como executável agora sem fonte real de medição

## Answer

Evidência no grupo C de `baseline/03-matriz-congelada.md`. Nenhuma das seis linhas tem fonte real de medição, e nenhuma foi classificada como executável agora.

**Simulação em produção, quantificada:** `swi-admin/src/services/vitals/simulatedVitals.ts` é importado por 20 arquivos, incluindo caminhos de produção sem seleção de provedor: `services/api/dashboard.ts`, `api/monitoring.ts`, `api/positions.ts`, `api/rescue.ts`, `hooks/useMyVitals.ts`, `pages/monitoring/MonitoringLayout.tsx`, `pages/_shared/WorkerDetailsLayout.tsx`, `pages/employees/EmployeeDetails.tsx`, `pages/admins/AdminDetails.tsx`.

**A armadilha mais cara deste grupo, e a razão de o ticket existir:** o admin tem `services/production-contract.test.ts`, um guarda que quebra o `npm test` se o grafo de produção importar de `services/mockApi/`. Esse guarda **não alcança** `services/vitals/simulatedVitals.ts`, que não vive sob `mockApi/`. O projeto tem, portanto, um portão contra simulação que a simulação de saúde atravessa legitimamente. Ler o nome do teste e concluir "não há simulação em produção" seria erro direto.

**Bluetooth: refutado com dependência, não com leitura de tela.** `mobile/package.json` não declara nenhum pacote de BLE. As telas `(onboarding)/smartband/connection.tsx` e `connection-start.tsx` são interface pura: a linha 55 é o texto pedindo ao usuário que ative o bluetooth, a linha 88 é um `router.push`. Existe onboarding de conexão que não conecta nada.

**Fadiga: nenhum backend.** `fadiga`/`fatigue` só aparece em componentes de frontend do admin e em `mobile/services/vitals/simulatedContactFatigue.ts`. Sem módulo, sem modelo, sem versão de algoritmo, sem auditoria de entradas.

**Achado transversal que muda a U11:** `mobile/services/telemetry/types.ts` já define um contrato de telemetria, e ele carrega `expiresAt`, documentado em `useTelemetrySampler.ts:8` como "epoch SECONDS (DynamoDB TTL contract)". É resíduo de uma arquitetura que o projeto abandonou. A U11 não parte do zero: parte de um contrato contaminado, e limpá-lo é parte do trabalho.

## Comments

O plano proíbe apresentar temperatura da pele como temperatura corporal (premissa da seção 3). Se o código atual fizer essa fusão, registrar como divergência, não corrigir aqui.

Referência de contrato: `docs/adr/0001-telemetria-agnostica-com-provedor-sintetico.md`. Confrontar o ADR com o código; ADR é decisão, não prova de implementação.
