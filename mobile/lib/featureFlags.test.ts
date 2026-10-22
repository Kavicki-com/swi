import {
  deveMostrarAvisoWeb,
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

// Os gates são resolvidos na carga do módulo a partir de `Platform.OS` e de
// `Constants.executionEnvironment`. Cada caso recarrega o módulo isolado com
// a plataforma e o ambiente simulados.
function loadGates(
  os: 'ios' | 'android' | 'web',
  executionEnvironment: 'standalone' | 'bare' | 'storeClient',
) {
  let flags: typeof import('./featureFlags') | undefined;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { executionEnvironment },
    }));
    flags = require('./featureFlags') as typeof import('./featureFlags');
  });
  if (flags === undefined) throw new Error('featureFlags não carregou');
  return flags;
}

describe('gate healthConnect', () => {
  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('existe e fica desligado no iOS, mesmo compilado', () => {
    const flags = loadGates('ios', 'standalone');
    expect(flags.FEATURE_GATES).toHaveProperty('healthConnect');
    expect(flags.isFeatureEnabled('healthConnect')).toBe(false);
  });

  it('fica desligado no web', () => {
    const flags = loadGates('web', 'standalone');
    expect(flags.isFeatureEnabled('healthConnect')).toBe(false);
  });

  it('fica desligado no Expo Go do Android, que não carrega o módulo nativo', () => {
    const flags = loadGates('android', 'storeClient');
    expect(flags.isFeatureEnabled('healthConnect')).toBe(false);
  });

  it('liga no Android compilado pelo EAS', () => {
    const flags = loadGates('android', 'standalone');
    expect(flags.isFeatureEnabled('healthConnect')).toBe(true);
  });

  it('liga no dev client do Android', () => {
    const flags = loadGates('android', 'bare');
    expect(flags.isFeatureEnabled('healthConnect')).toBe(true);
  });
});

// Batimento ao vivo pela pulseira no Bluetooth: o módulo nativo só existe no
// Android compilado, como o do Health Connect.
describe('gate bluetoothHeartRate', () => {
  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('existe e fica desligado no iOS, mesmo compilado', () => {
    const flags = loadGates('ios', 'standalone');
    expect(flags.FEATURE_GATES).toHaveProperty('bluetoothHeartRate');
    expect(flags.isFeatureEnabled('bluetoothHeartRate')).toBe(false);
  });

  it('fica desligado no web e no Expo Go do Android', () => {
    expect(loadGates('web', 'standalone').isFeatureEnabled('bluetoothHeartRate')).toBe(false);
    expect(loadGates('android', 'storeClient').isFeatureEnabled('bluetoothHeartRate')).toBe(false);
  });

  it('liga no Android compilado e no dev client', () => {
    expect(loadGates('android', 'standalone').isFeatureEnabled('bluetoothHeartRate')).toBe(true);
    expect(loadGates('android', 'bare').isFeatureEnabled('bluetoothHeartRate')).toBe(true);
  });
});

// O produto web suportado na entrega é o painel administrativo. O Expo web é
// restrito ao desenvolvimento e não faz parte do aplicativo entregue ao usuário.
//
// O corte é só no build de release. Em dev, teste e na escotilha de
// demonstração o app web segue inteiro, senão o smoke E2E de navegador
// (mobile/e2e/web-smoke.spec.ts), que é o que valida o mobile fora do Jest,
// morreria junto.
describe('aviso de acesso pelo painel no Expo web', () => {
  const release: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };

  it('aparece no web de release', () => {
    expect(deveMostrarAvisoWeb('web', release)).toBe(true);
  });

  it('não aparece em dev, que é onde se desenvolve a tela', () => {
    expect(deveMostrarAvisoWeb('web', { ...release, isDev: true })).toBe(false);
  });

  it('não aparece sob a suíte, que é o que mantém o smoke de navegador vivo', () => {
    expect(deveMostrarAvisoWeb('web', { ...release, isTest: true })).toBe(false);
  });

  it('não aparece com a escotilha de demonstração ligada', () => {
    expect(deveMostrarAvisoWeb('web', { ...release, allowDemoMocks: true })).toBe(false);
  });

  it('nunca aparece no aplicativo nativo, que é o produto entregue', () => {
    expect(deveMostrarAvisoWeb('android', release)).toBe(false);
    expect(deveMostrarAvisoWeb('ios', release)).toBe(false);
  });
});
