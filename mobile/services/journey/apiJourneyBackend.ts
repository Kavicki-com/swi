import type { JourneyBackend, JourneySend, JourneySession, Task } from './types';
import { apiRequest, type ApiRequestOptions } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// As ações vindas da fila levam a hora do toque no corpo e a chave do item, os
// dois iguais em toda tentativa, e a hora do envio, nova a cada tentativa: o
// backend aplica a ação na hora do toque e uma vez só. Sem `send` a ação vale
// na hora em que chega.
function actionRequest(send?: JourneySend): ApiRequestOptions {
  if (!send) return { method: 'POST', auth: true };
  return {
    method: 'POST',
    auth: true,
    body: { occurredAt: send.occurredAt },
    idempotencyKey: send.idempotencyKey,
    sentAt: new Date().toISOString(),
  };
}

type TaskResult = { journey: JourneySession; task: Task };

// O backend já devolve o shape mobile pronto (URLs presigned, ISO), então sem fromApi.
// Mirrors services/reports/apiReportsBackend.ts.
export const apiJourneyBackend: JourneyBackend = {
  getJourney() {
    return apiRequest<JourneySession>('/journey', { auth: true });
  },
  listTasks() {
    return apiRequest<Task[]>('/journey/tasks', { auth: true });
  },
  async getTask(id) {
    try {
      return await apiRequest<Task>(`/journey/tasks/${id}`, { auth: true });
    } catch (e) {
      if ((e as any).status === 404) return null; // 404 esperado; 500/rede propaga
      throw e;
    }
  },
  startTask(taskId, send) {
    return apiRequest<TaskResult>(`/journey/tasks/${taskId}/start`, actionRequest(send));
  },
  completeTask(taskId, send) {
    return apiRequest<TaskResult>(`/journey/tasks/${taskId}/complete`, actionRequest(send));
  },
  cancelTask(taskId, send) {
    return apiRequest<TaskResult>(`/journey/tasks/${taskId}/cancel`, actionRequest(send));
  },
  pauseJourney(send) {
    return apiRequest<JourneySession>('/journey/pause', actionRequest(send));
  },
  resumeJourney(send) {
    return apiRequest<JourneySession>('/journey/resume', actionRequest(send));
  },
  endJourney(send) {
    return apiRequest<JourneySession>('/journey/end', actionRequest(send));
  },
  uploadImage(localUri) {
    return uploadImage(localUri, 'task');
  },
  addTaskPhoto(taskId, imageKey) {
    return apiRequest<Task>(`/journey/tasks/${taskId}/photo`, { method: 'POST', body: { imageKey }, auth: true });
  },
};
