import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { readStoredSession } from '../auth/storedSession';
import { getPositionRuntime } from '../positions/positionTracking';
import { ensureEvacuationChannel } from './evacuationChannel';
import { PUSH_TASK_NAME } from './evacuationPush';
import { createPushTaskHandler } from './pushTask';

/**
 * Com o app aberto: a notificação com texto (o início da evacuação) aparece e
 * toca como com o app fechado. A só de dados (o fim) não tem o que mostrar.
 */
export async function presentInForeground(
  notification: Notifications.Notification,
): Promise<Notifications.NotificationBehavior> {
  const { title, body } = notification.request.content;
  const visible = Boolean(title || body);
  return {
    shouldShowBanner: visible,
    shouldShowList: visible,
    shouldPlaySound: visible,
    shouldSetBadge: false,
  };
}

const warn = (what: string) => (e: unknown) =>
  console.warn(`[push] ${what}: ${(e as Error)?.message}`);

/**
 * Prepara o push na abertura do bundle: o handler do app aberto, o canal da
 * evacuação e a tarefa que recebe o push em segundo plano. Precisa rodar no
 * carregamento, como a tarefa do GPS: quando o sistema acorda o app só para
 * entregar um push, nenhuma tela é montada. Por isso é chamada pela entrada
 * do app (index.js).
 */
export function setupPushNotifications(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({ handleNotification: presentInForeground });
  ensureEvacuationChannel().catch(warn('canal da evacuação'));

  const { tracking, evacuation } = getPositionRuntime();
  const { handle } = createPushTaskHandler({
    async readSession() {
      const stored = await readStoredSession();
      return stored ? { userId: stored.user.id } : null;
    },
    readEvacuation: () => evacuation.read(),
    tracking,
    isForeground: () => AppState.currentState === 'active',
  });
  TaskManager.defineTask(PUSH_TASK_NAME, async ({ data, error }) => {
    if (error) return;
    try {
      await handle(data);
    } catch (e) {
      warn('push não tratado')(e);
    }
  });
  Notifications.registerTaskAsync(PUSH_TASK_NAME).catch(warn('tarefa do push'));
}
