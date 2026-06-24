// Temporary feature gating for the demo phase.
//
// `IS_PROD_BUILD` combines a manual override with Expo's runtime
// `executionEnvironment` detector. Set `MANUAL_OVERRIDE` to a boolean to
// force the value (useful when previewing the placeholder UX inside a
// real prod build, or temporarily unlocking a gate on the demo subdomain).
// When left as `null`, autodetect kicks in: anything other than Expo Go
// (`storeClient`) or web is treated as a real native build where the
// gated features are expected to work.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Autodetect: Expo Go → false (gates off, mostra placeholder). EAS dev
// client / standalone / bare → true (gates ligados). Pra forçar manualmente
// em web ou debug, troca pra `true`/`false` temporariamente.
const MANUAL_OVERRIDE: boolean | null = null;

function detectProdBuild(): boolean {
  if (Platform.OS === 'web') return false;
  const env = Constants.executionEnvironment;
  return env === 'standalone' || env === 'bare';
}

export const IS_PROD_BUILD: boolean =
  MANUAL_OVERRIDE !== null ? MANUAL_OVERRIDE : detectProdBuild();

export type FeatureGate =
  | 'smartbandOnboarding'
  | 'maps'
  | 'notifications'
  | 'smartwatch3d';

export const FEATURE_GATES: Record<FeatureGate, boolean> = {
  smartbandOnboarding: IS_PROD_BUILD,
  maps: IS_PROD_BUILD,
  notifications: IS_PROD_BUILD,
  smartwatch3d: IS_PROD_BUILD,
};

export function isFeatureEnabled(gate: FeatureGate): boolean {
  return FEATURE_GATES[gate];
}

// Seleciona a fonte de dados de TODOS os domínios (auth, profile, vitals,
// reports, journey, chat, notifications, weather, evacuation, telemetry).
// 'mock' = comportamento de demo in-memory (default; sem AWS). 'amplify' = real
// Cognito/AppSync via aws-amplify — flip pra isto depois que `ampx sandbox`
// gerar amplify_outputs (ver docs/plans/2026-06-22-swi-backend-auth-profile-design.md, Seção 6).
export type DataBackendKind = 'mock' | 'amplify';
export const DATA_BACKEND: DataBackendKind = 'mock';

// Dev-only: lets the mock vitals backend exercise the empty/loading/stale/error
// UIs that production will hit. 'streaming' = normal simulated data.
export type VitalsScenario = 'streaming' | 'empty' | 'loading' | 'stale' | 'error';
export const VITALS_SCENARIO: VitalsScenario = 'streaming';

// Dev-only: exercita os estados da fatia Clima no mock. 'alert' (default) traz
// um alerta vigente; 'normal' sem alerta; 'loading' nunca resolve; 'error' rejeita.
export type WeatherScenario = 'alert' | 'normal' | 'loading' | 'error';
export const WEATHER_SCENARIO: WeatherScenario = 'alert';

// Dev-only: exercita os estados da fatia Evacuação no mock. 'normal' (default)
// traz a rota canned; 'loading' nunca resolve; 'error' rejeita.
export type EvacuationScenario = 'normal' | 'loading' | 'error';
export const EVACUATION_SCENARIO: EvacuationScenario = 'normal';
