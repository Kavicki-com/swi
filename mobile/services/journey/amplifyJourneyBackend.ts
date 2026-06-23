import { generateClient } from 'aws-amplify/data';
import type { JourneyBackend, JourneySession, Task } from './types';

// Backend amplify deploy-gated pra slice Jornada/Tarefas. Mirrors
// services/reports/amplifyReportsBackend.ts: um client untyped mantém o mobile
// isolado do Schema do swi-backend. NÃO há Schema gerado / amplify_outputs.json
// ainda (sem conta AWS), então os métodos throw até o deploy da Phase 6 fiar o
// client tipado. O ponto: isto typechecks e getJourneyBackend consegue importá-lo;
// o path mock-flag nunca o chama.
const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyJourneyBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyJourneyBackend: JourneyBackend = {
  async getJourney(): Promise<JourneySession> { void client; throw NOT_READY('getJourney'); },
  async listTasks(): Promise<Task[]> { throw NOT_READY('listTasks'); },
  async getTask(id: string): Promise<Task | null> { void id; throw NOT_READY('getTask'); },
  async startTask(taskId: string) { void taskId; throw NOT_READY('startTask'); },
  async pauseJourney() { throw NOT_READY('pauseJourney'); },
  async resumeJourney() { throw NOT_READY('resumeJourney'); },
  async endJourney() { throw NOT_READY('endJourney'); },
  async addTaskPhoto(taskId: string, uri: string) { void taskId; void uri; throw NOT_READY('addTaskPhoto'); },
};
