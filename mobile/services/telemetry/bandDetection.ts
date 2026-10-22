import { BAND_LABELS } from './healthConnect/healthConnectReader';
import { MANUFACTURER_APPS, type ManufacturerAppId } from './bandGuide';

// Descoberta do app do fabricante, sem o funcionário responder nada. Duas
// fontes, nesta ordem: o pacote que gravou o batimento no Health Connect (a
// tabela de pacotes do leitor) e, antes da primeira sincronização, o nome que
// a pulseira escolhida anuncia por Bluetooth. Sem nenhuma das duas, vale a
// resposta a "Qual é o app da sua pulseira?" (bandGuideAnswer.ts).
//
// O nome anunciado costuma trazer o modelo ("Galaxy Fit3 (1A2B)"); daqui sai
// só o app do fabricante, e a tela nunca mostra o nome anunciado.

export type BandDetectionSource = 'health-connect' | 'bluetooth';

export interface DetectedManufacturerApp {
  readonly id: ManufacturerAppId;
  readonly source: BandDetectionSource;
}

export const BAND_DETECTION_SOURCE_LABELS: Readonly<Record<BandDetectionSource, string>> = {
  'health-connect': 'O SWI identificou o app pelas medições que ele gravou no Health Connect.',
  bluetooth: 'O SWI identificou o app pelo nome que a pulseira anuncia por Bluetooth.',
};

/** Prefixo do nome anunciado e o app do fabricante dele, como a spec os lista. */
export const ADVERTISED_NAME_PREFIXES: readonly (readonly [string, ManufacturerAppId])[] = [
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
];

/** O app do fabricante do pacote, pelo nome legível da tabela do leitor; nulo se desconhecido. */
export function appOfBandPackage(bandPackage: string | null): ManufacturerAppId | null {
  // Pela chave própria: `toString` existe em todo objeto e não é pacote.
  if (bandPackage === null || !Object.prototype.hasOwnProperty.call(BAND_LABELS, bandPackage)) {
    return null;
  }
  return MANUFACTURER_APPS.find((app) => app.name === BAND_LABELS[bandPackage])?.id ?? null;
}

// O nome anunciado vem como o fabricante gravou na pulseira: caixa e acento
// variam ("vívosmart", "vivoactive"), e por isso a comparação ignora os dois.
const normalizado = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const PREFIXOS_NORMALIZADOS = ADVERTISED_NAME_PREFIXES.map(
  ([prefixo, id]) => [normalizado(prefixo), id] as const,
);

/** O app do fabricante pelo começo do nome anunciado; nulo sem prefixo conhecido. */
export function appOfAdvertisedName(name: string | null): ManufacturerAppId | null {
  if (name === null) return null;
  const nome = normalizado(name.trim());
  if (nome === '') return null;
  return PREFIXOS_NORMALIZADOS.find(([prefixo]) => nome.startsWith(prefixo))?.[1] ?? null;
}

/** O pacote do Health Connect antes do nome anunciado; nulo quando nenhum dos dois detecta. */
export function detectManufacturerApp(input: {
  bandPackage: string | null;
  advertisedName: string | null;
}): DetectedManufacturerApp | null {
  const peloPacote = appOfBandPackage(input.bandPackage);
  if (peloPacote !== null) return { id: peloPacote, source: 'health-connect' };
  const peloNome = appOfAdvertisedName(input.advertisedName);
  if (peloNome !== null) return { id: peloNome, source: 'bluetooth' };
  return null;
}
