import { resolveTrustedMediaUrl } from './trustedMediaUrl';
import type { RuntimeEnv } from '../featureFlags';

const PROD: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };
const DEV: RuntimeEnv = { isDev: true, isTest: false, allowDemoMocks: false };

const API = 'https://api.exemplo.test';
const opts = (over: Partial<Parameters<typeof resolveTrustedMediaUrl>[1]> = {}) => ({
  apiUrl: API,
  origensExtras: undefined,
  env: PROD,
  ...over,
});

// A URL do exame chega do backend, dentro do JSON da API, e vai direto para o
// navegador do aparelho. Isso a torna um dado de fora: basta um registro
// adulterado no banco, ou uma resposta forjada, para o app abrir o que mandarem.
// Antes deste helper as duas telas de exame chamavam Linking.openURL(exam.fileUrl)
// sem olhar o valor.
describe('resolveTrustedMediaUrl', () => {
  it('aceita mídia servida pela própria origem da API', () => {
    expect(resolveTrustedMediaUrl(`${API}/media/exame.pdf`, opts())).toBe(
      `${API}/media/exame.pdf`,
    );
  });

  it('aceita origem declarada em EXPO_PUBLIC_MEDIA_ORIGINS', () => {
    const url = 'https://midia.exemplo.test/exame.pdf';
    expect(
      resolveTrustedMediaUrl(url, opts({ origensExtras: 'https://midia.exemplo.test' })),
    ).toBe(url);
  });

  it('aceita qualquer uma das origens da lista, separadas por vírgula', () => {
    const url = 'https://cdn2.exemplo.test/a.pdf';
    expect(
      resolveTrustedMediaUrl(
        url,
        opts({ origensExtras: 'https://cdn1.exemplo.test, https://cdn2.exemplo.test' }),
      ),
    ).toBe(url);
  });

  // O ataque que a comparação por origem exata mata: sufixo que "contém" o
  // domínio confiável. Uma verificação por endsWith ou includes deixaria passar.
  it('recusa subdomínio enganoso que só parece pertencer à API', () => {
    expect(() =>
      resolveTrustedMediaUrl('https://api.exemplo.test.invasor.test/exame.pdf', opts()),
    ).toThrow(/origem/i);
  });

  it('recusa origem simplesmente não autorizada', () => {
    expect(() => resolveTrustedMediaUrl('https://invasor.test/exame.pdf', opts())).toThrow(
      /origem/i,
    );
  });

  // javascript: executa no contexto de quem abrir; file: alcança o
  // armazenamento do próprio aplicativo. Nenhum dos dois tem origem que bata
  // com a lista, mas a mensagem precisa ser clara, e a rejeição é o ponto.
  it('recusa esquema javascript', () => {
    expect(() => resolveTrustedMediaUrl('javascript:alert(1)', opts())).toThrow();
  });

  it('recusa esquema file', () => {
    expect(() => resolveTrustedMediaUrl('file:///etc/passwd', opts())).toThrow();
  });

  it('recusa http em release mesmo com host autorizado', () => {
    expect(() =>
      resolveTrustedMediaUrl('http://midia.exemplo.test/e.pdf', opts({ origensExtras: 'http://midia.exemplo.test' })),
    ).toThrow(/https/i);
  });

  // Credencial embutida na URL vaza no histórico e em qualquer log, e ainda
  // permite disfarçar o host de verdade: em "https://api.exemplo.test@invasor.test"
  // o host é invasor.test, e o olho lê api.exemplo.test.
  it('recusa URL com usuário ou senha embutidos', () => {
    expect(() =>
      resolveTrustedMediaUrl(`https://usuario:senha@midia.exemplo.test/e.pdf`, opts({ origensExtras: 'https://midia.exemplo.test' })),
    ).toThrow(/credenc/i);
  });

  it('recusa valor vazio ou que não é URL', () => {
    expect(() => resolveTrustedMediaUrl('', opts())).toThrow();
    expect(() => resolveTrustedMediaUrl('/apenas/um/caminho', opts())).toThrow();
  });

  // Em desenvolvimento a stack local serve mídia por http, do MinIO, e sem esta
  // ressalva a tela de exames pararia de abrir na máquina de quem desenvolve.
  it('aceita http em desenvolvimento, onde o MinIO local não tem certificado', () => {
    const url = 'http://localhost:59000/swi-media/e.pdf';
    expect(
      resolveTrustedMediaUrl(url, opts({ env: DEV, origensExtras: 'http://localhost:59000' })),
    ).toBe(url);
  });

  // Mesmo em dev a origem tem que estar na lista: relaxar o esquema é uma
  // conveniência, abrir qualquer endereço é outra coisa.
  it('mantém a checagem de origem em desenvolvimento', () => {
    expect(() =>
      resolveTrustedMediaUrl('http://invasor.test/e.pdf', opts({ env: DEV })),
    ).toThrow(/origem/i);
  });
});
