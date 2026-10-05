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
  it('a foto "sobe" como a própria uri e entra na tarefa uma vez só', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    const key = await mockJourneyBackend.uploadImage('file:///foto.jpg');
    expect(key).toBe('file:///foto.jpg');
    await mockJourneyBackend.addTaskPhoto(first.id, key);
    const updated = await mockJourneyBackend.addTaskPhoto(first.id, key);
    expect(updated.images.filter((uri) => uri === key)).toHaveLength(1);
  });
  it('seed carrega objective da ordem + responsáveis (novo contrato WorkOrder)', async () => {
    const [first] = await mockJourneyBackend.listTasks();
    expect(first.objective.length).toBeGreaterThan(0);
    expect(first.responsibleCount).toBeGreaterThan(0);
    expect(first.responsibleNames.length).toBeGreaterThan(0);
    expect(first.responsibleAvatars.length).toBeGreaterThan(0);
  });
  it('TODAS as tasks do checklist compartilham objective/responsáveis da MESMA ordem (não só a 1ª)', async () => {
    // As N tasks são o checklist de UMA WorkOrder → objective/responsible* idênticos.
    // Um seed que dessincronizasse um item passaria batido se só checasse tasks[0].
    const tasks = await mockJourneyBackend.listTasks();
    expect(tasks.length).toBeGreaterThan(1);
    const [first] = tasks;
    for (const t of tasks) {
      expect(t.objective).toBe(first.objective);
      expect(t.responsibleCount).toBe(first.responsibleCount);
      expect(t.responsibleNames).toEqual(first.responsibleNames);
      expect(t.responsibleAvatars).toEqual(first.responsibleAvatars);
      // Invariante index-parallel (espelha o backend após o fix #5).
      expect(t.responsibleAvatars.length).toBe(t.responsibleNames.length);
    }
  });
  it('completeTask conclui o item (done, 100%), libera a ativa e mantém o turno', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    const target = tasks[1];
    await mockJourneyBackend.startTask(target.id);
    const { journey, task } = await mockJourneyBackend.completeTask(target.id);
    expect(task.status).toBe('done');
    expect(task.progressPct).toBe(100);
    expect(journey.activeTaskId).toBeNull();
    expect(journey.state).toBe('ongoing'); // turno segue rodando
  });
  it('cancelTask volta o item pra pending preservando os segundos bancados e mantém o turno', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    const target = tasks[2];
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(2_000_000);
      await mockJourneyBackend.startTask(target.id);
      nowSpy.mockReturnValue(2_000_000 + 45_000); // +45s rodando
      const { journey, task } = await mockJourneyBackend.cancelTask(target.id);
      expect(task.status).toBe('pending');
      expect(task.accumulatedSeconds).toBe(45); // banked, não zerado
      expect(journey.activeTaskId).toBeNull();
      expect(journey.state).toBe('ongoing');
    } finally {
      nowSpy.mockRestore();
    }
  });
  it('endJourney deixa a task ativa pausada (não done) e zera o turno', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    const target = tasks[3];
    await mockJourneyBackend.startTask(target.id);
    const ended = await mockJourneyBackend.endJourney();
    expect(ended.state).toBe('idle');
    const after = await mockJourneyBackend.getTask(target.id);
    expect(after?.status).toBe('paused'); // Decision E: pausa, não conclui
  });

  // A ação vinda da fila vale na hora do toque, como no servidor.
  it('ação com a hora do toque vale nessa hora', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    const target = tasks[2];
    const occurredAt = '2026-10-04T12:00:00.000Z';
    const { task, journey } = await mockJourneyBackend.startTask(target.id, { idempotencyKey: 'k1', occurredAt });
    expect(task.startedAt).toBe(occurredAt);
    expect(journey.startedAt).toBe(occurredAt);
    await mockJourneyBackend.endJourney({ idempotencyKey: 'k2', occurredAt: '2026-10-04T12:01:00.000Z' });
    expect((await mockJourneyBackend.getTask(target.id))?.accumulatedSeconds).toBeGreaterThanOrEqual(60);
  });

  // Erros com status, como os da API: a fila descarta o item recusado em vez de
  // esperar 72 h por ele.
  it('iniciar ou cancelar tarefa concluída é recusado com 409', async () => {
    const tasks = await mockJourneyBackend.listTasks();
    const target = tasks[0];
    await mockJourneyBackend.completeTask(target.id);
    await expect(mockJourneyBackend.startTask(target.id)).rejects.toMatchObject({ status: 409, apiError: true });
    await expect(mockJourneyBackend.cancelTask(target.id)).rejects.toMatchObject({ status: 409, apiError: true });
    expect((await mockJourneyBackend.getTask(target.id))?.status).toBe('done');
  });

  it('tarefa desconhecida é recusada com 404', async () => {
    await expect(mockJourneyBackend.startTask('inexistente')).rejects.toMatchObject({ status: 404, apiError: true });
    await expect(mockJourneyBackend.completeTask('inexistente')).rejects.toMatchObject({ status: 404 });
    await expect(mockJourneyBackend.addTaskPhoto('inexistente', 'file:///x.jpg')).rejects.toMatchObject({ status: 404 });
  });
});
