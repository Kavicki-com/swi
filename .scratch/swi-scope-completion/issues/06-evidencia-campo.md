# 06: Evidência da matriz: campo, mapas e continuidade

**What to build:** as linhas da matriz que tratam de posição, mapa, clima, notificação, tempo real e operação offline ganham evidência checável no código atual, com a fronteira explícita entre o que já roda contra integração real e o que ainda é fixture. Essas são as linhas onde "parcialmente implementado" costuma esconder a maior parte do trabalho restante.

**Blocked by:** 03

**Status:** resolved

Linhas da matriz cobertas por este ticket:

1. Mapa admin: posições em tempo real
2. Timeline climática
3. Alertas meteorológicos e suporte
4. GPS mobile em segundo plano
5. Notificações web/mobile
6. Real-time Engine
7. Funcionamento offline
8. Geolocalização global

- [x] Cada uma das oito linhas tem ao menos uma evidência do tipo rota, endpoint, teste ou estado observado, com caminho verificável
- [x] Para cada linha, está registrado se a fonte de dados é real, sintética ou constante embutida no código
- [x] A afirmação do plano de que não existe outbox durável foi confirmada ou refutada procurando no mobile
- [x] Constantes geográficas do piloto, se existirem no caminho de produção, estão localizadas e registradas
- [x] Nenhuma linha é marcada como implementada com base apenas em citação de plano histórico

## Answer

Evidência no grupo B de `baseline/03-matriz-congelada.md`.

**Offline: confirmado integralmente.** Busca por `outbox`, `offlineQueue` e `persistQueue` em `mobile/services` e `mobile/app` devolve zero ocorrências. Não há fila durável, cache de último estado nem política de conflito. No servidor, nenhum modelo de chave idempotente e nenhum campo de versão. A U08 constrói do zero.

**GPS de background: confirmado, e pior do que "não implementado".** `LocationProvider.tsx:23` só pede permissão de primeiro plano e a linha 36 usa `watchPositionAsync`. `startLocationUpdatesAsync`, `TaskManager` e `requestBackgroundPermissionsAsync` não aparecem em lugar nenhum, e `expo-task-manager` **não está declarado** no `package.json`. A U07 começa instalando dependência e mexendo em configuração nativa.

**Push nativo: `expo-notifications` também não está declarado.** Mesma situação para a U10.

**Constantes geográficas: encontradas.** `swi-admin/src/services/cameras.ts:12` declara `CAMERA_LOCATIONS` como constante de módulo, consumida por `pages/maps/hooks/useMapsGeneral.ts:134-135`. Não há modelo `Camera` nem endpoint.

**Divergência não prevista pelo plano, e que muda a U06:** `swi-backend/src/weather/weather.service.ts:25` injeta a classe concreta, `constructor(private readonly provider: OpenMeteoProvider)`. Não existe token de interface, então o provedor meteorológico **não é configurável hoje**, ao contrário do que a premissa da seção 3 do plano afirma. Trocar o provedor é trabalho de refatoração, não de configuração.

**Ressalva de cobertura:** `swi-admin/src/services/evacuations/evacuationsSocket.ts` está a 0% de cobertura, apesar de o Real-time Engine estar classificado como executável agora.

## Comments

Atenção ao risco de sequência número 10 do plano: documentos antigos citam Amplify/DynamoDB, arquitetura já superada. Evidência vinda desses documentos não vale; só vale código e teste no commit-base.
