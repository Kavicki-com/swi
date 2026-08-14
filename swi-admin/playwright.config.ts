import { hostname } from 'node:os'
import { defineConfig, devices } from '@playwright/test'

// E2E de navegador do painel, contra backend e banco de TESTE reais (a stack de
// `scripts/e2e/run-test-stack.mjs`). O que estes testes guardam é o fluxo ponta
// a ponta que nenhum teste de componente alcança: sessão real, requisição real,
// navegação real.
//
// Artefatos ficam DESLIGADOS por padrão (plano, Task 14): screenshot, vídeo e
// trace pesam, viram lixo no working tree e não entram na entrega. Para
// investigar uma falha local, ligue por execução:
//   npx playwright test --trace on

const PORTA = Number(process.env.E2E_ADMIN_PORT ?? 4173)
const PORTA_API = Number(process.env.E2E_API_PORT ?? 3300)

// O host da API é o NOME DA MÁQUINA, não localhost, e isso é deliberado.
//
// `resolveApiUrl` (src/services/api/apiConfig.ts) recusa API local em build de
// produção QUANDO A PÁGINA veio de origem não local, porque um painel publicado
// apontando pra máquina de quem abriu o navegador falha como se o backend
// estivesse fora do ar. Desde o pacote de duplo clique, o par
// "página local + API local" é permitido, então localhost aqui também passaria.
//
// O nome da máquina fica assim mesmo: ele é o que roda verde em Windows, Linux
// e nos runners de CI, e trocar por localhost seria mexer no que já funciona
// para não ganhar nada. O browser continua abrindo o painel por localhost; quem
// usa o nome é a URL embutida no bundle.
const HOST_API = process.env.E2E_API_HOST ?? hostname()
const API = process.env.E2E_API_URL ?? `http://${HOST_API}:${PORTA_API}`

export default defineConfig({
  testDir: './e2e',
  // Sem paralelismo: as suítes falam com o MESMO banco de teste, e workers
  // concorrentes criariam interferência entre elas (foi exatamente esse tipo de
  // estado compartilhado que fez as suítes do backend parecerem instáveis).
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
    // O painel é desktop; o Figma é ground truth em 1366 (regra do projeto).
    viewport: { width: 1366, height: 900 },
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
        ADMIN_APP_URL: `http://localhost:${PORTA}`,
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
      // `preview` serve o BUILD, não o dev server: é o artefato que o cliente
      // recebe, e é nele que o E2E precisa passar.
      command: `npm run build && npm run preview -- --port ${PORTA} --strictPort`,
      url: `http://localhost:${PORTA}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { VITE_API_URL: API },
    },
  ],
})
