import { NotFoundException } from '@nestjs/common'
import { JourneyController } from './journey.controller'
import type { JourneyService } from './journey.service'

// Toda rota da jornada é do próprio trabalhador: o id vem do token e nunca de
// parâmetro. O controller ainda traduz "tarefa que não é sua" em 404, e não em
// corpo nulo — o serviço devolve null tanto para inexistente quanto para alheia,
// e é aqui que isso vira resposta.

const service = () =>
  ({
    getJourney: jest.fn().mockResolvedValue({ state: 'idle' }),
    listTasks: jest.fn().mockResolvedValue([]),
    getTask: jest.fn().mockResolvedValue({ id: 't1' }),
    startTask: jest.fn().mockResolvedValue({ id: 't1' }),
    completeTask: jest.fn().mockResolvedValue({ id: 't1' }),
    cancelTask: jest.fn().mockResolvedValue({ id: 't1' }),
    pauseJourney: jest.fn().mockResolvedValue({ state: 'paused' }),
    resumeJourney: jest.fn().mockResolvedValue({ state: 'ongoing' }),
    endJourney: jest.fn().mockResolvedValue({ state: 'ended' }),
    addTaskPhoto: jest.fn().mockResolvedValue({ id: 't1' }),
  }) as unknown as jest.Mocked<JourneyService>

describe('JourneyController', () => {
  it('jornada e lista de tarefas saem do usuário do token', async () => {
    const s = service()
    const c = new JourneyController(s)

    await c.getJourney('u1')
    await c.listTasks('u1')

    expect(s.getJourney).toHaveBeenCalledWith('u1')
    expect(s.listTasks).toHaveBeenCalledWith('u1')
  })

  it('tarefa encontrada volta como está', async () => {
    const s = service()
    await expect(new JourneyController(s).getTask('u1', 't1')).resolves.toEqual({ id: 't1' })
    expect(s.getTask).toHaveBeenCalledWith('u1', 't1')
  })

  it('tarefa de outro (ou inexistente) vira 404', async () => {
    const s = service()
    s.getTask.mockResolvedValue(null)
    await expect(new JourneyController(s).getTask('u1', 't9')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('transições da tarefa e da jornada passam o autor do token', async () => {
    const s = service()
    const c = new JourneyController(s)

    await c.startTask('u1', 't1')
    await c.completeTask('u1', 't1')
    await c.cancelTask('u1', 't1')
    await c.pause('u1')
    await c.resume('u1')
    await c.end('u1')

    expect(s.startTask).toHaveBeenCalledWith('u1', 't1')
    expect(s.completeTask).toHaveBeenCalledWith('u1', 't1')
    expect(s.cancelTask).toHaveBeenCalledWith('u1', 't1')
    expect(s.pauseJourney).toHaveBeenCalledWith('u1')
    expect(s.resumeJourney).toHaveBeenCalledWith('u1')
    expect(s.endJourney).toHaveBeenCalledWith('u1')
  })

  it('foto da tarefa entrega só a chave do objeto, não o DTO inteiro', async () => {
    const s = service()
    await new JourneyController(s).addPhoto('u1', 't1', { imageKey: 'task/abc.jpg' })
    expect(s.addTaskPhoto).toHaveBeenCalledWith('u1', 't1', 'task/abc.jpg')
  })
})
