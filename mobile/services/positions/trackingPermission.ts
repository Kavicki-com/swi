import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

// Permissões do rastreio, pedidas ao iniciar a jornada, em dois tempos.
//
// Antes de iniciar: a de uso, que costuma já ter sido dada na abertura do app
// (LocationProvider), e aí o pedido volta sem mostrar nada. No Android 13 ou
// mais novo, também a de notificação: sem ela o serviço em primeiro plano
// roda, mas a notificação fixa não aparece na barra.
//
// Depois de iniciar, só no iPhone: o "Sempre". Sem ele o rastreio segue em
// segundo plano enquanto o app não for encerrado. No Android o serviço em
// primeiro plano dispensa o "o tempo todo", e ele não é pedido.

export type TrackingPermission = 'granted' | 'denied' | 'unsupported';

/** Primeira versão do Android em que notificação exige permissão. */
const ANDROID_NOTIFICATION_PERMISSION_API = 33;

export async function requestTrackingPermission(
  os: typeof Platform.OS = Platform.OS,
  androidApi: number | string = Platform.Version,
): Promise<TrackingPermission> {
  if (os === 'web') return 'unsupported';
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return 'denied';
  } catch {
    return 'denied';
  }
  if (os === 'android' && Number(androidApi) >= ANDROID_NOTIFICATION_PERMISSION_API) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    } catch {
      // Negada ou com falha, o rastreio liga do mesmo jeito.
    }
  }
  return 'granted';
}

/**
 * O "Sempre" do iPhone. Fica fora do caminho de iniciar a jornada: para quem
 * já respondeu, o sistema não mostra nada e o pedido só volta depois de um
 * prazo, e o botão de iniciar não pode esperar por isso.
 */
export async function requestAlwaysPermission(
  os: typeof Platform.OS = Platform.OS,
): Promise<void> {
  if (os !== 'ios') return;
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    // Sem o "Sempre" o rastreio segue com a permissão de uso.
  }
}
