import {
  readinessFactsOf,
  readinessStepsOf,
  type ReadinessFacts,
  type ReadinessStep,
} from './readiness';
import type { HealthConnectState } from './healthConnect/healthConnectReader';

// A lista de prontidão é pura: os fatos do aparelho entram, a lista ordenada
// sai. A tela não consegue fixar todas as combinações, então a tabela mora
// aqui; os testes de tela cobrem o que a pessoa vê e para onde cada toque vai.

const PRONTO: ReadinessFacts = {
  paired: true,
  healthConnectAvailability: 'available',
  readGranted: true,
  backgroundGranted: true,
  manufacturerPackage: 'com.xiaomi.wearable',
  bandChosen: true,
  hasBirthDate: true,
};

const HC: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  backgroundPermission: 'granted',
  bandPackage: 'com.xiaomi.wearable',
  bandLabel: 'Mi Fitness',
  noBand: false,
  lastSyncAt: '2026-10-22T10:00:00.000Z',
};

const pendentes = (steps: ReadinessStep[]) => steps.filter((s) => s.pendente === true).map((s) => s.id);
const passo = (steps: ReadinessStep[], id: ReadinessStep['id']) => steps.find((s) => s.id === id)!;

describe('readinessStepsOf', () => {
  it('traz os sete passos na ordem da spec, com os ids do backend e a ação de cada um', () => {
    expect(readinessStepsOf(PRONTO).map((s) => [s.id, s.obrigatorio, s.acao])).toEqual([
      ['PAIR', true, 'parear'],
      ['HEALTH_CONNECT_INSTALL', true, 'play-store'],
      ['HEALTH_CONNECT_READ', true, 'permissao'],
      ['HEALTH_CONNECT_BACKGROUND', true, 'permissao-segundo-plano'],
      ['MANUFACTURER_APP', false, 'guia'],
      ['BLUETOOTH_BAND', false, 'escolher-pulseira'],
      ['BIRTH_DATE', true, 'avisar-administrador'],
    ]);
  });

  it('com tudo cumprido, nada pendente', () => {
    expect(readinessStepsOf(PRONTO).every((s) => s.pendente === false)).toBe(true);
  });

  it.each<[string, Partial<ReadinessFacts>, string[]]>([
    ['sem pareamento', { paired: false }, ['PAIR']],
    ['sem Health Connect', { healthConnectAvailability: 'unavailable' }, ['HEALTH_CONNECT_INSTALL']],
    ['Health Connect desatualizado', { healthConnectAvailability: 'update_required' }, ['HEALTH_CONNECT_INSTALL']],
    ['leitura negada', { readGranted: false }, ['HEALTH_CONNECT_READ']],
    ['segundo plano negado', { backgroundGranted: false }, ['HEALTH_CONNECT_BACKGROUND']],
    ['nenhum app do fabricante detectado', { manufacturerPackage: null }, ['MANUFACTURER_APP']],
    ['nenhuma pulseira escolhida', { bandChosen: false }, ['BLUETOOTH_BAND']],
    ['sem data de nascimento', { hasBirthDate: false }, ['BIRTH_DATE']],
  ])('%s: só o passo dele fica pendente', (_caso, fatos, esperado) => {
    expect(pendentes(readinessStepsOf({ ...PRONTO, ...fatos }))).toEqual(esperado);
  });

  it.each<[string, Partial<ReadinessFacts>, ReadinessStep['id']]>([
    ['pareamento', { paired: null }, 'PAIR'],
    ['Health Connect', { healthConnectAvailability: null }, 'HEALTH_CONNECT_INSTALL'],
    ['leitura', { readGranted: null }, 'HEALTH_CONNECT_READ'],
    ['segundo plano', { backgroundGranted: null }, 'HEALTH_CONNECT_BACKGROUND'],
    ['pulseira escolhida', { bandChosen: null }, 'BLUETOOTH_BAND'],
    ['data de nascimento', { hasBirthDate: null }, 'BIRTH_DATE'],
  ])('%s desconhecido: o passo sai como não sabido, nunca como pendente', (_caso, fatos, id) => {
    expect(passo(readinessStepsOf({ ...PRONTO, ...fatos }), id).pendente).toBeNull();
  });

  it('sem saber se há Health Connect, também não afirma nada do app do fabricante', () => {
    const steps = readinessStepsOf({ ...PRONTO, healthConnectAvailability: null, manufacturerPackage: null });
    expect(passo(steps, 'MANUFACTURER_APP').pendente).toBeNull();
  });

  it('sem o gate do Bluetooth, o passo da pulseira não existe', () => {
    const ids = readinessStepsOf(PRONTO, { bluetooth: false }).map((s) => s.id);
    expect(ids).not.toContain('BLUETOOTH_BAND');
    expect(ids).toHaveLength(6);
  });

  it('nenhum passo fala de jornada', () => {
    expect(readinessStepsOf(PRONTO).map((s) => s.id).join(' ')).not.toMatch(/JOURNEY|JORNADA/i);
  });
});

describe('readinessFactsOf', () => {
  const fontes = {
    paired: true,
    healthConnect: HC,
    bandChoice: { deviceId: 'AA:BB', name: 'Mi Band' },
    profile: { birthDate: '25/12/1990' },
  };

  it('lê cada fato da sua fonte', () => {
    expect(readinessFactsOf(fontes)).toEqual(PRONTO);
  });

  it('antes da primeira conferência do Health Connect, nada dele é sabido', () => {
    expect(readinessFactsOf({ ...fontes, healthConnect: null })).toMatchObject({
      healthConnectAvailability: null,
      readGranted: null,
      backgroundGranted: null,
      manufacturerPackage: null,
    });
  });

  it('sem Health Connect no aparelho, nenhuma leitura está permitida', () => {
    const fatos = readinessFactsOf({
      ...fontes,
      healthConnect: { ...HC, availability: 'unavailable', permission: null, backgroundPermission: null },
    });
    expect(fatos).toMatchObject({ readGranted: false, backgroundGranted: false });
  });

  it('com Health Connect e a permissão ainda não conferida, não afirma nada', () => {
    const fatos = readinessFactsOf({
      ...fontes,
      healthConnect: { ...HC, permission: null, backgroundPermission: undefined },
    });
    expect(fatos).toMatchObject({ readGranted: null, backgroundGranted: null });
  });

  it('permissões negadas são fatos', () => {
    const fatos = readinessFactsOf({
      ...fontes,
      healthConnect: { ...HC, permission: 'denied', backgroundPermission: 'denied' },
    });
    expect(fatos).toMatchObject({ readGranted: false, backgroundGranted: false });
  });

  it('a escolha da pulseira ainda não lida do disco é desconhecida; lida e vazia é "nenhuma"', () => {
    expect(readinessFactsOf({ ...fontes, bandChoice: undefined }).bandChosen).toBeNull();
    expect(readinessFactsOf({ ...fontes, bandChoice: null }).bandChosen).toBe(false);
  });

  it('perfil ainda não lido é desconhecido; data vazia ou só espaços é "sem data"', () => {
    expect(readinessFactsOf({ ...fontes, profile: null }).hasBirthDate).toBeNull();
    expect(readinessFactsOf({ ...fontes, profile: {} }).hasBirthDate).toBe(false);
    expect(readinessFactsOf({ ...fontes, profile: { birthDate: '  ' } }).hasBirthDate).toBe(false);
  });
});
