// Entrada do app. Existe só para definir a tarefa do GPS em segundo plano no
// carregamento do bundle: quando o sistema relança o app apenas para entregar
// leituras de localização, nenhuma tela é montada, e a tarefa precisa existir
// mesmo assim. A definição é síncrona e acontece antes de qualquer entrega,
// que chega depois, pelo emissor de eventos nativo.
// O `expo-router/entry` vem primeiro: ele carrega o runtime do Metro, que
// precisa ser o primeiro módulo do bundle.
import 'expo-router/entry';
import { registerLocationTask } from './services/positions/registerLocationTask';

registerLocationTask();
