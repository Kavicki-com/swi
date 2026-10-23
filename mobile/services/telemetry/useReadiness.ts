import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { useProfile } from '../profile/ProfileProvider';
import {
  sharedBandChoiceStore,
  useBandChoice,
  type BandChoiceStore,
} from './bluetooth/bluetoothBandChoice';
import { openHealthConnectInPlayStore } from './healthConnect/playStore';
import { useHealthConnectRecheck } from './healthConnect/useHealthConnectRecheck';
import {
  readinessFactsOf,
  readinessStepsOf,
  type ReadinessAction,
  type ReadinessFacts,
  type ReadinessStep,
} from './readiness';
import { useTelemetryUploadState } from './TelemetryUploadProvider';

// A lista de prontidão ligada às fontes do app: o contexto do envio
// (pareamento e Health Connect), a pulseira escolhida e o perfil. Só no
// Android com o gate do Health Connect; quem chama decide isso.

export const READINESS_ROUTES = {
  parear: '/(onboarding)/watch/pairing?origem=configuracoes',
  guia: '/(app)/settings/band-guide',
  // A escolha da pulseira mora no Monitoramento, abaixo do Health Connect.
  escolherPulseira: '/(app)/settings/watch-diagnostics',
  // O formulário de Suporte chega ao administrador, que é quem corrige o
  // cadastro.
  avisarAdministrador: '/(app)/settings/support',
} as const;

// Sem o gate do Bluetooth não há escolha a ler: um armazenamento que nunca
// tem pulseira, para o hook não abrir o arquivo à toa.
export const SEM_BLUETOOTH: BandChoiceStore = {
  current: () => null,
  load: async () => null,
  choose: async () => undefined,
  subscribe: () => () => undefined,
};

export interface Readiness {
  facts: ReadinessFacts;
  steps: ReadinessStep[];
}

/**
 * Os fatos de agora, das mesmas fontes, sem conferir o Health Connect: é o
 * que o relato de prontidão ao backend lê (useReadinessReport.ts), montado
 * fora das telas da lista.
 */
export function useReadinessFacts(): ReadinessFacts {
  const bluetooth = isFeatureEnabled('bluetoothHeartRate');
  const { paired, healthConnect } = useTelemetryUploadState();
  const bandChoice = useBandChoice(bluetooth ? sharedBandChoiceStore() : SEM_BLUETOOTH);
  const { profile } = useProfile();
  return useMemo(
    () => readinessFactsOf({ paired, healthConnect, bandChoice, profile }),
    [paired, healthConnect, bandChoice, profile],
  );
}

/**
 * Os fatos e os passos de agora. Confere o Health Connect ao montar e a cada
 * volta ao primeiro plano: é na volta da Play Store ou dos ajustes que a
 * pessoa pode ter instalado, concedido ou revogado.
 */
export function useReadiness(): Readiness {
  const bluetooth = isFeatureEnabled('bluetoothHeartRate');
  const { checkHealthConnect } = useTelemetryUploadState();
  const facts = useReadinessFacts();
  useHealthConnectRecheck(checkHealthConnect);

  return useMemo(() => ({ facts, steps: readinessStepsOf(facts, { bluetooth }) }), [facts, bluetooth]);
}

/**
 * O que cada ação faz. `overrides` troca uma delas onde a tela já é o
 * destino (no Monitoramento, a escolha da pulseira está logo abaixo).
 */
export function useReadinessAction(
  overrides: Partial<Record<ReadinessAction, () => void>> = {},
): (acao: ReadinessAction) => void {
  const router = useRouter();
  const { requestHealthConnectPermission, openHealthConnectSettings } = useTelemetryUploadState();
  return (acao) => {
    const override = overrides[acao];
    if (override) return override();
    switch (acao) {
      case 'parear':
        return router.push(READINESS_ROUTES.parear);
      case 'play-store':
        return void openHealthConnectInPlayStore();
      case 'permissao':
        return void requestHealthConnectPermission();
      case 'permissao-segundo-plano':
        return openHealthConnectSettings();
      case 'guia':
        return router.push(READINESS_ROUTES.guia);
      case 'escolher-pulseira':
        return router.push(READINESS_ROUTES.escolherPulseira);
      case 'avisar-administrador':
        return router.push(READINESS_ROUTES.avisarAdministrador);
    }
  };
}
