// src/pages/tasks/TaskForm.attachments.test.tsx
// Anexos: upload no submit, teto de 20 por tarefa e a forma de imageKeys
// no POST e no PATCH.
//
// Fixtures e helpers em ./TaskForm.testKit. Os mocks ficam aqui porque
// vi.mock é içado por arquivo.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ApiError } from '@/services/api/http'
import { clearSession } from '@/test-utils/renderPage'
import { CARLOS, MARIA, detail, renderAt, typeIn, pickResponsible, save, jpeg } from './TaskForm.testKit'

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

describe('TaskForm — anexos', () => {
  it('só sobe o arquivo no submit e manda a key em imageKeys', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    const file = jpeg()
    fireEvent.change(screen.getByTestId('task-file-input'), { target: { files: [file] } })

    // O presign vale 300 s: subir na seleção faria um form lento estourar o TTL.
    expect(uploadMock).not.toHaveBeenCalled()

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledWith(file)
    expect(createMock.mock.calls[0]?.[0].imageKeys).toEqual(['order/aaa.jpg'])
  })

  it('acumula os arquivos escolhidos em seleções separadas', async () => {
    uploadMock.mockResolvedValueOnce('order/a.jpg').mockResolvedValueOnce('order/b.png')
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    const input = screen.getByTestId('task-file-input')
    fireEvent.change(input, { target: { files: [jpeg('a.jpg')] } })
    fireEvent.change(input, { target: { files: [jpeg('b.png')] } })

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(createMock.mock.calls[0]?.[0].imageKeys).toEqual(['order/a.jpg', 'order/b.png'])
  })

  it('falha de upload mostra o erro e NÃO cria a tarefa', async () => {
    uploadMock.mockRejectedValue(
      new ApiError('O link de envio expirou. Selecione o arquivo novamente.', 403),
    )
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')
    fireEvent.change(screen.getByTestId('task-file-input'), { target: { files: [jpeg()] } })

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent('O link de envio expirou')
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  // ArrayMaxSize(20) em imageKeys. Sem teto no cliente, escolher 25 arquivos num
  // diálogo só fazia 25 uploads SEQUENCIAIS pro S3 e o backend rejeitava depois
  // — os 25 já tinham subido e viravam órfãos no bucket, sem tarefa nenhuma
  // referenciando as keys. Diferente da falha de rede (rara), isto é trivial.
  it('recusa mais de 20 anexos sem subir NENHUM arquivo', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    const many = Array.from({ length: 25 }, (_, i) => jpeg(`foto_${i}.jpg`))
    fireEvent.change(screen.getByTestId('task-file-input'), { target: { files: many } })

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(
        'Anexe no máximo 20 arquivos por tarefa.',
      )
    })
    // O teto vale na SELEÇÃO: nada subiu e nada ficou pendurado pro submit.
    expect(uploadMock).not.toHaveBeenCalled()

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).not.toHaveBeenCalled()
    expect(createMock.mock.calls[0]?.[0]).not.toHaveProperty('imageKeys')
  })

  it('recusa a seleção que ESTOURA o teto somada aos anexos já escolhidos', async () => {
    await renderAt('/tasks/new')
    const input = screen.getByTestId('task-file-input')

    const first = Array.from({ length: 18 }, (_, i) => jpeg(`a_${i}.jpg`))
    fireEvent.change(input, { target: { files: first } })
    // 18 + 3 = 21, um acima do teto: a segunda seleção inteira é recusada.
    fireEvent.change(input, { target: { files: [jpeg('b1.jpg'), jpeg('b2.jpg'), jpeg('b3.jpg')] } })

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/no máximo 20 arquivos/i)
    })
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('aceita exatamente 20 anexos', async () => {
    uploadMock.mockImplementation(async (f: File) => `order/${f.name}`)
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    const twenty = Array.from({ length: 20 }, (_, i) => jpeg(`foto_${i}.jpg`))
    fireEvent.change(screen.getByTestId('task-file-input'), { target: { files: twenty } })

    expect(screen.queryByTestId('task-form-error')).not.toBeInTheDocument()

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(20)
    expect(createMock.mock.calls[0]?.[0].imageKeys).toHaveLength(20)
  })

  it('sem anexo, o payload não traz imageKeys', async () => {
    await renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).not.toHaveProperty('imageKeys')
  })
})

describe('TaskForm — anexos na edição (imageKeys no detail)', () => {
  it('uploader ativo na edição: anexo novo vai no PATCH junto das keys existentes', async () => {
    getMock.mockResolvedValue(
      detail({ images: ['signed:order/a.jpg'], imageKeys: ['order/a.jpg'] }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })
    // O aviso de edição travada não existe mais.
    expect(screen.queryByText('Anexos não podem ser alterados na edição.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('task-file-input'), { target: { files: [jpeg()] } })
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    // Keys existentes reenviadas + a nova no fim (PATCH substitui o array inteiro).
    expect(updateMock.mock.calls[0]?.[1].imageKeys).toEqual(['order/a.jpg', 'order/aaa.jpg'])
  })

  it('remover um anexo existente o tira do PATCH', async () => {
    getMock.mockResolvedValue(
      detail({
        images: ['signed:order/a.jpg', 'signed:order/b.png'],
        imageKeys: ['order/a.jpg', 'order/b.png'],
      }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remover anexo 1' }))
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1].imageKeys).toEqual(['order/b.png'])
  })

  it('remover um arquivo recém-escolhido o tira do upload e do PATCH', async () => {
    uploadMock.mockImplementation(async (f: File) => `order/${f.name}`)
    getMock.mockResolvedValue(detail({ images: [], imageKeys: [] }))
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    const input = screen.getByTestId('task-file-input')
    fireEvent.change(input, { target: { files: [jpeg('um.jpg'), jpeg('dois.jpg')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo um.jpg' }))
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0]?.[1].imageKeys).toEqual(['order/dois.jpg'])
  })

  it('sem mexer em anexos, o PATCH NÃO traz imageKeys (não reescreve à toa)', async () => {
    getMock.mockResolvedValue(
      detail({ images: ['signed:order/a.jpg'], imageKeys: ['order/a.jpg'] }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1]).not.toHaveProperty('imageKeys')
  })

  it('o teto de 20 conta os anexos que já existem na tarefa', async () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => `order/k_${i}.jpg`)
    getMock.mockResolvedValue(
      detail({ images: nineteen.map((k) => `signed:${k}`), imageKeys: nineteen }),
    )
    await renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    // 19 existentes + 2 novos = 21 → recusa a seleção inteira.
    fireEvent.change(screen.getByTestId('task-file-input'), {
      target: { files: [jpeg('x1.jpg'), jpeg('x2.jpg')] },
    })
    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/no máximo 20 arquivos/i)
    })
    expect(uploadMock).not.toHaveBeenCalled()
  })
})
