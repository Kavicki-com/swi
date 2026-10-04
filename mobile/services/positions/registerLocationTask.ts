import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import {
  createLocationHandler,
  LOCATION_TASK_NAME,
  type TaskLocation,
} from './backgroundLocationTask';
import { getPositionRuntime } from './positionTracking';

/**
 * Define a tarefa do GPS em segundo plano. Precisa rodar no carregamento do
 * bundle, antes de qualquer tela: quando o sistema relança o app só para
 * entregar leituras, nenhuma rota é montada, e uma tarefa definida dentro de
 * uma tela não existiria nesse processo. Por isso é chamada pela entrada do
 * app (index.js), e não pelo `_layout`.
 */
export function registerLocationTask(): void {
  if (Platform.OS === 'web') return;
  const { outbox, window, drainer, tracking } = getPositionRuntime();
  const { handle, reset } = createLocationHandler({
    window,
    outbox,
    drainer,
    stopUpdates: () => tracking.halt(),
    now: () => new Date(),
  });
  // Rastreio desligado (fim da jornada, logout, 12 h): quem começar a seguir
  // não herda o espaçamento medido contra o último ponto de antes.
  tracking.subscribe(() => {
    if (!tracking.isActive()) reset();
  });
  TaskManager.defineTask<{ locations?: TaskLocation[] }>(
    LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error || !data?.locations) return;
      try {
        await handle(data.locations);
      } catch (e) {
        console.warn(`[locationTask] leitura não tratada: ${(e as Error)?.message}`);
      }
    },
  );
}
