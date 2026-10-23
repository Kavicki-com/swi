import { AppState, Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import {
  createLocationHandler,
  LOCATION_TASK_NAME,
  type ActiveEvacuationCheck,
  type TaskLocation,
} from './backgroundLocationTask';
import { getPositionRuntime } from './positionTracking';
import { getEvacuationBackend } from '../evacuation/getEvacuationBackend';
import { reportActiveEvacuation } from '../evacuation/evacuationEnd';

/**
 * A evacuação ativa, para a tarefa saber do começo e do encerramento com o
 * app em segundo plano. Falha de rede é "não sei", e nada muda.
 */
async function activeEvacuation(): Promise<ActiveEvacuationCheck> {
  try {
    const active = await getEvacuationBackend().getActive();
    return active ? { evacuationId: active.id } : null;
  } catch {
    return 'unknown';
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
    activeEvacuation,
    // Com o app na frente a tarefa roda no mesmo processo da tela: o fim que
    // ela viu passa pelo controle, que põe as leituras de volta na jornada (ou
    // desliga) e a notificação fixa deixa de falar em evacuação. Em segundo
    // plano o Android pode recusar religar o serviço; ali fica para a volta ao
    // primeiro plano (useEvacuationTracking consulta e encerra). As telas de
    // evacuação ficam sabendo de qualquer jeito e saem do modo evacuação.
    onEvacuationEnded: () => {
      reportActiveEvacuation(null);
      if (AppState.currentState === 'active') void tracking.endEvacuation();
    },
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
