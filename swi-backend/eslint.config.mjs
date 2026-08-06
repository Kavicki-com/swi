// Configuração do ESLint 9 (flat config) do backend.
//
// Arquivo `.mjs` de propósito: o pacote é CommonJS (sem `"type": "module"` no
// package.json), e o helper `tseslint.config` e os presets do typescript-eslint
// são ESM. A extensão explícita evita ter que converter o pacote inteiro.
//
// Linting COM tipos (`recommendedTypeChecked`), e não só sintático: as regras
// que pegam os defeitos reais de um backend Nest dependem do type checker.
// `no-floating-promises` é o exemplo central: uma promise sem await num handler
// vira erro silencioso em produção, e nenhuma regra sintática a enxerga.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Só artefato e código gerado. O `amplify/` é a tentativa abandonada de
    // backend serverless: fica fora do tsconfig, então o linting com tipos nem
    // conseguiria resolvê-lo. A remoção dele é assunto do passo de dead code.
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'amplify/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        // Resolve o tsconfig do arquivo sob análise. O tsconfig.json da raiz não
        // declara `include`, então já cobre src, test e prisma.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Os módulos e DTOs do Nest são classes cuja carga é decorator: o corpo
    // vazio é a forma correta, não código morto.
    files: ['**/*.module.ts', '**/dto.ts', '**/dto/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // Suítes: o rigor de tipo fica no código de produção, não nos dublês.
    //
    // Medido antes de decidir: das 3016 reprovações da primeira execução, 2950
    // (98%) estavam em arquivo de teste e nasciam todas do mesmo lugar, o
    // `as any` dos mocks de Prisma e de serviço. Um `db: any` faz cada acesso
    // seguinte virar `no-unsafe-member-access`, cada chamada virar
    // `no-unsafe-call`, e assim por diante. Tipar esses dublês seria reescrever
    // centenas de pontos de suítes que já passam, sem pegar um defeito sequer:
    // a forma do mock já é verificada pelo próprio teste, que falha se ela
    // divergir do que o serviço consome.
    //
    // Desligado por configuração, num bloco só, e não por `eslint-disable`
    // espalhado nos fontes: assim a decisão é visível e reversível em um lugar.
    // O que pega defeito de verdade continua ligado aqui, em especial
    // `no-floating-promises` e `no-unused-vars`.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `async` num mock existe pra ele devolver promise, mesmo sem await
      // dentro; exigir await aqui empurraria para `Promise.resolve` sem ganho.
      '@typescript-eslint/require-await': 'off',
      // Falso positivo conhecido com Jest: `expect(service.metodo)` passa o
      // método sem ligar o `this`, que é exatamente o uso pretendido.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
)
