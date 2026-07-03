import type { JourneyBackend, JourneySession, Task } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

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
  startTask(taskId) {
    return apiRequest<{ journey: JourneySession; task: Task }>(`/journey/tasks/${taskId}/start`, { method: 'POST', auth: true });
  },
  pauseJourney() {
    return apiRequest<JourneySession>('/journey/pause', { method: 'POST', auth: true });
  },
  resumeJourney() {
    return apiRequest<JourneySession>('/journey/resume', { method: 'POST', auth: true });
  },
  endJourney() {
    return apiRequest<JourneySession>('/journey/end', { method: 'POST', auth: true });
  },
  async addTaskPhoto(taskId, uri) {
    const imageKey = await uploadImage(uri, 'task');
    return apiRequest<Task>(`/journey/tasks/${taskId}/photo`, { method: 'POST', body: { imageKey }, auth: true });
  },
};
