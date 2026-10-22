// Tabela dos apps do fabricante e o guia da pulseira de cada um.
//
// O SWI identifica o app do fabricante, nunca o modelo da pulseira (glossário:
// "App do fabricante"). A pergunta "Qual é o app da sua pulseira?" lista os
// sete daqui mais "Outro", e cada resposta abre um guia em dois blocos: como
// as medições chegam pelo Health Connect e como ligar o batimento ao vivo
// por Bluetooth.
//
// Conteúdo estático, só da pesquisa de 2026-10-22 (relatório local em
// docs/plans/2026-10-22-pesquisa-pulseiras-ble-health-connect.md). Passo com
// fonte primária é afirmado; com fonte secundária, ou que a fonte primária
// documenta só para parte das pulseiras daquele app, vai precedido de "Pode
// variar com o modelo". Os nomes das opções ficam como a pesquisa os cita.
// Atualizar o guia é refazer a pesquisa, não editar daqui de memória.

export const MANUFACTURER_APPS = [
  { id: 'zepp', name: 'Zepp' },
  { id: 'zepp-life', name: 'Zepp Life' },
  { id: 'mi-fitness', name: 'Mi Fitness' },
  { id: 'samsung-health', name: 'Samsung Health' },
  { id: 'fitbit', name: 'Fitbit' },
  { id: 'garmin-connect', name: 'Garmin Connect' },
  { id: 'huawei-health', name: 'Huawei Health' },
] as const;

export const OTHER_APP = { id: 'outro', name: 'Outro' } as const;

export type ManufacturerAppId = (typeof MANUFACTURER_APPS)[number]['id'];
/** O que a pergunta aceita como resposta: um app da tabela ou "Outro". */
export type BandGuideId = ManufacturerAppId | typeof OTHER_APP.id;

export interface BandGuideStep {
  readonly text: string;
  /** primary: afirmado. secondary: precedido de "Pode variar com o modelo". */
  readonly source: 'primary' | 'secondary';
}

/**
 * O que o bloco diz quando não há passo a seguir: o app não grava no Health
 * Connect (Huawei Health) ou não permite o batimento ao vivo por Bluetooth.
 */
export type BandGuideStatus = 'not-written' | 'not-allowed';

export interface BandGuideBlock {
  readonly status: BandGuideStatus | null;
  readonly steps: readonly BandGuideStep[];
  /** A página do fabricante citada na pesquisa, quando há. */
  readonly link: string | null;
}

export interface BandGuide {
  readonly healthConnect: BandGuideBlock;
  readonly bluetooth: BandGuideBlock;
}

export const BAND_GUIDE_STATUS_LABELS: Readonly<Record<BandGuideStatus, string>> = {
  'not-written': 'Este app não grava no Health Connect',
  'not-allowed': 'Este app não permite',
};

const primario = (text: string): BandGuideStep => ({ text, source: 'primary' });
const secundario = (text: string): BandGuideStep => ({ text, source: 'secondary' });

const NAO_SABE = 'O SWI não sabe se a sua pulseira permite.';

export const BAND_GUIDES: Readonly<Record<BandGuideId, BandGuide>> = {
  zepp: {
    healthConnect: {
      status: null,
      steps: [
        // Gadgets & Wearables, jan/2025 (secundária): a Amazfit não publica.
        secundario('no Zepp, vá em Perfil, "3rd-party account linking", "Health Connect" e permita.'),
        secundario('no Android 9 a 13, instale antes o Health Connect pela Play Store.'),
        // FAQ de sincronização da Amazfit.
        primario('Com o Bluetooth do celular e o app Zepp ligados, a pulseira sincroniza com o app sozinha.'),
      ],
      link: null,
    },
    bluetooth: {
      status: null,
      steps: [
        // Amazfit documenta o caminho, sem lista de pulseiras; Zepp OS 3+ só
        // pelo HypeRate (secundária).
        secundario('no app Zepp, vá em Device, escolha a pulseira, "Health Monitoring" e ligue "Heart Rate Push".'),
        secundario('algumas pulseiras só transmitem durante um treino.'),
      ],
      link: 'https://support.amazfit.com/us/amazfit_helio_strap/docs/GyUIdtHLvoMqNUxOkuNcQB4hn4d',
    },
  },
  'zepp-life': {
    healthConnect: {
      status: null,
      // A pesquisa não cobre o Zepp Life no Health Connect: o guia diz isso,
      // em vez de inventar o caminho.
      steps: [primario('O SWI não tem instrução do fabricante para o Zepp Life gravar no Health Connect.')],
      link: null,
    },
    bluetooth: {
      // Gadgetbridge: batimento em tempo real para terceiros não funciona
      // nas pulseiras da geração Huami, nem com o app oficial.
      status: 'not-allowed',
      steps: [],
      link: null,
    },
  },
  'mi-fitness': {
    healthConnect: {
      status: null,
      steps: [
        // FAQ Xiaomi KA-230357.
        primario('No Mi Fitness, vá em "Profile", "Settings", "Sync with the cloud" e ligue.'),
        primario('Depois, em "Profile", "Third-party data", ligue "Health" e escolha os dados.'),
        // FAQ Xiaomi KA-611505.
        primario(
          'Não feche o Mi Fitness arrastando a tela para cima: fechado, ele só volta a sincronizar quando você o abre de novo.',
        ),
        // FAQ Xiaomi KA-231124, de uma pulseira só.
        secundario('a pulseira sincroniza com o celular a cada 30 minutos.'),
      ],
      link: 'https://www.mi.com/global/support/faq/details/KA-230357/',
    },
    bluetooth: {
      status: null,
      // FAQ Xiaomi KA-611505 documenta "Share HR" para uma pulseira; nas
      // anteriores o Gadgetbridge diz que não há transmissão para terceiros.
      steps: [secundario('na pulseira, abra a lista de apps, "Settings", "Share HR" e ligue.')],
      link: 'https://www.mi.com/global/support/faq/details/KA-611505/',
    },
  },
  'samsung-health': {
    healthConnect: {
      status: null,
      steps: [
        // Samsung Developers: blog e FAQ do Health Connect.
        primario('No celular, vá em "Settings", "Health Connect", "App permissions", "Samsung Health" e permita.'),
        primario('Deixe a sincronização com a conta Samsung ligada.'),
        primario(
          'O batimento contínuo da pulseira não chega na hora: em geral vai ao celular quando a pulseira reconecta, quando você abre a tela inicial do Samsung Health ou puxa a tela para baixo.',
        ),
        primario('Os dados do rastreador de atividade do Samsung Health não vão para o Health Connect.'),
      ],
      link: 'https://developer.samsung.com/health/health-connect-faq.html',
    },
    bluetooth: {
      // Sem recurso nativo de transmissão na documentação da Samsung.
      status: 'not-allowed',
      steps: [],
      link: null,
    },
  },
  fitbit: {
    healthConnect: {
      status: null,
      steps: [
        // Google blog, mai/2026.
        primario('O app Fitbit passou a se chamar Google Health.'),
        // Google Health/Fitbit "What is Health Connect?".
        primario('Precisa de Android 9 ou mais novo e de conta Google de adulto.'),
        primario('Permita cada tipo de dado. O acesso ao histórico e o segundo plano são pedidos à parte.'),
        primario(
          'O app grava passos, batimento, sono, temperatura corporal e outros dados. Oxigenação, não: o app só a lê do Health Connect.',
        ),
        // Google "How do Fitbit devices sync" e Fitbit Developer.
        primario(
          'Abra o app com a pulseira por perto para ela sincronizar. Com o app rodando, a pulseira ao alcance do Bluetooth e internet no celular, a sincronização pode acontecer a cada 15 minutos.',
        ),
      ],
      link: 'https://support.google.com/fitbit/answer/14506680',
    },
    bluetooth: {
      status: null,
      // Google lista só parte das pulseiras com "HR on equipment".
      steps: [
        secundario(
          'inicie um treino no app Exercise da pulseira e, nos 2 primeiros minutos, deslize a tela para baixo e ligue "HR on equipment".',
        ),
        secundario('a pulseira se liga a um app por vez.'),
      ],
      link: 'https://support.google.com/fitbit/answer/14236705',
    },
  },
  'garmin-connect': {
    healthConnect: {
      status: null,
      steps: [
        // Garmin Support KM1845700.
        primario('Precisa de Android 14 ou mais novo.'),
        primario(
          'Ligue o compartilhamento com o Health Connect no Garmin Connect. Depois disso, ele grava no Health Connect a cada sincronização da pulseira.',
        ),
        primario('O Garmin Connect não grava oxigenação, pressão nem temperatura no Health Connect.'),
      ],
      link: 'https://support.garmin.com/en-US/?faq=JToBEy0jfe6pIygark2Ui5',
    },
    bluetooth: {
      status: null,
      // Manual Garmin; Bluetooth por modelo só em DC Rainmaker e Start 2 Run.
      steps: [
        secundario(
          'na pulseira, segure o botão UP e vá em "Health & Wellness", "Wrist Heart Rate", "Broadcast Heart Rate".',
        ),
        secundario('nem toda pulseira transmite por Bluetooth; algumas só transmitem para aparelhos Garmin.'),
      ],
      link: 'https://www8.garmin.com/manuals/webhelp/GUID-F41EAFB3-6CC9-42DE-9C6C-9E358DBB0671/EN-US/GUID-D8D363C2-0690-48D4-95E2-A3557E7D53C2.html',
    },
  },
  'huawei-health': {
    healthConnect: {
      // Sem integração oficial: só o caminho por Bluetooth é possível.
      status: 'not-written',
      steps: [],
      link: null,
    },
    bluetooth: {
      status: null,
      steps: [
        // Huawei, "Heart rate broadcasts on your HUAWEI watch/band".
        primario('Na pulseira, abra a lista de apps e vá em "Settings", "HR Data Broadcasts".'),
        primario('Se a opção não aparecer, a pulseira não permite.'),
        secundario('em pulseiras de uma conexão só, ligar a transmissão pode derrubar a conexão com o Huawei Health.'),
      ],
      link: 'https://consumer.huawei.com/kh/support/content/en-us15827504/',
    },
  },
  outro: {
    healthConnect: {
      status: null,
      steps: [
        primario('Pelo Health Connect, as medições chegam ao SWI quando o app do fabricante as grava lá.'),
        primario('Procure no app do fabricante a opção de compartilhar os dados com o Health Connect.'),
        primario(NAO_SABE),
      ],
      link: null,
    },
    bluetooth: {
      status: null,
      steps: [
        primario(
          'Algumas pulseiras transmitem o batimento ao vivo por Bluetooth, com uma opção que você liga na pulseira ou no app do fabricante. Cada fabricante dá um nome diferente a essa opção.',
        ),
        primario(NAO_SABE),
      ],
      link: null,
    },
  },
};

/** O texto do passo como a tela o mostra. */
export function guideStepText(step: BandGuideStep): string {
  if (step.source === 'primary') return step.text;
  return `Pode variar com o modelo: ${step.text.charAt(0).toLowerCase()}${step.text.slice(1)}`;
}

/** Pela chave própria: `toString` existe em todo objeto e não é app do fabricante. */
export function isBandGuideId(value: string): value is BandGuideId {
  return Object.prototype.hasOwnProperty.call(BAND_GUIDES, value);
}
