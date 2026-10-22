import { isFeatureEnabled } from '../../lib/featureFlags';
import type { HealthConnectState } from './healthConnect/healthConnectReader';

// O primeiro uso no Android, na ordem da ADR-0013: o caminho base primeiro
// (parear o celular, depois o Health Connect) e a pulseira por Bluetooth por
// último, como acréscimo opcional. A ordem mora aqui, numa lista só, para as
// telas não a combinarem cada uma por si. O iPhone tem o fluxo dele
// (connection, connection-start, pairing, complete) e não passa por aqui.
//
// Nenhum texto daqui promete movimento ao vivo: no Android passos e
// movimento só chegam pelo Health Connect, a cada sincronização e com a hora
// da medição.

export type AndroidFirstUseStep = 'pairing' | 'health-connect' | 'bluetooth';

export const FIRST_USE_END = '/(onboarding)/watch/complete';

const ROUTES: Record<AndroidFirstUseStep, string> = {
  pairing: '/(onboarding)/watch/pairing',
  'health-connect': '/(onboarding)/watch/health-connect',
  bluetooth: '/(onboarding)/watch/bluetooth',
};

/** As etapas na ordem; a pulseira por Bluetooth só com o gate dela. */
export function androidFirstUseSteps(): AndroidFirstUseStep[] {
  return isFeatureEnabled('bluetoothHeartRate')
    ? ['pairing', 'health-connect', 'bluetooth']
    : ['pairing', 'health-connect'];
}

export function androidFirstUseRoute(step: AndroidFirstUseStep): string {
  return ROUTES[step];
}

/** A rota depois de `step`; depois da última, o fim do primeiro uso. */
export function nextAndroidFirstUseRoute(step: AndroidFirstUseStep): string {
  const steps = androidFirstUseSteps();
  const next = steps[steps.indexOf(step) + 1];
  return next === undefined ? FIRST_USE_END : ROUTES[next];
}

/** Posição para a barra de etapas do DS (1 é a primeira). */
export function androidFirstUseProgress(step: AndroidFirstUseStep): {
  total: number;
  current: number;
} {
  const steps = androidFirstUseSteps();
  return { total: steps.length, current: steps.indexOf(step) + 1 };
}

/** `null` enquanto não se sabe (antes da primeira conferência). */
export type FirstUseStepState = 'done' | 'pending' | null;

export interface HealthConnectFirstUseItem {
  id: 'install' | 'read' | 'background';
  label: string;
  state: FirstUseStepState;
}

/**
 * Os três passos do Health Connect, na ordem: instalar ou atualizar, permitir
 * a leitura, permitir em segundo plano. Sem Health Connect, nenhuma
 * permissão está concedida; sem saber se há, nada se afirma.
 */
export function healthConnectFirstUseItems(
  state: HealthConnectState | null,
): HealthConnectFirstUseItem[] {
  const availability = state?.availability ?? null;
  const installed: FirstUseStepState =
    availability === null ? null : availability === 'available' ? 'done' : 'pending';
  const granted = (permission: HealthConnectState['permission'] | undefined): FirstUseStepState => {
    if (installed !== 'done') return installed;
    if (permission == null) return null;
    return permission === 'granted' ? 'done' : 'pending';
  };
  return [
    { id: 'install', label: HEALTH_CONNECT_FIRST_USE_COPY.instalar, state: installed },
    { id: 'read', label: HEALTH_CONNECT_FIRST_USE_COPY.ler, state: granted(state?.permission) },
    {
      id: 'background',
      label: HEALTH_CONNECT_FIRST_USE_COPY.segundoPlano,
      state: granted(state?.backgroundPermission),
    },
  ];
}

/** A etiqueta de cada passo, pelo estado. */
export function firstUseStepTag(state: FirstUseStepState): {
  status: 'accept' | 'pending' | 'info';
  label: string;
} {
  if (state === 'done') return { status: 'accept', label: 'Feito' };
  if (state === 'pending') return { status: 'pending', label: 'Falta' };
  return { status: 'info', label: 'Conferindo' };
}

export const HEALTH_CONNECT_FIRST_USE_COPY = {
  titulo: 'Health Connect',
  corpo:
    'No Android, o app da sua pulseira grava as medições no Health Connect, e o SWI as lê de lá: passos, energia, oxigenação, pressão e batimento. Elas chegam a cada sincronização, sempre com a hora em que foram medidas.',
  instalar: 'Instalar ou atualizar o Health Connect',
  ler: 'Permitir a leitura',
  segundoPlano: 'Permitir a leitura em segundo plano',
  // A permissão de segundo plano vem no mesmo pedido da leitura, mas a pessoa
  // pode deixá-la de fora; antes do Android 15 ela só existe onde o Health
  // Connect a oferece.
  semSegundoPlano:
    'Para o SWI ler com o app fechado, permita também a leitura em segundo plano nos ajustes do Health Connect. Em alguns celulares essa opção não existe; nesse caso as medições chegam quando você abre o SWI.',
  // Leitura permitida antes de parear: a primeira sincronização espera o
  // pareamento, e a tela não fica procurando uma pulseira para sempre.
  semPareamento:
    'Leitura permitida. As medições passam a ir para o servidor depois de parear o celular em Configurações, Monitoramento.',
} as const;

export const BLUETOOTH_FIRST_USE_COPY = {
  titulo: 'Batimento ao vivo',
  opcional: 'Opcional',
  corpo:
    'Algumas pulseiras transmitem o batimento ao vivo por Bluetooth, mas só se o modelo permitir, e muitas não permitem. Sem isso, o batimento continua chegando pelo Health Connect, com a hora em que foi medido.',
  soBatimento:
    'Pelo Bluetooth chega só o batimento. Passos e movimento continuam vindo do Health Connect.',
  avisoTitulo: 'Antes de escolher',
  bateria: 'Transmitir por Bluetooth gasta mais a bateria da pulseira.',
  competicao: 'Em algumas marcas, a transmissão disputa a conexão da pulseira com o app do fabricante.',
} as const;

/** O rodapé das etapas que a pessoa pode deixar para depois. */
export const FIRST_USE_FOOTER_COPY = {
  continuar: 'Continuar',
  configurarDepois: 'Configurar depois',
} as const;
