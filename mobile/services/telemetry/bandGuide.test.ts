import { BAND_LABELS } from './healthConnect/healthConnectReader';
import {
  BAND_GUIDES,
  MANUFACTURER_APPS,
  OTHER_APP,
  guideStepText,
  isBandGuideId,
  type BandGuideBlock,
} from './bandGuide';

// O conteúdo do guia é estático e vem só da pesquisa de 2026-10-22. A tela
// tem teste próprio; aqui, as regras que valem para TODAS as entradas, que a
// tela não percorre uma a uma.

const todasAsEntradas = [...MANUFACTURER_APPS.map((a) => a.id), OTHER_APP.id].map(
  (id) => [id, BAND_GUIDES[id]] as const,
);

const textosDo = (bloco: BandGuideBlock): string[] => bloco.steps.map(guideStepText);

describe('tabela de apps do fabricante', () => {
  it('tem os sete apps conhecidos, na ordem da pergunta', () => {
    expect(MANUFACTURER_APPS.map((a) => a.name)).toEqual([
      'Zepp',
      'Zepp Life',
      'Mi Fitness',
      'Samsung Health',
      'Fitbit',
      'Garmin Connect',
      'Huawei Health',
    ]);
    expect(OTHER_APP.name).toBe('Outro');
  });

  // A detecção por pacote (leitor do Health Connect) e a pergunta falam do
  // mesmo conjunto: um nome detectado sempre tem guia.
  it('cobre todo app que o leitor do Health Connect reconhece', () => {
    const nomes = MANUFACTURER_APPS.map((a) => a.name);
    for (const rotulo of Object.values(BAND_LABELS)) expect(nomes).toContain(rotulo);
  });

  it('reconhece só os ids da tabela', () => {
    expect(isBandGuideId('huawei-health')).toBe(true);
    expect(isBandGuideId('outro')).toBe(true);
    expect(isBandGuideId('toString')).toBe(false);
    expect(isBandGuideId('')).toBe(false);
  });
});

describe('guia da pulseira', () => {
  it.each(todasAsEntradas)('%s tem os dois blocos, cada um com passos ou situação', (_id, guia) => {
    for (const bloco of [guia.healthConnect, guia.bluetooth]) {
      expect(bloco.steps.length > 0 || bloco.status !== null).toBe(true);
    }
  });

  it('passo de fonte secundária vem precedido de "Pode variar com o modelo"; primário é afirmado', () => {
    expect(guideStepText({ text: 'Ligue a opção.', source: 'secondary' })).toBe(
      'Pode variar com o modelo: ligue a opção.',
    );
    expect(guideStepText({ text: 'Ligue a opção.', source: 'primary' })).toBe('Ligue a opção.');
  });

  it('Huawei Health não grava no Health Connect: nenhum passo, só a situação', () => {
    const { healthConnect, bluetooth } = BAND_GUIDES['huawei-health'];
    expect(healthConnect.status).toBe('not-written');
    expect(healthConnect.steps).toEqual([]);
    expect(bluetooth.status).toBeNull();
    expect(bluetooth.steps.length).toBeGreaterThan(0);
  });

  // O app nunca afirma modelo, e o vocabulário das telas é "pulseira" e
  // "app do fabricante".
  it.each(todasAsEntradas)('%s não cita modelo nem foge do vocabulário', (_id, guia) => {
    const tudo = [...textosDo(guia.healthConnect), ...textosDo(guia.bluetooth)].join(' ');
    expect(tudo).not.toMatch(/smartband|wearable|\bcinta\b|\bmarca\b|relógio/i);
    expect(tudo).not.toMatch(
      /Smart Band|Mi Band|Redmi|Galaxy|Charge \d|Inspire|Forerunner|vívo|Bip|Watch Fit|Pixel|Band \d/,
    );
  });

  // Só páginas oficiais citadas na pesquisa como fonte primária.
  it.each(todasAsEntradas)('%s só aponta para página do fabricante', (_id, guia) => {
    for (const bloco of [guia.healthConnect, guia.bluetooth]) {
      if (bloco.link === null) continue;
      const { protocol, hostname } = new URL(bloco.link);
      expect(protocol).toBe('https:');
      expect(hostname).toMatch(
        /^(www\.mi\.com|consumer\.huawei\.com|support\.amazfit\.com|developer\.samsung\.com|support\.google\.com|support\.garmin\.com|www8\.garmin\.com)$/,
      );
    }
  });

  it('"Outro" não tem página de fabricante e diz que o SWI não sabe', () => {
    const { healthConnect, bluetooth } = BAND_GUIDES.outro;
    for (const bloco of [healthConnect, bluetooth]) {
      expect(bloco.link).toBeNull();
      expect(textosDo(bloco).join(' ')).toContain('O SWI não sabe se a sua pulseira permite');
    }
  });
});
