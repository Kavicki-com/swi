// Entrada do app. Existe para definir as tarefas de segundo plano no
// carregamento do bundle: quando o sistema relança o app apenas para uma
// delas (entregar leituras do GPS, ou rodar a leitura do Health Connect pelo
// WorkManager), nenhuma tela é montada, e a tarefa precisa existir mesmo
// assim. As definições são síncronas e acontecem antes de qualquer execução,
// que chega depois, pelo lado nativo. A do Health Connect só é definida no
// Android com o gate `healthConnect`. A da pulseira por Bluetooth é uma
// tarefa sem interface que o serviço nativo acorda, também só no Android.
// A do push recebe a evacuação com o app em segundo plano ou fechado, e vem
// junto do canal do Android que o push do início pede (sem ele, a
// notificação não aparece).
// O `expo-router/entry` vem primeiro: ele carrega o runtime do Metro, que
// precisa ser o primeiro módulo do bundle.
import 'expo-router/entry';
import { registerLocationTask } from './services/positions/registerLocationTask';
import { defineHealthConnectTask } from './services/telemetry/healthConnect/healthConnectBackgroundTask';
import { registerBluetoothDrainTask } from './services/telemetry/bluetooth/registerBluetoothDrainTask';
import { setupPushNotifications } from './services/push/pushSetup';

registerLocationTask();
defineHealthConnectTask();
registerBluetoothDrainTask();
setupPushNotifications();
