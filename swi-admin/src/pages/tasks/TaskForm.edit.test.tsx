// src/pages/tasks/TaskForm.edit.test.tsx
// Edição de tarefa: pré-carga do detalhe, itens com id no PATCH e o Check
// List travado numa tarefa que já tem itens.
//
// Fixtures e helpers em ./TaskForm.testKit. Os mocks ficam aqui porque
// vi.mock é içado por arquivo.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiError } from '@/services/api/http'
import { clearSession } from '@/test-utils/renderPage'
import { CARLOS, MARIA, detail, renderAt, save } from './TaskForm.testKit'

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

describe('TaskForm — edição', () => {
  it('pré-carrega a tarefa e manda os itens COM id no PATCH', async () => {
    await renderAt('/tasks/wo_7/edit')

    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })
    expect(screen.getByTestId('task-summary')).toHaveValue('Resumo existente')
    expect(screen.getByTestId('checklist-title-0')).toHaveValue('Item 1')
    expect(getMock).toHaveBeenCalledWith('wo_7')

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[0]).toBe('wo_7')
    const payload = updateMock.mock.calls[0]?.[1]
    // Sem o id o backend CRIA um item novo em vez de atualizar o existente.
    expect(payload.items).toEqual([{ id: 'it_1', title: 'Item 1', description: 'Desc 1' }])
    expect(payload.responsibleIds).toEqual(['w_1'])
    // O PATCH substitui imageKeys inteiro e o detalhe devolve URL assinada (não
    // key): mandar qualquer coisa aqui apagaria os anexos existentes.
    expect(payload).not.toHaveProperty('imageKeys')
  })

  it('converte as datas ISO do detalhe para AAAA-MM-DD no PATCH', async () => {
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    const payload = updateMock.mock.calls[0]?.[1]
    // Devolver o ISO cru dá 400 (@IsCalendarDate).
    expect(payload.startDate).toBe('2026-07-20')
    expect(payload.dueDate).toBe('2026-07-21')
  })

  // O backend NÃO aceita items: [] (400, 'a tarefa precisa de pelo menos 1
  // item') e omitir a chave deixa o checklist intocado. Ou seja: não existe
  // forma de esvaziar o checklist de uma tarefa que já tem itens. Antes o
  // toggle sumia com a seção, o usuário salvava e o Check List reaparecia
  // intacto no detalhe — a UI oferecia uma ação que o contrato não executa.
  it('numa tarefa que já tem itens, o toggle não desliga o Check List', async () => {
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))

    // A seção continua no ar: o clique não tem efeito nenhum.
    expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument()
    // O Toggle do DS é um div[role=switch]; o estado desabilitado sai em
    // aria-disabled (toBeDisabled só enxerga elemento de formulário nativo).
    expect(screen.getByRole('switch', { name: 'Check List' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('explica por que o Check List não pode ser desligado na edição', async () => {
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())

    expect(screen.getByTestId('checklist-locked-hint')).toHaveTextContent(
      /ao menos 1 item.*remover.*item/i,
    )
  })

  it('o PATCH continua mandando os itens quando o toggle está travado', async () => {
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('switch', { name: 'Check List' }))
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1].items).toEqual([
      { id: 'it_1', title: 'Item 1', description: 'Desc 1' },
    ])
  })

  // Caminho defensivo: o backend garante ≥1 item, mas se um detalhe chegar sem
  // itens o form não trava nada e o PATCH segue omitindo a chave `items`.
  it('tarefa sem itens não trava o toggle e o PATCH omite items', async () => {
    getMock.mockResolvedValue(detail({ items: [] }))
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    expect(screen.getByRole('switch', { name: 'Check List' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByTestId('checklist-locked-hint')).not.toBeInTheDocument()

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1]).not.toHaveProperty('items')
  })

  // Item ausente da lista do PATCH = apagado (contrato de reconciliação). É o
  // único caminho pra remover um item de uma tarefa que já existe.
  it('remover um card existente o apaga no PATCH (some da lista de items)', async () => {
    getMock.mockResolvedValue(
      detail({
        items: [
          {
            id: 'it_1',
            title: 'Item 1',
            description: 'Desc 1',
            status: 'pending',
            startedAt: null,
            accumulatedSeconds: 0,
            estimatedMinutes: null,
          },
          {
            id: 'it_2',
            title: 'Item 2',
            description: 'Desc 2',
            status: 'pending',
            startedAt: null,
            accumulatedSeconds: 0,
            estimatedMinutes: null,
          },
        ],
      }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-1')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Remover item 1 do Check List' }))
    await waitFor(() => expect(screen.queryByTestId('checklist-title-1')).not.toBeInTheDocument())

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1].items).toEqual([
      { id: 'it_2', title: 'Item 2', description: 'Desc 2' },
    ])
  })

  it('preserva um setor que não está na lista provisória', async () => {
    getMock.mockResolvedValue(detail({ sector: 'Setor Alfa' }))
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1].sector).toBe('Setor Alfa')
  })

  it('navega pro detalhe depois de salvar a edição', async () => {
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-details-route')).toHaveTextContent('wo_7')
    })
  })

  it('mostra a mensagem do ApiError quando a carga inicial falha', async () => {
    getMock.mockRejectedValue(new ApiError('Tarefa não encontrada', 404))
    await renderAt('/tasks/wo_7/edit')

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent('Tarefa não encontrada')
    })
  })
})
