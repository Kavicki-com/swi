import { getApiUrl, resolveApiUrl } from './apiConfig';
import type { RuntimeEnv } from '../../lib/featureFlags';

const URL_KEY = 'EXPO_PUBLIC_API_URL';

const PROD: RuntimeEnv = { isDev: false, isTest: false, allowDemoMocks: false };
const DEV: RuntimeEnv = { isDev: true, isTest: false, allowDemoMocks: false };
const TEST: RuntimeEnv = { isDev: false, isTest: true, allowDemoMocks: false };

describe('resolveApiUrl', () => {
  it('exige EXPO_PUBLIC_API_URL fora de dev e teste', () => {
    expect(() => resolveApiUrl(undefined, PROD)).toThrow(new RegExp(URL_KEY));
  });

  it('trata string em branco como ausência de valor', () => {
    expect(() => resolveApiUrl('   ', PROD)).toThrow(new RegExp(URL_KEY));
  });

  it('cai em localhost em dev', () => {
    expect(resolveApiUrl(undefined, DEV)).toBe('http://localhost:3000');
  });

  it('cai em localhost em teste', () => {
    expect(resolveApiUrl(undefined, TEST)).toBe('http://localhost:3000');
  });

  it('honra localhost explícito em dev', () => {
    expect(resolveApiUrl('http://localhost:3000', DEV)).toBe(
      'http://localhost:3000',
    );
  });

  it('recusa localhost fora de dev e teste', () => {
    expect(() => resolveApiUrl('http://localhost:3000', PROD)).toThrow(
      /localhost/,
    );
  });

  it('recusa endereço de loopback ou de emulador fora de dev e teste', () => {
    expect(() => resolveApiUrl('http://127.0.0.1:3000', PROD)).toThrow(
      /localhost/,
    );
    expect(() => resolveApiUrl('http://10.0.2.2:3000', PROD)).toThrow(
      /localhost/,
    );
    // URL.hostname devolve IPv6 com colchetes; regressão: '::1' sem eles
    // nunca casava e o loopback IPv6 passava em release.
    expect(() => resolveApiUrl('http://[::1]:3000', PROD)).toThrow(/localhost/);
  });

  it('aceita uma URL absoluta de produção', () => {
    expect(resolveApiUrl('https://api.exemplo.test', PROD)).toBe(
      'https://api.exemplo.test',
    );
  });

  it('remove a barra final para não gerar caminho com barra dupla', () => {
    expect(resolveApiUrl('https://api.exemplo.test/', PROD)).toBe(
      'https://api.exemplo.test',
    );
  });

  it('recusa valor que não é URL http ou https', () => {
    expect(() => resolveApiUrl('api.exemplo.test', PROD)).toThrow(
      new RegExp(URL_KEY),
    );
    expect(() => resolveApiUrl('ftp://api.exemplo.test', PROD)).toThrow(
      new RegExp(URL_KEY),
    );
  });
});

describe('getApiUrl', () => {
  // A resolução é preguiçosa: importar o módulo não pode lançar, senão um
  // ambiente mal configurado derruba o bundle antes de qualquer error boundary
  // e quebra a renderização estática do `expo export`.
  it('resolve sem lançar sob NODE_ENV=test', () => {
    expect(getApiUrl()).toBe('http://localhost:3000');
  });

  it('memoiza o resultado', () => {
    expect(getApiUrl()).toBe(getApiUrl());
  });
});
