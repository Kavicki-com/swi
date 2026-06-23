import { mockJourneyBackend } from './mockJourneyBackend';

describe('mockJourneyBackend', () => {
  it('listTasks retorna as tarefas semeadas (pending)', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]).toHaveProperty('title');
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });
  it('getTask retorna a tarefa com objetivo/estimado para id conhecido', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const found = await mockJourneyBackend.getTask(first.id);
    expect(found).not.toBeNull();
    expect((found?.objective ?? '').length).toBeGreaterThan(0);
    expect(found?.estimatedMinutes).toBeGreaterThan(0);
  });
  it('getTask retorna null para id desconhecido', async () => {
    expect(await mockJourneyBackend.getTask('inexistente')).toBeNull();
  });
  it('getJourney começa idle', async () => {
    const j = await mockJourneyBackend.getJourney();
    expect(j.state).toBe('idle');
    expect(j.activeTaskId).toBeNull();
  });
  it('startTask liga a jornada e marca a task in_progress', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const { journey, task } = await mockJourneyBackend.startTask(first.id);
    expect(journey.state).toBe('ongoing');
    expect(journey.activeTaskId).toBe(first.id);
    expect(task.status).toBe('in_progress');
  });
  it('pause→resume→end transita a jornada e zera no fim', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    await mockJourneyBackend.startTask(first.id);
    expect((await mockJourneyBackend.pauseJourney()).state).toBe('paused');
    expect((await mockJourneyBackend.resumeJourney()).state).toBe('ongoing');
    const ended = await mockJourneyBackend.endJourney();
    expect(ended.state).toBe('idle');
    expect(ended.activeTaskId).toBeNull();
  });
  it('endJourney zera o relógio do turno (não vaza pro próximo)', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    await mockJourneyBackend.startTask(first.id);
    const ended = await mockJourneyBackend.endJourney();
    expect(ended.state).toBe('idle');
    expect(ended.accumulatedSeconds).toBe(0); // turno seguinte começa do zero
  });
  it('addTaskPhoto anexa a uri à task', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const updated = await mockJourneyBackend.addTaskPhoto(first.id, 'file:///foto.jpg');
    expect(updated.images).toContain('file:///foto.jpg');
  });
});
