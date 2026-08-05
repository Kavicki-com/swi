import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { apiJourneyBackend } from './apiJourneyBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }));

describe('apiJourneyBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); (uploadImage as jest.Mock).mockReset(); });

  it('getJourney → GET /journey', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 });
    const out = await apiJourneyBackend.getJourney();
    expect(apiRequest).toHaveBeenCalledWith('/journey', { auth: true });
    expect(out.state).toBe('idle');
  });

  it('listTasks → GET /journey/tasks', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 't1' }]);
    const out = await apiJourneyBackend.listTasks();
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks', { auth: true });
    expect(out[0].id).toBe('t1');
  });

  it('getTask 404 → null; não-404 propaga', async () => {
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    expect(await apiJourneyBackend.getTask('x')).toBeNull();
    (apiRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await expect(apiJourneyBackend.getTask('x')).rejects.toThrow('boom');
  });

  it('startTask → POST /journey/tasks/:id/start', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ journey: { state: 'ongoing' }, task: { id: 't1' } });
    await apiJourneyBackend.startTask('t1');
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/start', { method: 'POST', auth: true });
  });

  it('completeTask → POST /journey/tasks/:id/complete', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ journey: { state: 'ongoing' }, task: { id: 't1' } });
    await apiJourneyBackend.completeTask('t1');
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/complete', { method: 'POST', auth: true });
  });

  it('cancelTask → POST /journey/tasks/:id/cancel', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ journey: { state: 'ongoing' }, task: { id: 't1' } });
    await apiJourneyBackend.cancelTask('t1');
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/cancel', { method: 'POST', auth: true });
  });

  it('pause/resume/end → POST sem corpo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ state: 'paused' });
    await apiJourneyBackend.pauseJourney();
    expect(apiRequest).toHaveBeenCalledWith('/journey/pause', { method: 'POST', auth: true });
    await apiJourneyBackend.resumeJourney();
    expect(apiRequest).toHaveBeenCalledWith('/journey/resume', { method: 'POST', auth: true });
    await apiJourneyBackend.endJourney();
    expect(apiRequest).toHaveBeenCalledWith('/journey/end', { method: 'POST', auth: true });
  });

  it('addTaskPhoto: sobe a imagem (prefixo task) e POSTa a key', async () => {
    (uploadImage as jest.Mock).mockResolvedValue('task/k.jpg');
    (apiRequest as jest.Mock).mockResolvedValue({ id: 't1' });
    await apiJourneyBackend.addTaskPhoto('t1', 'file:///a/b.jpg');
    expect(uploadImage).toHaveBeenCalledWith('file:///a/b.jpg', 'task');
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/photo', { method: 'POST', body: { imageKey: 'task/k.jpg' }, auth: true });
  });
});
