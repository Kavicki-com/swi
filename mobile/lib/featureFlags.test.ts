const ENV_KEY = 'EXPO_PUBLIC_DATA_BACKEND';

function loadFeatureFlags(envValue?: string) {
  jest.resetModules();
  if (envValue === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envValue;
  return require('./featureFlags') as typeof import('./featureFlags');
}

describe('DATA_BACKEND', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
    jest.resetModules();
  });

  it('default é mock quando o env não está setado', () => {
    expect(loadFeatureFlags(undefined).DATA_BACKEND).toBe('mock');
  });

  it('lê api do EXPO_PUBLIC_DATA_BACKEND', () => {
    expect(loadFeatureFlags('api').DATA_BACKEND).toBe('api');
  });
});
