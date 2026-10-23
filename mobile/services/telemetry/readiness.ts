import type { Profile } from '../profile/types';
import { HEALTH_CONNECT_FIRST_USE_COPY } from './androidFirstUse';
import type { BandChoice } from './bluetooth/bluetoothBandChoice';
import type { HealthConnectState } from './healthConnect/healthConnectReader';
import type { HealthConnectAvailability } from './healthConnect/healthConnectSource';

// A lista de prontidão do celular Android: os passos para o monitoramento
// funcionar, na ordem da ADR-0013, cada um com a ação que o resolve. Função
// pura dos fatos do aparelho, para o dashboard, Configurações e o relato ao
// backend lerem a mesma coisa. Os ids são os do backend
// (swi-backend/src/telemetry/devices/readiness.ts), que deriva a mesma lista
// do relato para o painel.
//
// Fato desconhecido (antes da primeira conferência, perfil ainda não lido)
// nunca vira pendência: o passo sai com `pendente: null` e a tela diz que
// está conferindo, em vez de afirmar o que ninguém viu.
//
// "Iniciar jornada" não é passo: o monitoramento não depende da jornada.

/** Os fatos do lado do aparelho. `null` é "não sabido ainda". */
export interface ReadinessFacts {
  paired: boolean | null;
  healthConnectAvailability: HealthConnectAvailability | null;
  readGranted: boolean | null;
  backgroundGranted: boolean | null;
  /**
   * Pacote do app que gravou o batimento no Health Connect. Nulo é "nenhum
   * detectado" quando a disponibilidade é sabida; sem ela, nada se afirma.
   */
  manufacturerPackage: string | null;
  bandChosen: boolean | null;
  hasBirthDate: boolean | null;
}

/** Onde cada fato mora no app. */
export interface ReadinessSources {
  paired: boolean;
  /** Nulo antes da primeira conferência do leitor. */
  healthConnect: HealthConnectState | null;
  /** `undefined` antes de ler o arquivo; `null` sem pulseira escolhida. */
  bandChoice: BandChoice | null | undefined;
  /** Nulo enquanto o perfil não foi lido. */
  profile: Profile | null;
}

export type ReadinessStepId =
  | 'PAIR'
  | 'HEALTH_CONNECT_INSTALL'
  | 'HEALTH_CONNECT_READ'
  | 'HEALTH_CONNECT_BACKGROUND'
  | 'MANUFACTURER_APP'
  | 'BLUETOOTH_BAND'
  | 'BIRTH_DATE';

export type ReadinessAction =
  | 'parear'
  | 'play-store'
  | 'permissao'
  | 'permissao-segundo-plano'
  | 'guia'
  | 'escolher-pulseira'
  | 'avisar-administrador';

export interface ReadinessStep {
  id: ReadinessStepId;
  obrigatorio: boolean;
  /** `null` é "não sabido ainda". */
  pendente: boolean | null;
  acao: ReadinessAction;
}

const permitted = (
  availability: HealthConnectAvailability | null,
  permission: HealthConnectState['permission'] | undefined,
): boolean | null => {
  if (availability === null) return null;
  // Sem Health Connect no aparelho não há leitura permitida.
  if (availability !== 'available') return false;
  if (permission == null) return null;
  return permission === 'granted';
};

export function readinessFactsOf(sources: ReadinessSources): ReadinessFacts {
  const hc = sources.healthConnect;
  const availability = hc?.availability ?? null;
  const birthDate = sources.profile?.birthDate;
  return {
    paired: sources.paired,
    healthConnectAvailability: availability,
    readGranted: permitted(availability, hc?.permission),
    backgroundGranted: permitted(availability, hc?.backgroundPermission),
    manufacturerPackage: hc?.bandPackage ?? null,
    bandChosen: sources.bandChoice === undefined ? null : sources.bandChoice !== null,
    hasBirthDate: sources.profile === null ? null : (birthDate ?? '').trim() !== '',
  };
}

const unlessUnknown = <T>(fact: T | null, pending: (known: T) => boolean): boolean | null =>
  fact === null ? null : pending(fact);

/**
 * Os passos na ordem: parear, instalar ou atualizar o Health Connect,
 * permitir a leitura, permitir em segundo plano, app do fabricante
 * (opcional), pulseira por Bluetooth (opcional, só com o gate dela), data de
 * nascimento no cadastro.
 */
export function readinessStepsOf(
  facts: ReadinessFacts,
  options: { bluetooth?: boolean } = {},
): ReadinessStep[] {
  const steps: ReadinessStep[] = [
    { id: 'PAIR', obrigatorio: true, pendente: unlessUnknown(facts.paired, (p) => !p), acao: 'parear' },
    {
      id: 'HEALTH_CONNECT_INSTALL',
      obrigatorio: true,
      pendente: unlessUnknown(facts.healthConnectAvailability, (a) => a !== 'available'),
      acao: 'play-store',
    },
    {
      id: 'HEALTH_CONNECT_READ',
      obrigatorio: true,
      pendente: unlessUnknown(facts.readGranted, (g) => !g),
      acao: 'permissao',
    },
    {
      id: 'HEALTH_CONNECT_BACKGROUND',
      obrigatorio: true,
      pendente: unlessUnknown(facts.backgroundGranted, (g) => !g),
      acao: 'permissao-segundo-plano',
    },
    {
      id: 'MANUFACTURER_APP',
      obrigatorio: false,
      pendente: facts.healthConnectAvailability === null ? null : facts.manufacturerPackage === null,
      acao: 'guia',
    },
    {
      id: 'BLUETOOTH_BAND',
      obrigatorio: false,
      pendente: unlessUnknown(facts.bandChosen, (c) => !c),
      acao: 'escolher-pulseira',
    },
    {
      id: 'BIRTH_DATE',
      obrigatorio: true,
      pendente: unlessUnknown(facts.hasBirthDate, (h) => !h),
      acao: 'avisar-administrador',
    },
  ];
  return options.bluetooth === false ? steps.filter((s) => s.id !== 'BLUETOOTH_BAND') : steps;
}

export const READINESS_COPY = {
  titulo: 'Para o monitoramento funcionar',
  opcional: 'Opcional',
  passos: {
    PAIR: { titulo: 'Parear o celular', acao: 'Parear aparelho' },
    HEALTH_CONNECT_INSTALL: { titulo: HEALTH_CONNECT_FIRST_USE_COPY.instalar, acao: 'Abrir a Play Store' },
    HEALTH_CONNECT_READ: { titulo: HEALTH_CONNECT_FIRST_USE_COPY.ler, acao: 'Permitir leitura' },
    HEALTH_CONNECT_BACKGROUND: {
      titulo: HEALTH_CONNECT_FIRST_USE_COPY.segundoPlano,
      acao: 'Abrir os ajustes do Health Connect',
    },
    MANUFACTURER_APP: { titulo: 'Ligar o envio no app do fabricante', acao: 'Guia da pulseira' },
    BLUETOOTH_BAND: { titulo: 'Escolher a pulseira por Bluetooth', acao: 'Escolher a pulseira' },
    BIRTH_DATE: { titulo: 'Data de nascimento no cadastro', acao: 'Avise o administrador' },
  },
  // Esforço e desgaste dependem da idade; sem a data, o problema é do
  // cadastro, não da pulseira.
  semNascimento: 'Esforço e desgaste dependem da data de nascimento no seu cadastro.',
} as const satisfies {
  passos: Record<ReadinessStepId, { titulo: string; acao: string }>;
} & Record<string, unknown>;
