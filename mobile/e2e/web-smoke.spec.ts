import { expect, test, type Page } from '@playwright/test';

// Smoke do app rodando no navegador, contra backend e banco de TESTE reais.
//
// O que este arquivo cobre é o que as 99 suítes de componente não alcançam: o
// bundle de produção inteiro subindo sem quebrar, os guards de rota e a ida
// real à API. Não há verificação de pixel: fidelidade visual é assunto do
// Figma, e afirmar layout pelo navegador seria afirmar sobre uma plataforma
// que não é a que o usuário recebe.
//
// FRONTEIRA DE PLATAFORMA, medida nesta sessão e não presumida: o app NÃO
// passa do login no navegador, e a causa não é o teste. O `expo-secure-store`
// não tem implementação web: `node_modules/expo-secure-store/build/
// ExpoSecureStore.web.js` é `export default {}`. Então o
// `SecureStore.setItemAsync` que guarda o token depois do POST bem-sucedido
// chama um método inexistente e estoura. O `catch` do login manda a mensagem
// pro `Alert.alert`, que no react-native-web é um método vazio, e a falha some
// sem rastro nenhum: nem console, nem tela.
//
// Consequência: tudo atrás do login (dashboard, jornada, relatórios, chat,
// configurações) é inalcançável AQUI, e nenhum truque de teste mudaria isso
// sem escrever um adaptador web de armazenamento no app. Quem cobre essa
// fatia é `services/auth/apiAuthBackend.test.ts` (o adaptador) mais o smoke
// manual em aparelho registrado antes da entrega, como o plano prevê na Task
// 14, Step 4. Fingir a automação seria pior que não tê-la.
//
// As credenciais vêm do seed de E2E (scripts/e2e/seed-e2e.mjs), que existe só
// nesta stack descartável. Nenhum dado real de cliente entra aqui.

const WORKER = { email: 'worker-e2e@teste.local', password: 'e2e-worker-pass' };

const preencherLogin = async (page: Page, credenciais = WORKER) => {
  await page.goto('/login');
  // O `Input` do design system não associa o rótulo ao campo (ver
  // node_modules/@kavicki/swi-design-system/src/components/Input/Input.tsx: o
  // label é um Text irmão, sem `htmlFor`), então o placeholder é o seletor
  // honesto aqui. Trocar por getByLabel exigiria mexer no DS, não no teste.
  await page.getByPlaceholder('seu@email.com').fill(credenciais.email);
  await page.getByPlaceholder('*********').fill(credenciais.password);
};

const clicarEntrar = (page: Page) => page.getByRole('button', { name: 'Entrar' }).click();

/**
 * Espera a resposta do login.
 *
 * O método entra no filtro porque o navegador dispara um preflight CORS antes
 * do POST (o corpo é `application/json`, então a requisição não é simples), e
 * casar com o `OPTIONS` faria o teste conferir o status errado.
 */
const respostaDoLogin = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );

test('a raiz manda pro login quem não tem sessão', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('rota autenticada aberta por deep link cai no login', async ({ page }) => {
  // Cold start em `/dashboard` é o caminho de um push notification ou de um
  // link colado. O gate de `(app)/_layout.tsx` é o que impede a tela de abrir
  // sem sessão, e ele só é exercitado por uma entrada direta como esta.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('o bundle sobe sem erro de página nem erro de console', async ({ page }) => {
  // Este é o teste que justifica exportar o build de produção: um erro de
  // avaliação do bundle (import quebrado, shim de módulo nativo faltando,
  // asset ausente) não aparece em teste de componente nenhum, porque lá cada
  // módulo é carregado sozinho e com mock.
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(`console: ${msg.text()}`);
  });

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(erros, erros.join(' | ')).toEqual([]);
});

test('o login envia as credenciais pra API real e é aceito', async ({ page }) => {
  await preencherLogin(page);

  // A resposta é a prova: o bundle resolveu a URL da API, atravessou o CORS e
  // o backend validou o hash do seed. Nada disso é simulado.
  const [resposta] = await Promise.all([respostaDoLogin(page), clicarEntrar(page)]);

  expect(resposta.status()).toBe(200);
  const corpo = await resposta.json();
  expect(corpo.accessToken, 'a resposta do login veio sem accessToken').toBeTruthy();
  expect(corpo.user?.email).toBe(WORKER.email);
});

test('senha errada é recusada pela API e não cria sessão', async ({ page }) => {
  await preencherLogin(page, { ...WORKER, password: 'senha-que-nao-e-a-dele' });

  const [resposta] = await Promise.all([respostaDoLogin(page), clicarEntrar(page)]);

  expect(resposta.status()).toBe(401);
  await expect(page).toHaveURL(/\/login/);

  // O guard é prova mais forte que a tela: sem sessão, tentar a rota protegida
  // volta pro login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('o caminho de entrada não tem resposta 5xx', async ({ page }) => {
  const falhas: string[] = [];
  page.on('response', (res) => {
    // 401 é resposta legítima aqui; o que não pode é o servidor quebrar.
    if (res.status() >= 500) falhas.push(`${res.status()} ${res.url()}`);
  });

  await preencherLogin(page);
  await Promise.all([respostaDoLogin(page), clicarEntrar(page)]);
  await page.waitForLoadState('networkidle');

  expect(falhas, `respostas 5xx: ${falhas.join(', ')}`).toEqual([]);
});
