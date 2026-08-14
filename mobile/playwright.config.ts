import { hostname } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// Smoke web do app, contra backend e banco de TESTE reais (a stack de
// `scripts/e2e/run-test-stack.mjs`). O alvo de produção do app é nativo, não o
// navegador: o que este canal guarda é o que nenhum teste de componente
// alcança, ou seja, o bundle inteiro subindo, a sessão de verdade, a
// requisição de verdade e a navegação de verdade entre as rotas.
//
// Artefatos ficam DESLIGADOS por padrão. Para investigar uma falha local,
// ligue por execução:
//   npx playwright test --trace on

const PORTA = Number(process.env.E2E_MOBILE_PORT ?? 18081);
const PORTA_API = Number(process.env.E2E_API_PORT ?? 3300);

// O host da API é o NOME DA MÁQUINA, não localhost, e isso é deliberado.
//
// `resolveApiUrl` (services/auth/apiConfig.ts) recusa localhost, 127.0.0.1,
// [::1] e os aliases de emulador fora de dev e teste, porque um build de
// release apontando pra máquina de quem abriu falha em silêncio no aparelho do
// usuário. A proteção está certa e não vai ser afrouxada pra um teste passar.
//
// A saída é exportar o BUILD de verdade e alcançar a API por um nome que não
// seja local: o hostname resolve pra própria máquina em Windows, Linux e nos
// runners de CI. O navegador continua abrindo o app por localhost; quem precisa
// do nome é a URL embutida no bundle. Mesmo raciocínio do painel
// (`swi-admin/playwright.config.ts`), que é a origem deste arquivo.
const HOST_API = process.env.E2E_API_HOST ?? hostname();
const API = process.env.E2E_API_URL ?? `http://${HOST_API}:${PORTA_API}`;

export default defineConfig({
  testDir: './e2e',
  // Sem paralelismo: as suítes falam com o MESMO banco de teste, e workers
  // concorrentes criariam interferência entre elas.
  workers: 1,
  fullyParallel: false,
  // Em CI, um `test.only` esquecido esconderia o resto da suíte.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    // 360×800 é o frame mobile do Figma, que é o ground truth do projeto e a
    // referência de todo layout do app (ver os comentários de posicionamento
    // no dashboard). `hasTouch` fica no padrão: `click()` do Playwright é
    // sempre mouse, então ligar toque não mudaria o que o teste exercita e só
    // acrescentaria uma diferença a mais entre o navegador e o aparelho.
    viewport: { width: 360, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Dois servidores. A API sobe como PROCESSO, não como container: o serviço
  // `api` do compose builda a imagem inteira, o que levaria minutos a cada
  // execução, e o que o teste precisa do backend é só o processo escutando na
  // porta. Banco, SMTP e storage continuam vindo dos containers, que é onde
  // container faz diferença.
  webServer: [
    {
      command: 'npm run build && npm run start:prod',
      cwd: '../swi-backend',
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(PORTA_API),
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://swi:swi@localhost:55432/swi',
        // Segredo descartável, gerado pra esta stack e sem valor fora dela.
        JWT_SECRET: process.env.E2E_JWT_SECRET ?? 'e2e-secret-nao-usar-fora-do-teste-0123456789',
        CORS_ORIGINS: `http://localhost:${PORTA}`,
        // `ADMIN_APP_URL` não entra aqui de propósito, ao contrário do config
        // do painel: ela é a URL do PAINEL, usada em link de e-mail, e apontá-la
        // para a porta do app seria falso. É opcional no backend e nada no
        // ciclo do mobile a consome.
        SMTP_HOST: 'localhost',
        SMTP_PORT: '51025',
        MAIL_FROM: 'no-reply@teste.local',
        REPORT_TO_EMAIL: 'moderacao@teste.local',
        MINIO_PUBLIC_URL: 'http://localhost:59000',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin',
        MINIO_BUCKET: 'swi-media',
        MINIO_REGION: 'us-east-1',
        // Simuladores desligados: o E2E afirma o que o app faz, e um cron
        // mexendo em clima e posições no meio da suíte vira ruído.
        WEATHER_CRON: '',
        WEATHER_SCENARIO: '',
        SIM_POSITIONS: '',
      },
    },
    {
      // `expo export` + `expo serve` servem o BUILD, não o dev server do Metro:
      // é o bundle com `__DEV__` desligado, que é o que roda no aparelho do
      // usuário, e é nele que o smoke precisa passar.
      //
      // A saída vai pro `dist` de sempre, e não pra um diretório próprio, por
      // dois motivos concretos: `dist/` já está no .gitignore e no `ignores` do
      // ESLint, então um diretório novo entraria no `eslint .` carregando o
      // bundle inteiro. E o `export` apaga o destino antes de escrever, então a
      // execução nunca mistura saída de duas rodadas.
      //
      // `--clear` não é zelo, e tirar ele quebra a suíte de um jeito difícil de
      // ler. As `EXPO_PUBLIC_*` daqui de baixo são inlineadas pelo Babel em
      // tempo de TRANSFORMAÇÃO, e o cache do Metro não as considera parte da
      // chave: um `expo export` anterior sem elas (o `build:all` do `verify`,
      // por exemplo) deixa `services/auth/apiConfig.ts` cacheado com
      // `process.env.EXPO_PUBLIC_API_URL` já reduzido a `undefined`, e o export
      // seguinte reusa esse módulo mesmo com a variável presente no ambiente.
      //
      // O sintoma, quando isso acontece, foi medido: `getApiUrl()` lança
      // "EXPO_PUBLIC_API_URL é obrigatória", o `catch` do login manda a
      // mensagem pro `Alert.alert` (vazio no react-native-web) e nenhuma
      // requisição sai, então os testes de login morrem em `waitForResponse`
      // sem nada no console. O teste do bundle continua verde o tempo todo, o
      // que torna o diagnóstico pior ainda.
      command: `npx expo export --platform web --output-dir dist --clear && npx expo serve dist --port ${PORTA}`,
      url: `http://localhost:${PORTA}`,
      // Cuidado ao iterar localmente: com um `expo serve` já de pé nesta porta,
      // o Playwright reusa o servidor e NÃO reexporta, então uma mudança no app
      // não entra no bundle e a suíte passa medindo o código antigo. Derrube o
      // servidor para forçar o export. Em CI a bandeira é falsa e o export
      // sempre acontece.
      reuseExistingServer: !process.env.CI,
      // Bundlar o app inteiro pra web é mais lento que um build de site: são
      // ~50 rotas pré-renderizadas, o design system e as dependências nativas
      // com shim de web.
      timeout: 900_000,
      env: {
        EXPO_PUBLIC_API_URL: API,
        // O smoke existe pra exercitar o backend de verdade. Com os mocks o
        // login passaria sem nenhuma requisição sair da máquina, e o teste
        // afirmaria uma coisa que não aconteceu.
        EXPO_PUBLIC_AUTH_BACKEND: 'api',
        EXPO_PUBLIC_DATA_BACKEND: 'api',
      },
    },
  ],
});
