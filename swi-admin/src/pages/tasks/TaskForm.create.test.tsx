// src/pages/tasks/TaskForm.create.test.tsx
// Criação de tarefa: validação do formulário, limites do DTO, nome
// acessível dos campos e integração com o picker de responsáveis.
//
// Fixtures e helpers em ./TaskForm.testKit. Os mocks ficam aqui porque
// vi.mock é içado por arquivo.
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiError } from '@/services/api/http'
import type { WorkOrderDetail } from '@/services/api/workOrders'
import { clearSession } from '@/test-utils/renderPage'
import { CARLOS, MARIA, detail, renderAt, typeIn, pickResponsible, save, deferred } from './TaskForm.testKit'

const { createMock, updateMock, getMock, assignableMock, uploadMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  getMock: vi.fn(),
  assignableMock: vi.fn(),
  uploadMock: vi.fn(),
}))

vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: vi.fn(),
    get: getMock,
    create: createMock,
    update: updateMock,
    assignable: assignableMock,
  },
}))

vi.mock('@/services/api/upload', () => ({
  uploadOrderImage: uploadMock,
  MAX_UPLOAD_BYTES: 15 * 1024 * 1024,
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  getMock.mockReset()
  assignableMock.mockReset()
  uploadMock.mockReset()
  assignableMock.mockResolvedValue([CARLOS, MARIA])
  createMock.mockResolvedValue(detail({ id: 'wo_new' }))
  updateMock.mockResolvedValue(detail())
  getMock.mockResolvedValue(detail())
  uploadMock.mockResolvedValue('order/aaa.jpg')
})

afterEach(clearSession)

describe('TaskForm: criação', () => {
  it('exige o título antes de chamar o backend', async () => {
    await renderAt('/tasks/new')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/título/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('exige ao menos 1 responsável antes de chamar o backend', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/responsável/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('com o Check List desligado, o payload NÃO traz a chave items', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-summary', 'Resumo curto')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    // Omitir a chave é diferente de mandar []: [] o backend rejeita com 400.
    expect(payload).not.toHaveProperty('items')
    expect(payload).toMatchObject({
      title: 'Trocar filtro',
      summary: 'Resumo curto',
      responsibleIds: ['w_1'],
    })
  })

  it('com o Check List ligado, manda os itens preenchidos e sem id', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())
    typeIn('checklist-title-0', 'Desligar a máquina')
    typeIn('checklist-description-0', 'Chave geral')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    expect(payload.items).toEqual([{ title: 'Desligar a máquina', description: 'Chave geral' }])
    // `id: ''` cairia silenciosamente em criação, a chave não pode existir.
    expect(payload.items[0]).not.toHaveProperty('id')
  })

  // Na criação nada está travado: o toggle liga e desliga a seção normalmente.
  it('o toggle liga e desliga a seção do Check List', async () => {
    await renderAt('/tasks/new')

    expect(screen.getByRole('switch', { name: 'Check List' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByTestId('checklist-title-0')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.queryByTestId('checklist-title-0')).not.toBeInTheDocument())
    expect(screen.queryByTestId('checklist-locked-hint')).not.toBeInTheDocument()
  })

  it('o "+" acrescenta um card ao checklist e ambos vão no payload', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())
    typeIn('checklist-title-0', 'Primeiro')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item ao checklist' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-1')).toBeInTheDocument())
    typeIn('checklist-title-1', 'Segundo')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    expect(payload.items.map((i: { title: string }) => i.title)).toEqual(['Primeiro', 'Segundo'])
  })

  it('remover um card tira o item do payload', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())
    typeIn('checklist-title-0', 'Primeiro')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item ao checklist' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-1')).toBeInTheDocument())
    typeIn('checklist-title-1', 'Segundo')

    fireEvent.click(screen.getByRole('button', { name: 'Remover item 1 do Check List' }))
    await waitFor(() => expect(screen.queryByTestId('checklist-title-1')).not.toBeInTheDocument())

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0].items).toEqual([{ title: 'Segundo', description: '' }])
  })

  it('navega pro detalhe da tarefa criada', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-details-route')).toHaveTextContent('wo_new')
    })
  })

  // O save fica em voo enquanto o usuário desiste e sai. Quando a resposta
  // chega, navegar pro detalhe arrastaria ele de volta pra uma tela que ele
  // abandonou de propósito: e o clique dele no Cancelar viraria um piscar.
  it('não navega pro detalhe quando o save resolve depois de o usuário sair', async () => {
    const pending = deferred<WorkOrderDetail>()
    createMock.mockReturnValue(pending.promise)
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.getByTestId('tasks-route')).toBeInTheDocument())

    await act(async () => {
      pending.resolve(detail({ id: 'wo_new' }))
    })

    expect(screen.queryByTestId('task-details-route')).not.toBeInTheDocument()
    expect(screen.getByTestId('tasks-route')).toBeInTheDocument()
  })

  it('mostra o erro do backend sem perder o formulário preenchido', async () => {
    createMock.mockRejectedValue(new ApiError('Já existe uma tarefa com esse título', 409))
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-details-field', 'Detalhes digitados com esforço')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(
        'Já existe uma tarefa com esse título',
      )
    })
    expect(screen.getByTestId('task-title')).toHaveValue('Trocar filtro')
    expect(screen.getByTestId('task-details-field')).toHaveValue('Detalhes digitados com esforço')
    expect(screen.queryByTestId('task-details-route')).not.toBeInTheDocument()
  })

  it('converte a data digitada em dd/mm/aaaa para AAAA-MM-DD no payload', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-start-date', '05/03/2026')
    typeIn('task-due-date', '19/12/2026')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    expect(payload.startDate).toBe('2026-03-05')
    expect(payload.dueDate).toBe('2026-12-19')
  })

  // A regex de formato aceita 31/02; quem barra é a validação de calendário.
  // Sem ela isso viraria '2026-02-31' e um 400 genérico do backend.
  it('barra data que não existe no calendário antes de chamar o backend', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-due-date', '31/02/2026')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/datas válidas/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('converte o tempo estimado hh:mm em minutos', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-estimated-time', '02:30')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0].estimatedMinutes).toBe(150)
  })
})

// Os limites do CreateWorkOrderDto/UpdateWorkOrderDto (swi-backend/src/
// work-orders/dto.ts). Sem validação no cliente o class-validator respondia 400
// com o texto em inglês ('title must be shorter than or equal to 200
// characters'), que o form exibia cru dentro do role="alert".
describe('TaskForm: limites do DTO', () => {
  it('barra título acima de 200 caracteres com mensagem em pt', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'a'.repeat(201))
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(
        'O título da tarefa deve ter no máximo 200 caracteres.',
      )
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('aceita título exatamente no limite de 200', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'a'.repeat(200))
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
  })

  it('barra resumo acima de 1000 caracteres', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-summary', 'a'.repeat(1001))
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/resumo.*1000 caracteres/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('barra detalhes acima de 8000 caracteres', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    typeIn('task-details-field', 'a'.repeat(8001))
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/detalhes.*8000 caracteres/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  // Limite de ARRAY: ArrayMaxSize(50) em `items`. O caminho alcançável é editar
  // uma tarefa que já está no teto e acrescentar mais um card, o backend nunca
  // devolveria 51, mas 50 + o "+" chega lá.
  it('barra mais de 50 itens no Check List', async () => {
    getMock.mockResolvedValue(
      detail({
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `it_${i}`,
          title: `Item ${i}`,
          description: '',
          status: 'pending' as const,
          startedAt: null,
          accumulatedSeconds: 0,
          estimatedMinutes: null,
        })),
      }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-49')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item ao checklist' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-50')).toBeInTheDocument())
    typeIn('checklist-title-50', 'O quinquagésimo primeiro')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(
        'O Check List deve ter no máximo 50 itens.',
      )
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('barra título de item do Check List acima de 200 caracteres', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())
    typeIn('checklist-title-0', 'a'.repeat(201))

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(
        /item do Check List.*200 caracteres/i,
      )
    })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('TaskForm: acessibilidade', () => {
  // O `label` do Input do DS é visual puro: não associa nem serve de fallback.
  // Sem accessibilityLabel explícito, estes campos ficam sem nome nenhum.
  it('todo campo tem nome acessível', async () => {
    await renderAt('/tasks/new')

    for (const name of [
      'Título da tarefa',
      'Resumo da tarefa',
      'Detalhes da tarefa',
      'Tempo estimado',
      'Data de início',
      'Data de conclusão',
    ]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
  })

  it('a mensagem de erro é anunciada como alerta', async () => {
    await renderAt('/tasks/new')

    save()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/título/i)
    })
  })
})

describe('TaskForm: responsáveis', () => {
  // O react-native-web desta versão não emite aria-checked, então a remontagem
  // se prova pelo observável: reabrir e marcar MAIS alguém tem que somar à
  // seleção anterior. Com o picker reaproveitado (sem `key`), a semente ficaria
  // presa no valor da primeira montagem, [], e Carlos sumiria do payload.
  it('reabrir o picker parte da seleção já confirmada em vez de zerá-la', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis' }))
    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: 'Selecionar Maria Souza, Setor Norte' }),
      ).toBeVisible()
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Maria Souza, Setor Norte' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0].responsibleIds).toEqual(['w_1', 'w_2'])
  })

  it('cancelar o picker preserva a seleção anterior', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis' }))
    await waitFor(() => expect(screen.getByTestId('responsible-picker')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar seleção' }))
    await waitFor(() => expect(screen.queryByTestId('responsible-picker')).not.toBeInTheDocument())

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0].responsibleIds).toEqual(['w_1'])
  })
})
