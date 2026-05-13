# mobile

App React Native do SWI (Expo SDK 54 + expo-router). Pasta irmã de `swi-admin/` no root do repo, totalmente independente — `package.json`, `node_modules`, lockfile próprios.

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
