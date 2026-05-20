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

// TEMP 2026-05-18 — habilitado pra revisar pixel fidelity das telas smartband
// e maps na web. Reverter pra `null` antes de commit/PR.
const MANUAL_OVERRIDE: boolean | null = true;

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
