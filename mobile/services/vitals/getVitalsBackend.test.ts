// SAÚDE: getVitalsBackend fica pinado em mock ATÉ A SMARTBAND EXISTIR e ignora
// DATA_BACKEND de propósito (carve-out da rodada não-saúde). O loadWith cobre
// os dois valores da flag pra provar o pinning (mesmo shape do
// getAuthBackend.test). VITALS_SCENARIO entra no factory porque
// mockVitalsBackend lê essa flag.
import type { RuntimeEnv } from '../../lib/featureFlags';

const PROD: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };

function loadWith(dataBackend: 'mock' | 'api', runtimeEnv?: RuntimeEnv) {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend,
    VITALS_SCENARIO: 'streaming',
    ...(runtimeEnv ? { RUNTIME_ENV: runtimeEnv } : {}),
  }));
  const { getVitalsBackend } = require('./getVitalsBackend');
  const { mockVitalsBackend } = require('./mockVitalsBackend');
  return { getVitalsBackend, mockVitalsBackend };
}

it('retorna mock com a flag em mock', () => {
  const { getVitalsBackend, mockVitalsBackend } = loadWith('mock');
  expect(getVitalsBackend()).toBe(mockVitalsBackend);
});

it('ignora a flag pra sempre (carve-out smartband)', () => {
  const { getVitalsBackend, mockVitalsBackend } = loadWith('api');
  expect(getVitalsBackend()).toBe(mockVitalsBackend);
});

it('mantém vitais simulados inclusive fora de dev e teste', () => {
  const { getVitalsBackend, mockVitalsBackend } = loadWith('api', PROD);
  expect(getVitalsBackend()).toBe(mockVitalsBackend);
});

// `require.resolve` em vez de `require`: importar o módulo legado falharia
// mesmo com o arquivo presente, porque a dependência nativa do provedor não
// existe no ambiente de teste, e o guard passaria por engano.
it('não deixa o arquivo do provedor legado na árvore', () => {
  expect(() => require.resolve('./amplifyVitalsBackend')).toThrow();
});
