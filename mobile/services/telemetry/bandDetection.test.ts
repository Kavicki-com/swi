import { BAND_LABELS } from './healthConnect/healthConnectReader';
import { MANUFACTURER_APPS } from './bandGuide';
import {
  ADVERTISED_NAME_PREFIXES,
  appOfAdvertisedName,
  appOfBandPackage,
  detectManufacturerApp,
} from './bandDetection';

describe('appOfBandPackage', () => {
  it('liga cada pacote da tabela do leitor ao app do fabricante de mesmo nome', () => {
    for (const [pacote, rotulo] of Object.entries(BAND_LABELS)) {
      const id = appOfBandPackage(pacote);
      expect(MANUFACTURER_APPS.find((app) => app.id === id)?.name).toBe(rotulo);
    }
  });

  it.each([
    ['com.xiaomi.wearable', 'mi-fitness'],
    ['com.xiaomi.hm.health', 'zepp-life'],
    ['com.huami.watch.hmwatchmanager', 'zepp'],
    ['com.huawei.health', 'huawei-health'],
  ])('%s é %s', (pacote, id) => {
    expect(appOfBandPackage(pacote)).toBe(id);
  });

  it.each([[null], ['com.exemplo.pulseira'], [''], ['toString']])(
    'pacote %p não detecta nada',
    (pacote) => {
      expect(appOfBandPackage(pacote)).toBeNull();
    },
  );
});

describe('appOfAdvertisedName', () => {
  it('cobre os prefixos da spec, na ordem dela', () => {
    expect(ADVERTISED_NAME_PREFIXES).toEqual([
      ['Amazfit', 'zepp'],
      ['Zepp', 'zepp'],
      ['Mi Band', 'mi-fitness'],
      ['Mi Smart Band', 'mi-fitness'],
      ['Xiaomi Smart Band', 'mi-fitness'],
      ['Redmi Band', 'mi-fitness'],
      ['Galaxy Fit', 'samsung-health'],
      ['Galaxy Watch', 'samsung-health'],
      ['Fitbit', 'fitbit'],
      ['Inspire', 'fitbit'],
      ['Charge', 'fitbit'],
      ['Versa', 'fitbit'],
      ['Sense', 'fitbit'],
      ['Garmin', 'garmin-connect'],
      ['Forerunner', 'garmin-connect'],
      ['vívo', 'garmin-connect'],
      ['Venu', 'garmin-connect'],
      ['HUAWEI', 'huawei-health'],
      ['HONOR', 'huawei-health'],
    ]);
  });

  it.each([
    ['Amazfit Bip 5', 'zepp'],
    ['Amazfit Band 7', 'zepp'],
    ['Zepp E', 'zepp'],
    ['Mi Band 7', 'mi-fitness'],
    ['Mi Smart Band 6', 'mi-fitness'],
    ['Xiaomi Smart Band 9', 'mi-fitness'],
    ['Redmi Band 2', 'mi-fitness'],
    ['Galaxy Fit3 (1A2B)', 'samsung-health'],
    ['Galaxy Watch6 (C3D4) LE', 'samsung-health'],
    ['Fitbit Luxe', 'fitbit'],
    ['Inspire 3', 'fitbit'],
    ['Charge 6', 'fitbit'],
    ['Versa 4', 'fitbit'],
    ['Sense 2', 'fitbit'],
    ['Garmin Lily 2', 'garmin-connect'],
    ['Forerunner 265', 'garmin-connect'],
    ['vívosmart 5', 'garmin-connect'],
    ['Venu 3', 'garmin-connect'],
    ['HUAWEI Band 8-1A2', 'huawei-health'],
    ['HONOR Band 7-3F4', 'huawei-health'],
  ])('"%s" é %s', (nome, id) => {
    expect(appOfAdvertisedName(nome)).toBe(id);
  });

  it.each([
    // O sistema não padroniza caixa nem acento no nome anunciado.
    ['AMAZFIT GTR', 'zepp'],
    ['huawei watch fit', 'huawei-health'],
    ['vivoactive 5', 'garmin-connect'],
    ['VÍVOMOVE Trend', 'garmin-connect'],
    ['  Mi Band 8', 'mi-fitness'],
  ])('"%s" vale sem olhar caixa, acento nem espaço no começo', (nome, id) => {
    expect(appOfAdvertisedName(nome)).toBe(id);
  });

  it.each([
    [null],
    [''],
    ['   '],
    ['Pulseira X1'],
    ['M6'],
    ['Polar H10 12345'],
    // O prefixo vale só no começo do nome.
    ['Band Mi'],
    ['Smart Band 8'],
    ['My Amazfit'],
  ])('nome sem prefixo conhecido (%p) não detecta nada', (nome) => {
    expect(appOfAdvertisedName(nome)).toBeNull();
  });
});

describe('detectManufacturerApp', () => {
  it('o pacote do Health Connect vem antes do nome anunciado', () => {
    expect(
      detectManufacturerApp({ bandPackage: 'com.fitbit.FitbitMobile', advertisedName: 'HUAWEI Band 8' }),
    ).toEqual({ id: 'fitbit', source: 'health-connect' });
  });

  it('sem pacote, vale o nome anunciado', () => {
    expect(detectManufacturerApp({ bandPackage: null, advertisedName: 'Galaxy Fit3' })).toEqual({
      id: 'samsung-health',
      source: 'bluetooth',
    });
  });

  it('pacote desconhecido não decide: o nome anunciado decide', () => {
    expect(
      detectManufacturerApp({ bandPackage: 'com.exemplo.pulseira', advertisedName: 'Venu 3' }),
    ).toEqual({ id: 'garmin-connect', source: 'bluetooth' });
  });

  it('sem pacote conhecido nem nome com prefixo, nada detectado', () => {
    expect(detectManufacturerApp({ bandPackage: 'com.exemplo.pulseira', advertisedName: 'M6' })).toBeNull();
    expect(detectManufacturerApp({ bandPackage: null, advertisedName: null })).toBeNull();
  });
});
