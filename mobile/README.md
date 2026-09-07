# mobile

App React Native do SWI (Expo SDK 54 + expo-router). Pasta irmã de `swi-admin/` no root do repo, totalmente independente — `package.json`, `node_modules`, lockfile próprios.

## Escopo atual — demo frontend-only

**O objetivo inicial deste app é ser uma demo demonstrativa que represente fielmente as telas do Figma.** Nada além disso por enquanto.

Em termos práticos:

- **Frontend apenas.** Sem integração de backend, sem chamadas reais de API, sem auth real, sem persistência remota, sem BLE de verdade no pareamento da smartband, sem push real.
- **Fidelidade visual ao Figma é o critério de pronto.** Cada tela é "feita" quando bate com o frame do Figma correspondente: layout, tokens (`useTheme()`), tipografia, ícones (SVG do Figma), spacing, estados.
- **Dados mockados / fixtures locais.** Tudo que precisar de dado dinâmico vem de mocks em memória ou JSON local, no mesmo espírito do `swi-admin/src/services/mockApi/`. Sem Supabase, sem fetch externo nesta fase.
- **Navegação real, lógica fake.** Rotas do `expo-router` funcionam de verdade (você navega entre telas), mas ações que disparariam side-effects (login, salvar, enviar mensagem) só simulam o resultado.
- **Plataforma alvo da demo:** Web (`w` no Expo) e iOS/Android via Expo Go — o suficiente pra demonstrar. Nada de build nativo customizado nesta fase.

Quando essa fase terminar (todas as telas do Figma fiéis e navegáveis), abrimos uma nova fase pra plugar backend de verdade. Até lá, **se aparecer pedido de "integrar X de verdade", pause e confirme** — provavelmente está fora do escopo atual.

## Stack

- Expo SDK 54 + expo-router (file-based routing)
- React Native 0.81 / React 19.1
- `@kavicki/swi-design-system` (mesmo DS do site, fixado por commit no `package.json`)

## Rodar

```bash
cd mobile
npm install        # ou pnpm install — ver nota abaixo
npx expo start
# então: pressione 'a' (Android), 'i' (iOS, requer macOS) ou 'w' (Web)
```

### Package manager

O `.npmrc` define `node-linker=hoisted` (default do template Expo). Compatível com npm e pnpm; o Metro não segue symlinks de pnpm sem hoist. Use o que preferir — só seja consistente dentro desta pasta.

## Estrutura

- `app/` — rotas (expo-router file-based)
  - `(auth)/` — login, sign-up, recovery, account confirmation
  - `(onboarding)/smartband/` — pareamento BLE
  - `(app)/` — área autenticada (dashboard, chat, journey, reports, settings, evacuation, map, my-stats, notifications)
  - `modals/` — modais (support form, privacy policy, weather alert, responsables)
- `assets/images/` — ícones e splash do Expo

## Regras

Esta pasta segue as regras do `CLAUDE.md` na raiz do repo, especialmente a regra do DS: **sempre usar `@kavicki/swi-design-system` como está, nunca recriar componentes localmente**. Se faltar algo no DS, propor bump.
