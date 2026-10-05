import { randomUUID } from 'node:crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { JourneyController } from './journey.controller'
import type { JourneyService } from './journey.service'

// Toda rota da jornada é do próprio trabalhador: o id vem do token e nunca de
// parâmetro. O controller ainda traduz "tarefa que não é sua" em 404, e não em
// corpo nulo: o serviço devolve null tanto para inexistente quanto para alheia,
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

    await c.startTask('u1', 't1', {})
    await c.completeTask('u1', 't1', {})
    await c.cancelTask('u1', 't1', {})
    await c.pause('u1', {})
    await c.resume('u1', {})
    await c.end('u1', {})

    // Sem cabeçalho e sem corpo (o app instalado): nada além do autor.
    const plain = { key: undefined, occurredAt: undefined, sentAt: undefined }
    expect(s.startTask).toHaveBeenCalledWith('u1', 't1', plain)
    expect(s.completeTask).toHaveBeenCalledWith('u1', 't1', plain)
    expect(s.cancelTask).toHaveBeenCalledWith('u1', 't1', plain)
    expect(s.pauseJourney).toHaveBeenCalledWith('u1', plain)
    expect(s.resumeJourney).toHaveBeenCalledWith('u1', plain)
    expect(s.endJourney).toHaveBeenCalledWith('u1', plain)
  })

  // A fila offline do app manda a chave do envio, a hora do toque (corpo) e a
  // hora do envio (cabeçalho). O controller só lê e repassa.
  it('as seis ações repassam a chave, a hora do toque e a hora do envio', async () => {
    const s = service()
    const c = new JourneyController(s)
    const key = randomUUID()
    const dto = { occurredAt: '2026-10-04T14:00:00.000Z' }
    const sentAt = '2026-10-04T14:30:00.000Z'

    await c.startTask('u1', 't1', dto, key.toUpperCase(), sentAt)
    await c.completeTask('u1', 't1', dto, key, sentAt)
    await c.cancelTask('u1', 't1', dto, key, sentAt)
    await c.pause('u1', dto, key, sentAt)
    await c.resume('u1', dto, key, sentAt)
    await c.end('u1', dto, key, sentAt)

    const send = { key, occurredAt: dto.occurredAt, sentAt }
    expect(s.startTask).toHaveBeenCalledWith('u1', 't1', send) // chave normalizada em minúsculas
    expect(s.completeTask).toHaveBeenCalledWith('u1', 't1', send)
    expect(s.cancelTask).toHaveBeenCalledWith('u1', 't1', send)
    expect(s.pauseJourney).toHaveBeenCalledWith('u1', send)
    expect(s.resumeJourney).toHaveBeenCalledWith('u1', send)
    expect(s.endJourney).toHaveBeenCalledWith('u1', send)
  })

  it('chave de envio fora do formato é 400 e a ação não roda', () => {
    const s = service()
    expect(() => new JourneyController(s).end('u1', {}, 'nao-e-uuid')).toThrow(BadRequestException)
    expect(s.endJourney).not.toHaveBeenCalled()
  })

  it('foto da tarefa entrega só a chave do objeto, não o DTO inteiro', async () => {
    const s = service()
    await new JourneyController(s).addPhoto('u1', 't1', { imageKey: 'task/abc.jpg' })
    expect(s.addTaskPhoto).toHaveBeenCalledWith('u1', 't1', 'task/abc.jpg')
  })
})
