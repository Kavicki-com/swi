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

// Contrato de ambiente resolvido em tempo de execução. As funções abaixo o
// recebem por parâmetro em vez de ler globais, para serem puras e testáveis.
export interface RuntimeEnv {
  /** `__DEV__` do React Native: bundle de desenvolvimento. */
  readonly isDev: boolean;
  /** `NODE_ENV=test`: suíte Jest. */
  readonly isTest: boolean;
  /**
   * Escotilha de demonstração. Permite dados simulados fora de dev, para
   * apresentar o app sem backend no ar. Documentada em `.env.example` e ausente
   * de todos os perfis de release do `eas.json`.
   */
  readonly allowDemoMocks: boolean;
}

/** Ambientes onde dados simulados e localhost são legítimos. */
export function isRelaxedEnv(env: RuntimeEnv): boolean {
  return env.isDev || env.isTest || env.allowDemoMocks;
}

/**
 * "Este web é o build entregue, ou uma ferramenta de trabalho?"
 *
 * O produto web suportado na entrega é o painel administrativo. O Expo web é
 * restrito ao desenvolvimento e não faz parte do aplicativo entregue ao usuário.
 *
 * O corte vale só no build de release, e por isso reusa `isRelaxedEnv`: em dev,
 * sob a suíte e com a escotilha de demonstração, o app web continua inteiro.
 * Sem essa ressalva o smoke E2E de navegador (mobile/e2e/web-smoke.spec.ts),
 * que é o que exercita o app fora do Jest, passaria a testar a página de aviso.
 *
 * Recebe a plataforma por parâmetro em vez de ler `Platform.OS` para continuar
 * pura, como as demais funções deste arquivo.
 */
export function deveMostrarAvisoWeb(platformOS: string, env: RuntimeEnv): boolean {
  return platformOS === 'web' && !isRelaxedEnv(env);
}

/** Trata variável ausente e variável em branco como a mesma coisa. */
function readEnvFlag(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function resolveBackendKind(
  raw: string | undefined,
  env: RuntimeEnv,
  varName: string,
): 'mock' | 'api' {
  const value = readEnvFlag(raw);
  if (value !== undefined && value !== 'mock' && value !== 'api') {
    throw new Error(
      `${varName} tem valor desconhecido "${value}". Use "api" ou "mock".`,
    );
  }
  // Fora de dev, teste e demonstração explícita, a API real é a única fonte:
  // nem a ausência da variável nem um "mock" herdado de um perfil antigo podem
  // colocar dados fabricados na frente do usuário final.
  if (!isRelaxedEnv(env)) return 'api';
  return value ?? 'mock';
}

// Seleciona a fonte de dados dos domínios NÃO-SAÚDE (profile, reports, journey,
// chat, notifications, weather, evacuation, positions). 'api' = backend real
// conteinerizado (NestJS), padrão fora de dev e teste. 'mock' = demo in-memory,
// honrado apenas em dev, teste ou com a escotilha de demonstração. Saúde
// (vitals/telemetry) IGNORA esta flag até a smartband existir: os vitais seguem
// simulados em todos os ambientes por decisão de produto. Setada no build/dev
// via EXPO_PUBLIC_DATA_BACKEND.
export type DataBackendKind = 'mock' | 'api';

export function resolveDataBackend(
  raw: string | undefined,
  env: RuntimeEnv,
): DataBackendKind {
  return resolveBackendKind(raw, env, 'EXPO_PUBLIC_DATA_BACKEND');
}

// Chave PRÓPRIA do auth, independente de DATA_BACKEND: permite o auth ir no
// backend real (container) enquanto os outros domínios seguem em mock durante o
// desenvolvimento. Fora de dev e teste vale a mesma regra: sempre 'api'.
// Setada no build via EXPO_PUBLIC_AUTH_BACKEND (ver eas.json perfil `qa`).
export type AuthBackendKind = 'mock' | 'api';

export function resolveAuthBackend(
  raw: string | undefined,
  env: RuntimeEnv,
): AuthBackendKind {
  return resolveBackendKind(raw, env, 'EXPO_PUBLIC_AUTH_BACKEND');
}

// `process.env.EXPO_PUBLIC_*` precisa aparecer literalmente: o Babel do Expo
// substitui a expressão inteira pelo valor no bundle, e um acesso dinâmico
// resolveria para undefined em produção.
export const RUNTIME_ENV: RuntimeEnv = {
  isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  isTest: process.env.NODE_ENV === 'test',
  allowDemoMocks: process.env.EXPO_PUBLIC_ALLOW_DEMO_MOCKS === '1',
};

export const DATA_BACKEND: DataBackendKind = resolveDataBackend(
  process.env.EXPO_PUBLIC_DATA_BACKEND,
  RUNTIME_ENV,
);

export const AUTH_BACKEND: AuthBackendKind = resolveAuthBackend(
  process.env.EXPO_PUBLIC_AUTH_BACKEND,
  RUNTIME_ENV,
);

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
