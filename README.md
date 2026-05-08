# SWI Admin

Web admin para o SWI (monitoramento de funcionários em campo). Front-first MVP — ver `docs/plans/2026-05-08-swi-admin-pipeline-design.md`.

## Status

- **S0 — scaffold:** completo (`v0.0.1-scaffold`)
- **CI:** GitHub Actions em `.github/workflows/ci.yml` (typecheck, lint, test, build, storybook:build)
- **Vercel preview:** _a configurar via `npx vercel link` em `swi-admin/`_

## Local dev

```bash
cd swi-admin
npm install
npm run dev          # http://localhost:5173
npm run storybook    # http://localhost:6007
npm test             # vitest
npm run typecheck
npm run lint
npm run build        # produz dist/
```

## Stack

- Vite 5 + React 18 + react-native-web + styled-components 6
- Design System: `@kavicki/swi-design-system` pinned via tarball HTTPS de tag (`v0.1.0`)
- Roteamento: react-router 6 (32 rotas placeholder cobrindo telas S1–S5)
- Estado: zustand (planejado para S1+)
- Camada de dados: `src/services/mockApi/*` com contratos Supabase-shaped (`{ data, error, count? }`)
- Testes: Vitest + jsdom + @testing-library/react (38 testes)
- Storybook 9 (admin) + Storybook 9 do DS hospedado em `kavicki-com.github.io/swi-design-system`
- Lint/format: ESLint 9 flat config + Prettier
- Deploy: Vercel (config em `swi-admin/vercel.json`)

## Estrutura

```
SWI/
  .github/workflows/ci.yml     CI (typecheck, lint, test, build, storybook)
  docs/plans/                  design doc + plano S0
  swi-admin/
    src/
      app/                     router, App, Placeholder + stories
      services/mockApi/        contratos Supabase-shaped (auth.signIn, sleep, types)
      services/types/          User, Employee, Alert, AlertState, ...
      hooks/                   useAuth (AuthProvider/useAuth)
      stubs/                   shims para Vite (rn-svg Fabric, codegenNativeComponent)
    types/                     ambient declarations (DS shim, react-native shim)
    .storybook/                config + theme decorator
    vite.config.ts             alias array com paths absolutos
    vitest.config.ts           merge de vite.config + jsdom
    tsconfig.json              strict, paths para @/, react-native, DS shim
    package.json               DS pinned via HTTPS tarball, .npmrc legacy-peer-deps=true
```

## O que S0 entregou

- 32 rotas placeholder navegáveis (cobrem S1–S5 do design doc)
- Walking skeleton: `npm run dev` boota limpo e roteia
- `npm run build` produz bundle de produção (~262 kB JS gzipped)
- Storybook do admin com 1 smoke story (escala para stories de páginas em S1+)
- 38 testes verdes (auth flow, mockApi, useAuth, todas as 32 rotas, smoke)
- CI verde no GitHub Actions
- Conventional Commits ao longo do histórico

## Workarounds aplicados (DS source-only)

O DS publica TypeScript cru (`main: src/index.ts`, sem `dist/`). Para evitar refactor downstream:

- `swi-admin/types/swi-design-system-shim.d.ts` declara o módulo como `any` para typecheck
- `tsconfig.json` `paths` redireciona `@kavicki/swi-design-system` para o shim
- `react-native` instalado como npm alias para `react-native-web`
- `react-native-svg` Fabric components (`/lib/module/fabric/`) aliased para stub (Vite + esbuild bypass)
- `optimizeDeps.exclude: ['react-native-svg']` para o esbuild não pré-bundlar
- `swi-admin/.npmrc` codifica `legacy-peer-deps=true` (RN ecosystem peer noise)

Esses workarounds devem ser removidos quando o DS publicar `dist/` + types em release futura.

## Próximos passos (S1)

S1 = auth real + dashboard. 5 telas: `login`, `sign-up`, `password-recovery-email`, `password-recovery-newpassword`, `dashboard`. Implementação substitui `<Placeholder label="login" />` por `<LoginPage />` etc., consumindo `mockApi.auth.signIn` que já existe.

Plano detalhado de S1 será gerado quando S0 fechar com `v0.0.1-scaffold` tag pushada.
