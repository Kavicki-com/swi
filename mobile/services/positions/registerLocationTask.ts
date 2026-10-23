import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import {
  createLocationHandler,
  LOCATION_TASK_NAME,
  type TaskLocation,
} from './backgroundLocationTask';
import { getPositionRuntime } from './positionTracking';
import { getEvacuationBackend } from '../evacuation/getEvacuationBackend';

/**
 * Se há evacuação ativa, para a tarefa saber do encerramento com o app em
 * segundo plano. Falha de rede é "não sei", e a evacuação gravada segue.
 */
async function evacuationActive(): Promise<boolean | null> {
  try {
    return (await getEvacuationBackend().getActive()) !== null;
  } catch {
    return null;
  }
}

/**
 * Define a tarefa do GPS em segundo plano. Precisa rodar no carregamento do
 * bundle, antes de qualquer tela: quando o sistema relança o app só para
 * entregar leituras, nenhuma rota é montada, e uma tarefa definida dentro de
 * uma tela não existiria nesse processo. Por isso é chamada pela entrada do
 * app (index.js), e não pelo `_layout`.
 */
export function registerLocationTask(): void {
  if (Platform.OS === 'web') return;
  const { outbox, window, evacuation, drainer, tracking } = getPositionRuntime();
  const { handle, reset } = createLocationHandler({
    window,
    evacuation,
    outbox,
    drainer,
    stopUpdates: () => tracking.halt(),
    evacuationActive,
    now: () => new Date(),
  });
  // Rastreio desligado (fim da jornada ou da evacuação, logout, 12 h): quem
  // começar a seguir não herda o espaçamento medido contra o último ponto.
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
