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

  // A fila de envios: a chave e a hora do toque vão iguais em toda tentativa, a
  // hora do envio é a de cada tentativa.
  describe('com o envio da fila', () => {
    const send = { idempotencyKey: 'chave-1', occurredAt: '2026-10-04T12:00:00.000Z' };

    afterEach(() => jest.useRealTimers());

    it('ação de tarefa manda a hora do toque no corpo, a chave e a hora do envio', async () => {
      jest.useFakeTimers({ now: Date.parse('2026-10-04T12:00:07.000Z') });
      (apiRequest as jest.Mock).mockResolvedValue({ journey: { state: 'ongoing' }, task: { id: 't1' } });
      await apiJourneyBackend.startTask('t1', send);
      expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/start', {
        method: 'POST',
        auth: true,
        body: { occurredAt: '2026-10-04T12:00:00.000Z' },
        idempotencyKey: 'chave-1',
        sentAt: '2026-10-04T12:00:07.000Z',
      });
    });

    it('cada tentativa leva a hora do envio dela e o mesmo corpo', async () => {
      (apiRequest as jest.Mock).mockResolvedValue({ state: 'paused' });
      jest.useFakeTimers({ now: Date.parse('2026-10-04T12:00:07.000Z') });
      await apiJourneyBackend.pauseJourney(send);
      jest.setSystemTime(Date.parse('2026-10-04T15:30:00.000Z'));
      await apiJourneyBackend.pauseJourney(send);

      const [first, second] = (apiRequest as jest.Mock).mock.calls.map((call) => call[1]);
      expect(first.sentAt).toBe('2026-10-04T12:00:07.000Z');
      expect(second.sentAt).toBe('2026-10-04T15:30:00.000Z');
      expect(second.body).toEqual(first.body);
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
    });

    it('as seis ações vão para as rotas delas', async () => {
      (apiRequest as jest.Mock).mockResolvedValue({});
      await apiJourneyBackend.completeTask('t1', send);
      await apiJourneyBackend.cancelTask('t1', send);
      await apiJourneyBackend.resumeJourney(send);
      await apiJourneyBackend.endJourney(send);
      const paths = (apiRequest as jest.Mock).mock.calls.map((call) => call[0]);
      expect(paths).toEqual([
        '/journey/tasks/t1/complete',
        '/journey/tasks/t1/cancel',
        '/journey/resume',
        '/journey/end',
      ]);
      for (const call of (apiRequest as jest.Mock).mock.calls) {
        expect(call[1]).toMatchObject({ body: { occurredAt: send.occurredAt }, idempotencyKey: 'chave-1' });
      }
    });
  });

  it('uploadImage sobe a foto com o prefixo task e devolve a key', async () => {
    (uploadImage as jest.Mock).mockResolvedValue('task/k.jpg');
    expect(await apiJourneyBackend.uploadImage('file:///a/b.jpg')).toBe('task/k.jpg');
    expect(uploadImage).toHaveBeenCalledWith('file:///a/b.jpg', 'task');
  });

  it('addTaskPhoto POSTa a key já enviada, sem subir de novo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 't1' });
    await apiJourneyBackend.addTaskPhoto('t1', 'task/k.jpg');
    expect(uploadImage).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith('/journey/tasks/t1/photo', { method: 'POST', body: { imageKey: 'task/k.jpg' }, auth: true });
  });
});
