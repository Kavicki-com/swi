// Formulário de tarefa — serve /tasks/new (criar) e /tasks/:id/edit (editar).
// describe/it/expect/beforeEach vêm dos globals do Vitest.
//
// O client de work orders e o de upload são mockados inteiros: o contrato deles
// já é coberto em services/api/*.test.ts. Aqui interessa o comportamento da
// tela — validação, forma do payload (as armadilhas do PATCH), upload no
// submit e navegação. O ResponsiblePicker roda de verdade: a integração
// pai↔overlay (remontagem, ids devolvidos) é parte do que se está provando.
import { vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { ApiError } from '@/services/api/http'
import type { AssignableWorker, WorkOrderDetail } from '@/services/api/workOrders'
import { seedSession, clearSession } from '@/test-utils/renderPage'
import { TaskForm } from './TaskForm'

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

const CARLOS: AssignableWorker = {
  id: 'w_1',
  name: 'Carlos Silva',
  jobTitle: 'Técnico',
  sector: 'Setor Leste',
  birthDate: '1994-07-22T00:00:00.000Z',
  avatar: '',
}

const MARIA: AssignableWorker = {
  id: 'w_2',
  name: 'Maria Souza',
  jobTitle: 'Engenheira',
  sector: 'Setor Norte',
  birthDate: null,
  avatar: '',
}

function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: 'wo_7',
    title: 'Manutenção da esteira',
    summary: 'Resumo existente',
    details: 'Detalhes existentes',
    sector: 'Setor Norte',
    estimatedMinutes: 90,
    // ISO datetime, como o backend devolve — NÃO data de calendário.
    startDate: '2026-07-20T00:00:00.000Z',
    dueDate: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    status: 'in_progress',
    progressPct: 30,
    author: { name: 'Admin', avatar: '' },
    responsibles: [CARLOS],
    items: [{ id: 'it_1', title: 'Item 1', description: 'Desc 1', status: 'pending' }],
    images: [],
    ...overrides,
  }
}

// Sonda de rota: prova PRA QUAL tarefa o form navegou depois de salvar.
function TaskDetailsProbe() {
  const { id } = useParams<{ id: string }>()
  return <div data-testid="task-details-route">{id}</div>
}

function renderAt(route: string) {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/tasks" element={<div data-testid="tasks-route" />} />
            <Route path="/tasks/new" element={<TaskForm />} />
            <Route path="/tasks/:id/edit" element={<TaskForm />} />
            <Route path="/tasks/:id" element={<TaskDetailsProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

// Abre o overlay, marca um trabalhador e confirma.
async function pickResponsible(name: string, sector: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis' }))
  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: `Selecionar ${name}, ${sector}` })).toBeVisible()
  })
  fireEvent.click(screen.getByRole('checkbox', { name: `Selecionar ${name}, ${sector}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
  await waitFor(() => {
    expect(screen.queryByTestId('responsible-picker')).not.toBeInTheDocument()
  })
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }))
}

function jpeg(name = 'foto.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

// Promise controlada pelo teste — pra segurar uma request em voo e escolher o
// instante exato em que ela resolve.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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

describe('TaskForm — criação', () => {
  it('exige o título antes de chamar o backend', async () => {
    renderAt('/tasks/new')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/título/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('exige ao menos 1 responsável antes de chamar o backend', async () => {
    renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent(/responsável/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('com o Check List desligado, o payload NÃO traz a chave items', async () => {
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    // `id: ''` cairia silenciosamente em criação — a chave não pode existir.
    expect(payload.items[0]).not.toHaveProperty('id')
  })

  // Na criação nada está travado: o toggle liga e desliga a seção normalmente.
  it('o toggle liga e desliga a seção do Check List', async () => {
    renderAt('/tasks/new')

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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('task-details-route')).toHaveTextContent('wo_new')
    })
  })

  // O save fica em voo enquanto o usuário desiste e sai. Quando a resposta
  // chega, navegar pro detalhe arrastaria ele de volta pra uma tela que ele
  // abandonou de propósito — e o clique dele no Cancelar viraria um piscar.
  it('não navega pro detalhe quando o save resolve depois de o usuário sair', async () => {
    const pending = deferred<WorkOrderDetail>()
    createMock.mockReturnValue(pending.promise)
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
describe('TaskForm — limites do DTO', () => {
  it('barra título acima de 200 caracteres com mensagem em pt', async () => {
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
    typeIn('task-title', 'a'.repeat(200))
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
  })

  it('barra resumo acima de 1000 caracteres', async () => {
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
  // uma tarefa que já está no teto e acrescentar mais um card — o backend nunca
  // devolveria 51, mas 50 + o "+" chega lá.
  it('barra mais de 50 itens no Check List', async () => {
    getMock.mockResolvedValue(
      detail({
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `it_${i}`,
          title: `Item ${i}`,
          description: '',
          status: 'pending' as const,
        })),
      }),
    )
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/new')
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

describe('TaskForm — acessibilidade', () => {
  // O `label` do Input do DS é visual puro: não associa nem serve de fallback.
  // Sem accessibilityLabel explícito, estes campos ficam sem nome nenhum.
  it('todo campo tem nome acessível', async () => {
    renderAt('/tasks/new')

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
    renderAt('/tasks/new')

    save()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/título/i)
    })
  })
})

describe('TaskForm — anexos', () => {
  it('só sobe o arquivo no submit e manda a key em imageKeys', async () => {
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
    typeIn('task-title', 'Trocar filtro')
    await pickResponsible('Carlos Silva', 'Setor Leste')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).not.toHaveProperty('imageKeys')
  })
})

describe('TaskForm — responsáveis', () => {
  // O react-native-web desta versão não emite aria-checked, então a remontagem
  // se prova pelo observável: reabrir e marcar MAIS alguém tem que somar à
  // seleção anterior. Com o picker reaproveitado (sem `key`), a semente ficaria
  // presa no valor da primeira montagem — [] — e Carlos sumiria do payload.
  it('reabrir o picker parte da seleção já confirmada em vez de zerá-la', async () => {
    renderAt('/tasks/new')
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
    renderAt('/tasks/new')
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

describe('TaskForm — edição', () => {
  it('pré-carrega a tarefa e manda os itens COM id no PATCH', async () => {
    renderAt('/tasks/wo_7/edit')

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
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/wo_7/edit')
    await waitFor(() => expect(screen.getByTestId('checklist-title-0')).toBeInTheDocument())

    expect(screen.getByTestId('checklist-locked-hint')).toHaveTextContent(
      /ao menos 1 item.*remover.*item/i,
    )
  })

  it('o PATCH continua mandando os itens quando o toggle está travado', async () => {
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/wo_7/edit')
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
          { id: 'it_1', title: 'Item 1', description: 'Desc 1', status: 'pending' },
          { id: 'it_2', title: 'Item 2', description: 'Desc 2', status: 'pending' },
        ],
      }),
    )
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/wo_7/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveValue('Manutenção da esteira')
    })

    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]?.[1].sector).toBe('Setor Alfa')
  })

  it('navega pro detalhe depois de salvar a edição', async () => {
    renderAt('/tasks/wo_7/edit')
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
    renderAt('/tasks/wo_7/edit')

    await waitFor(() => {
      expect(screen.getByTestId('task-form-error')).toHaveTextContent('Tarefa não encontrada')
    })
  })
})
