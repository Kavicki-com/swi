// SAÚDE: não existe fonte de telemetria real enquanto a smartband não for
// integrada. Em dev e teste o sink acumula num log inspecionável; fora deles
// descarta explicitamente, em vez de fingir persistência. Em nenhum caso a
// flag DATA_BACKEND liga um provedor remoto.
import type { RuntimeEnv } from '../../lib/featureFlags';

const DEV: RuntimeEnv = { isDev: true, isTest: false, allowDemoMocks: false };
const TEST: RuntimeEnv = { isDev: false, isTest: true, allowDemoMocks: false };
const PROD: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };

function loadWith(dataBackend: 'mock' | 'api', runtimeEnv: RuntimeEnv) {
  jest.resetModules();
  jest.doMock('../../lib/featureFlags', () => ({
    ...jest.requireActual('../../lib/featureFlags'),
    DATA_BACKEND: dataBackend,
    RUNTIME_ENV: runtimeEnv,
  }));
  const { getTelemetrySink } = require('./getTelemetrySink');
  const { mockTelemetrySink } = require('./mockTelemetrySink');
  const { noopTelemetrySink } = require('./noopTelemetrySink');
  return { getTelemetrySink, mockTelemetrySink, noopTelemetrySink };
}

describe('getTelemetrySink', () => {
  it('usa o log inspecionável em dev', () => {
    const { getTelemetrySink, mockTelemetrySink } = loadWith('mock', DEV);
    expect(getTelemetrySink()).toBe(mockTelemetrySink);
  });

  it('usa o log inspecionável em teste', () => {
    const { getTelemetrySink, mockTelemetrySink } = loadWith('mock', TEST);
    expect(getTelemetrySink()).toBe(mockTelemetrySink);
  });

  it('descarta explicitamente fora de dev e teste, sem acumular na memória', () => {
    const { getTelemetrySink, noopTelemetrySink } = loadWith('mock', PROD);
    expect(getTelemetrySink()).toBe(noopTelemetrySink);
  });

  it('ignora DATA_BACKEND pra sempre (carve-out smartband)', () => {
    const dev = loadWith('api', DEV);
    expect(dev.getTelemetrySink()).toBe(dev.mockTelemetrySink);

    const prod = loadWith('api', PROD);
    expect(prod.getTelemetrySink()).toBe(prod.noopTelemetrySink);
  });

  // `require.resolve` em vez de `require`: importar o módulo legado falharia
  // mesmo com o arquivo presente, porque a dependência nativa do provedor não
  // existe no ambiente de teste, e o guard passaria por engano.
  it('não deixa o arquivo do provedor legado na árvore', () => {
    expect(() => require.resolve('./amplifyTelemetrySink')).toThrow();
  });
});
