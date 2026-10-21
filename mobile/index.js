// Entrada do app. Existe para definir as tarefas de segundo plano no
// carregamento do bundle: quando o sistema relança o app apenas para uma
// delas (entregar leituras do GPS, ou rodar a leitura do Health Connect pelo
// WorkManager), nenhuma tela é montada, e a tarefa precisa existir mesmo
// assim. As definições são síncronas e acontecem antes de qualquer execução,
// que chega depois, pelo lado nativo. A do Health Connect só é definida no
// Android com o gate `healthConnect`.
// O `expo-router/entry` vem primeiro: ele carrega o runtime do Metro, que
// precisa ser o primeiro módulo do bundle.
import 'expo-router/entry';
import { registerLocationTask } from './services/positions/registerLocationTask';
import { defineHealthConnectTask } from './services/telemetry/healthConnect/healthConnectBackgroundTask';

registerLocationTask();
defineHealthConnectTask();
