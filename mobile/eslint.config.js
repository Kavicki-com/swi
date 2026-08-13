// Flat config do ESLint 9. Parte do preset oficial do Expo, que já traz as
// regras de React, hooks e resolução de imports afinadas para React Native.
//
// O portão roda com `--max-warnings=0`. Por isso, nenhum bloco abaixo desliga
// regra para esconder problema: cada um declara em que ambiente o arquivo
// roda, algo que o preset sozinho não tem como saber. Regra desligada fora do
// seu ambiente vira ruído, e ruído tolerado é o que mata um gate com o tempo.
const expoConfig = require('eslint-config-expo/flat');

// O plugin já vem carregado pelo preset. Reaproveitamos a mesma instância
// porque, no flat config, um bloco que ajusta uma regra do plugin precisa
// declará-lo no próprio bloco.
const tsPlugin = expoConfig.find((entry) => entry.plugins?.['@typescript-eslint'])?.plugins?.[
  '@typescript-eslint'
];

const jestGlobals = {
  jest: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
};

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'vendor/**',
      // Gerado pelo Expo Router a partir da árvore de rotas.
      'expo-env.d.ts',
    ],
  },
  {
    // `require()` de asset é o mecanismo do Metro, não uma preferência de
    // estilo: `Asset.fromModule` precisa do id numérico que só o `require()`
    // literal produz, e um `import` de .png/.glb não gera esse id. A regra
    // segue valendo para módulos; só os assets ficam liberados.
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-require-imports': [
        'warn',
        { allow: ['\\.(png|jpe?g|gif|svg|glb|gltf|ttf|otf|woff2?|mp4|json)$'] },
      ],
    },
  },
  {
    // Testes e setup do Jest.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', 'jest.setup.js'],
    languageOptions: { globals: jestGlobals },
    rules: {
      // `jest.resetModules()` seguido de `require()` é a única forma de
      // reavaliar um módulo que lê env no topo. Um `import` estático é içado
      // e leria o env antigo, justamente o que estes testes verificam.
      '@typescript-eslint/no-require-imports': 'off',
      // A regra existe porque o Babel do Expo inlineia `process.env.EXPO_*`
      // no build. Aqui o acesso dinâmico é o objeto do teste: mutar o env em
      // tempo de execução para exercitar o resolvedor.
      'expo/no-dynamic-env-var': 'off',
    },
  },
  {
    // Arquivos de configuração da toolchain são CommonJS por exigência de
    // quem os carrega (Metro, Babel, Jest, o próprio ESLint). Não há `import`
    // possível aqui.
    files: ['*.config.js', 'jest.setup.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Scripts de build/manutenção rodam no Node, fora do bundle do app.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
  {
    // Elementos do react-three-fiber (`<primitive>`, `<ambientLight>`, …) não
    // são DOM: `object`, `position` e `intensity` são props válidas da cena
    // three.js. A regra só conhece o catálogo HTML e acusa falso positivo.
    files: ['components/Smartwatch3D.native.tsx', 'components/Smartwatch3D.web.tsx'],
    rules: { 'react/no-unknown-property': 'off' },
  },
  {
    // O corpo vazio é obrigatório: é assim que se faz declaration merging do
    // namespace JSX do React 19 com os intrinsics do @react-three/fiber.
    files: ['components/three-jsx.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
];
