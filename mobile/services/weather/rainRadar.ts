// Radar de chuva do mapa de clima: taxa de precipitação do IMERG (NASA GPM),
// servida em tiles pelo NASA GIBS. Gratuito, sem chave, cobre o Brasil inteiro.
// O dado é estimativa por satélite em passos de 30 minutos e chega com algumas
// horas de atraso, então quem mostra a camada precisa dizer de que hora ela é.
import { withDeadline } from '../api/http';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
// Prazo de cada requisição ao GIBS. São até dez em sequência.
const REQUEST_TIMEOUT_MS = 10_000;
const LAYER = 'IMERG_Precipitation_Rate_30min';
const MATRIX = 'GoogleMapsCompatible_Level6';

// O conjunto de tiles do GIBS para essa camada vai só até o zoom 6.
export const RAIN_RADAR_MAX_ZOOM = 6;
export const RAIN_RADAR_TILE_SIZE = 256;

const STEP_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Quantos passos de 30 min recuar atrás de um horário já publicado.
const MAX_STEPS_BACK = 8;
// Tile z/y/x que cobre o centro do Brasil no zoom 3.
const PROBE_TILE = '3/4/2';

const isoNoMillis = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Molde de URL dos tiles de um horário. O GIBS usa a ordem z/y/x.
export function rainRadarTiles(time: string): string {
  return `${GIBS}/${LAYER}/default/${time}/${MATRIX}/{z}/{y}/{x}.png`;
}

// Fim do último período do domínio de tempo devolvido pelo GIBS, por exemplo
// `<Domain>2026-10-01/2026-10-03T12:30:00Z/PT30M</Domain>`. Um domínio pode
// trazer vários períodos separados por vírgula; vale o último.
export function parseDomainEnd(xml: string): Date | null {
  const domain = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1];
  if (!domain) return null;
  const lastPeriod = domain.split(',').pop() ?? '';
  const end = new Date(lastPeriod.split('/')[1] ?? '');
  return Number.isNaN(end.getTime()) ? null : end;
}

const two = (n: number) => String(n).padStart(2, '0');

// Texto que diz de quando é a chuva desenhada, no relógio do aparelho. O dado
// chega com horas de atraso: sem essa linha a pessoa leria chuva antiga como
// se fosse de agora. Observação de outro dia leva a data junto.
export function rainRadarLabel(time: string, now: Date = new Date()): string {
  const at = new Date(time);
  const hour = `${two(at.getHours())}h${two(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    ? `Chuva observada às ${hour}`
    : `Chuva observada em ${two(at.getDate())}/${two(at.getMonth() + 1)} às ${hour}`;
}

// Horário (ISO, UTC) da observação mais recente que já tem tiles. O GIBS
// anuncia o horário no domínio antes de os tiles existirem, então o anúncio
// sozinho não basta: recua de 30 em 30 minutos até um tile responder.
export async function latestRainRadarTime(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // Cada requisição tem prazo: o fetch do React Native não desiste sozinho.
  const get = (url: string, init?: RequestInit) =>
    withDeadline(REQUEST_TIMEOUT_MS, 'GIBS não respondeu no prazo', (signal) =>
      fetchImpl(url, { ...init, signal }),
    );

  const range = `${isoDay(new Date(now.getTime() - 2 * DAY_MS))}--${isoDay(new Date(now.getTime() + DAY_MS))}`;
  const xml = await withDeadline(REQUEST_TIMEOUT_MS, 'GIBS não respondeu no prazo', async (signal) => {
    const res = await fetchImpl(`${GIBS}/1.0.0/${LAYER}/default/${MATRIX}/all/${range}.xml`, { signal });
    if (!res.ok) throw new Error(`GIBS respondeu ${res.status} ao domínio de tempo`);
    return res.text();
  });
  const end = parseDomainEnd(xml);
  if (!end) throw new Error('GIBS devolveu um domínio de tempo ilegível');

  for (let step = 0; step <= MAX_STEPS_BACK; step++) {
    const time = isoNoMillis(new Date(end.getTime() - step * STEP_MS));
    const probe = await get(`${GIBS}/${LAYER}/default/${time}/${MATRIX}/${PROBE_TILE}.png`, {
      method: 'HEAD',
    });
    if (probe.ok) return time;
  }
  throw new Error('GIBS sem tiles de chuva nos horários recentes');
}
