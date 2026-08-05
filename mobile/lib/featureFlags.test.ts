import {
  resolveAuthBackend,
  resolveDataBackend,
  type RuntimeEnv,
} from './featureFlags';

const DATA_KEY = 'EXPO_PUBLIC_DATA_BACKEND';
const AUTH_KEY = 'EXPO_PUBLIC_AUTH_BACKEND';

const PROD: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };
const DEV: RuntimeEnv = { isDev: true, isTest: false, allowDemoMocks: false };
const TEST: RuntimeEnv = { isDev: false, isTest: true, allowDemoMocks: false };

function loadFeatureFlags(env: Partial<Record<string, string | undefined>>) {
  jest.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return require('./featureFlags') as typeof import('./featureFlags');
}

describe('resolveDataBackend', () => {
  it('usa a API real quando o env não está setado fora de dev e teste', () => {
    expect(resolveDataBackend(undefined, PROD)).toBe('api');
  });

  it('ignora mock fora de dev e teste', () => {
    expect(resolveDataBackend('mock', PROD)).toBe('api');
  });

  it('honra mock em dev', () => {
    expect(resolveDataBackend('mock', DEV)).toBe('mock');
  });

  it('honra mock em teste', () => {
    expect(resolveDataBackend('mock', TEST)).toBe('mock');
  });

  it('honra mock fora de dev com a chave de demonstração explícita', () => {
    expect(resolveDataBackend('mock', { ...PROD, allowDemoMocks: true })).toBe(
      'mock',
    );
  });

  it('mantém mock como padrão de dev para não exigir env local', () => {
    expect(resolveDataBackend(undefined, DEV)).toBe('mock');
  });

  it('honra api explicitamente em qualquer ambiente', () => {
    expect(resolveDataBackend('api', DEV)).toBe('api');
    expect(resolveDataBackend('api', PROD)).toBe('api');
  });

  it('recusa valor desconhecido em vez de fazer cast', () => {
    expect(() => resolveDataBackend('amplify', PROD)).toThrow(
      /EXPO_PUBLIC_DATA_BACKEND/,
    );
  });

  it('trata string vazia como ausência de valor', () => {
    expect(resolveDataBackend('', PROD)).toBe('api');
  });
});

describe('resolveAuthBackend', () => {
  it('usa a API real quando o env não está setado fora de dev e teste', () => {
    expect(resolveAuthBackend(undefined, PROD)).toBe('api');
  });

  it('ignora mock fora de dev e teste', () => {
    expect(resolveAuthBackend('mock', PROD)).toBe('api');
  });

  it('honra mock em dev', () => {
    expect(resolveAuthBackend('mock', DEV)).toBe('mock');
  });

  it('recusa valor desconhecido em vez de fazer cast', () => {
    expect(() => resolveAuthBackend('cognito', PROD)).toThrow(
      /EXPO_PUBLIC_AUTH_BACKEND/,
    );
  });
});

describe('DATA_BACKEND e AUTH_BACKEND no ambiente de teste', () => {
  const originalData = process.env[DATA_KEY];
  const originalAuth = process.env[AUTH_KEY];

  afterEach(() => {
    if (originalData === undefined) delete process.env[DATA_KEY];
    else process.env[DATA_KEY] = originalData;
    if (originalAuth === undefined) delete process.env[AUTH_KEY];
    else process.env[AUTH_KEY] = originalAuth;
    jest.resetModules();
  });

  it('default é mock sob NODE_ENV=test, preservando as suítes existentes', () => {
    const flags = loadFeatureFlags({
      [DATA_KEY]: undefined,
      [AUTH_KEY]: undefined,
    });
    expect(flags.DATA_BACKEND).toBe('mock');
    expect(flags.AUTH_BACKEND).toBe('mock');
  });

  it('lê api dos envs', () => {
    const flags = loadFeatureFlags({ [DATA_KEY]: 'api', [AUTH_KEY]: 'api' });
    expect(flags.DATA_BACKEND).toBe('api');
    expect(flags.AUTH_BACKEND).toBe('api');
  });
});
