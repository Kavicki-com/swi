import { Linking } from 'react-native';

// A página do Health Connect na Play Store, o caminho de quem não o tem ou o
// tem desatualizado. Um lugar só para o passo do pareamento
// (HealthConnectPairingStep.tsx) e o Monitoramento em Configurações
// (HealthConnectMonitoring.tsx): os dois botões abrem o mesmo link, com o
// mesmo plano B.

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';
const PLAY_STORE_APP = `market://details?id=${HEALTH_CONNECT_PACKAGE}`;
const PLAY_STORE_WEB = `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`;

/**
 * Abre o Health Connect na Play Store. O link do market só abre com o app da
 * Play Store no aparelho; sem ele, a mesma página no navegador. Sem nenhum
 * dos dois não há o que fazer, e a pessoa segue pela tela (o Continuar do
 * pareamento, a TopBar do Monitoramento).
 *
 * A promessa termina quando as tentativas terminam e NUNCA rejeita: os
 * botões a ignoram com `void`, e quem quiser esperar (os testes) espera sem
 * precisar de `catch`.
 */
export function openHealthConnectInPlayStore(): Promise<void> {
  return Linking.openURL(PLAY_STORE_APP)
    .catch(() => Linking.openURL(PLAY_STORE_WEB))
    .then(
      () => undefined,
      () => undefined,
    );
}
