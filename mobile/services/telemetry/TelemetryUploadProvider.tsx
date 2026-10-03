import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { useAuth } from '../auth/AuthProvider';
import { useTelemetryUpload, type TelemetryUploadState } from './useTelemetryUpload';

// O envio da telemetria ao backend, montado na raiz do app para não depender
// de tela aberta. Liga com sessão aberta dentro do piloto do Apple Watch (só
// iOS compilado); a credencial do aparelho é relida no login e quando a tela
// de pareamento avisa que concluiu. Com o 401 o envio para e o estado volta a
// não pareado, até um novo pareamento.

export interface TelemetryUploadContextValue extends TelemetryUploadState {
  /** A tela de pareamento chama ao concluir: o envio relê a credencial. */
  refreshPairing: () => void;
}

const FORA_DO_PROVIDER: TelemetryUploadContextValue = {
  paired: false,
  lastOutcome: null,
  refreshPairing: () => undefined,
};

const TelemetryUploadContext = createContext<TelemetryUploadContextValue>(FORA_DO_PROVIDER);

export function TelemetryUploadProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [recheckKey, setRecheckKey] = useState(0);
  const enabled = user != null && isFeatureEnabled('appleWatchPilot');
  const state = useTelemetryUpload(undefined, undefined, { enabled, recheckKey });
  const refreshPairing = useCallback(() => setRecheckKey((k) => k + 1), []);
  const value = useMemo(
    () => ({ paired: state.paired, lastOutcome: state.lastOutcome, refreshPairing }),
    [state.paired, state.lastOutcome, refreshPairing],
  );
  return <TelemetryUploadContext.Provider value={value}>{children}</TelemetryUploadContext.Provider>;
}

export function useTelemetryUploadState(): TelemetryUploadContextValue {
  return useContext(TelemetryUploadContext);
}
