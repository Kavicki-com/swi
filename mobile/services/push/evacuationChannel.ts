import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { EVACUATION_CHANNEL_ID } from './evacuationPush';

// O canal do Android para o push da evacuação. O backend manda o início com
// `channelId: 'evacuation'`, e no Android 8 ou mais novo uma notificação com
// canal que não existe no aparelho não aparece. Por isso o canal é criado na
// abertura do app (index.js), antes de qualquer push, e de novo antes do
// pedido de permissão: no Android 13 ou mais novo o pedido só aparece depois
// de existir um canal.
//
// Importância alta: aparece por cima da tela e toca. Depois de criado, o
// Android só deixa mudar o nome e a descrição; o resto fica com a pessoa nos
// ajustes do sistema.

const EVACUATION_CHANNEL: Notifications.NotificationChannelInput = {
  name: 'Evacuação',
  description: 'Aviso de evacuação iniciada pela equipe de segurança.',
  importance: Notifications.AndroidImportance.HIGH,
  sound: 'default',
  enableVibrate: true,
  vibrationPattern: [0, 500, 250, 500],
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
};

let creating: Promise<void> | null = null;

/** Cria o canal uma vez por processo. Falhou, a próxima chamada tenta de novo. */
export function ensureEvacuationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  creating ??= Notifications.setNotificationChannelAsync(EVACUATION_CHANNEL_ID, EVACUATION_CHANNEL).then(
    () => undefined,
    (error: unknown) => {
      creating = null;
      throw error;
    },
  );
  return creating;
}

/** Só para os testes: esquece o canal criado. */
export function resetEvacuationChannelForTest(): void {
  creating = null;
}
