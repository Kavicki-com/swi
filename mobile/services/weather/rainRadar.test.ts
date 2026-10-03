// Radar de chuva (IMERG via NASA GIBS). O que importa travar: o horário que a
// tela afirma é o de uma observação que JÁ TEM tiles. O GIBS anuncia o horário
// no domínio de tempo antes de os tiles existirem (medido em 2026-10-03: o
// domínio dizia 12:30, os tiles de 12:30 e 12:00 davam 404, o de 11:30 existia).
import {
  latestRainRadarTime,
  parseDomainEnd,
  rainRadarLabel,
  rainRadarTiles,
} from './rainRadar';

const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const AGORA = new Date('2026-10-03T17:52:00Z');

const dominio = (texto: string) =>
  `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>${texto}</Domain><Size>1</Size></DimensionDomain></Domains>`;

// GIBS de mentira: devolve o domínio dado e responde 200 só para os horários
// que "já têm tile".
function gibs(xml: string | { status: number }, comTile: string[]) {
  return jest.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('.xml')) {
      return typeof xml === 'string'
        ? { ok: true, status: 200, text: async () => xml }
        : { ok: false, status: xml.status, text: async () => '' };
    }
    expect(init?.method).toBe('HEAD');
    const ok = comTile.some((t) => url.includes(`/${t}/`));
    return { ok, status: ok ? 200 : 404, text: async () => '' };
  });
}

const comoFetch = (f: ReturnType<typeof gibs>) => f as unknown as typeof fetch;
const sondados = (f: ReturnType<typeof gibs>) =>
  f.mock.calls.map(([url]) => url).filter((u) => u.endsWith('.png'));

describe('rainRadarTiles', () => {
  it('monta o molde do GIBS para o horário, na ordem z/y/x', () => {
    expect(rainRadarTiles('2026-10-03T11:30:00Z')).toBe(
      `${BASE}/IMERG_Precipitation_Rate_30min/default/2026-10-03T11:30:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    );
  });
});

describe('parseDomainEnd', () => {
  it('lê o fim do período', () => {
    expect(parseDomainEnd(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'))?.toISOString()).toBe(
      '2026-10-03T12:30:00.000Z',
    );
  });

  it('com vários períodos, vale o fim do último', () => {
    const xml = dominio('2026-09-01/2026-09-30T23:30:00Z/PT30M,2026-10-01/2026-10-03T09:00:00Z/PT30M');
    expect(parseDomainEnd(xml)?.toISOString()).toBe('2026-10-03T09:00:00.000Z');
  });

  it.each([
    ['sem domínio', '<Domains></Domains>'],
    ['domínio vazio', dominio('')],
    ['período sem fim', dominio('2026-10-01')],
    ['fim que não é data', dominio('2026-10-01/amanha/PT30M')],
  ])('%s: devolve null', (_caso, xml) => {
    expect(parseDomainEnd(xml)).toBeNull();
  });
});

describe('latestRainRadarTime', () => {
  it('pergunta o domínio de dois dias atrás até amanhã', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'), ['2026-10-03T12:30:00Z']);
    await latestRainRadarTime(AGORA, comoFetch(f));

    expect(f.mock.calls[0][0]).toBe(
      `${BASE}/1.0.0/IMERG_Precipitation_Rate_30min/default/GoogleMapsCompatible_Level6/all/2026-10-01--2026-10-04.xml`,
    );
  });

  it('usa o horário anunciado quando o tile dele já existe', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'), ['2026-10-03T12:30:00Z']);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).resolves.toBe('2026-10-03T12:30:00Z');
    expect(sondados(f)).toHaveLength(1);
  });

  it('recua de 30 em 30 minutos até achar um horário que já tem tile', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'), [
      '2026-10-03T11:30:00Z',
      '2026-10-03T11:00:00Z',
    ]);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).resolves.toBe('2026-10-03T11:30:00Z');
    expect(sondados(f).map((u) => /default\/([^/]+)\//.exec(u)?.[1])).toEqual([
      '2026-10-03T12:30:00Z',
      '2026-10-03T12:00:00Z',
      '2026-10-03T11:30:00Z',
    ]);
  });

  it('sonda um tile que cobre o Brasil', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'), ['2026-10-03T12:30:00Z']);
    await latestRainRadarTime(AGORA, comoFetch(f));

    expect(sondados(f)[0]).toMatch(/GoogleMapsCompatible_Level6\/3\/4\/2\.png$/);
  });

  it('recua pela virada do dia sem errar a data', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T00:00:00Z/PT30M'), ['2026-10-02T23:30:00Z']);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).resolves.toBe('2026-10-02T23:30:00Z');
  });

  it('desiste depois de quatro horas sem tile, em vez de afirmar um horário', async () => {
    const f = gibs(dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M'), []);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).rejects.toThrow('sem tiles');
    expect(sondados(f)).toHaveLength(9); // o anunciado e mais oito passos
  });

  it('falha quando o GIBS recusa o domínio', async () => {
    const f = gibs({ status: 503 }, []);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).rejects.toThrow('503');
    expect(sondados(f)).toHaveLength(0);
  });

  it('falha quando o domínio vem ilegível', async () => {
    const f = gibs('<html>manutenção</html>', []);

    await expect(latestRainRadarTime(AGORA, comoFetch(f))).rejects.toThrow('ilegível');
  });

  // O fetch do React Native não desiste sozinho: sem prazo, uma conexão que
  // pendura deixaria a tela sem camada e sem aviso para sempre.
  describe('conexão que pendura', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const pendurado = () =>
      jest.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
          }),
      );

    it('desiste do domínio depois de 10 segundos e aborta a conexão', async () => {
      const f = pendurado();
      const leitura = latestRainRadarTime(AGORA, f as unknown as typeof fetch);
      const falha = expect(leitura).rejects.toThrow('não respondeu no prazo');

      await jest.advanceTimersByTimeAsync(9_999);
      expect(f.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      await falha;
      expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });

    it('desiste também quando é a sondagem do tile que pendura', async () => {
      const xml = dominio('2026-10-01/2026-10-03T12:30:00Z/PT30M');
      const sonda = pendurado();
      const f = jest.fn((url: string, init?: { signal?: AbortSignal }) =>
        url.endsWith('.xml')
          ? Promise.resolve({ ok: true, status: 200, text: async () => xml })
          : sonda(url, init),
      );
      const leitura = latestRainRadarTime(AGORA, f as unknown as typeof fetch);
      // O erro pode ser o do prazo ou o do próprio fetch abortado; o que
      // importa é a leitura terminar e a conexão ser derrubada.
      const falha = expect(leitura).rejects.toThrow();

      await jest.advanceTimersByTimeAsync(10_000);

      await falha;
      expect(sonda).toHaveBeenCalledTimes(1);
      expect(sonda.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });
  });
});

describe('rainRadarLabel', () => {
  // Datas montadas no fuso do aparelho de propósito: o texto fala no relógio de
  // quem lê, então o teste vale em qualquer fuso em que rodar.
  it('observação de hoje: só a hora', () => {
    const obs = new Date(2026, 9, 3, 8, 30).toISOString();

    expect(rainRadarLabel(obs, new Date(2026, 9, 3, 14, 52))).toBe('Chuva observada às 08h30');
  });

  it('observação de outro dia leva a data junto', () => {
    const obs = new Date(2026, 9, 2, 20, 30).toISOString();

    expect(rainRadarLabel(obs, new Date(2026, 9, 3, 2, 5))).toBe(
      'Chuva observada em 02/10 às 20h30',
    );
  });

  it('mesmo dia do mês em outro mês não conta como hoje', () => {
    const obs = new Date(2026, 8, 3, 8, 30).toISOString();

    expect(rainRadarLabel(obs, new Date(2026, 9, 3, 9, 0))).toBe(
      'Chuva observada em 03/09 às 08h30',
    );
  });
});
