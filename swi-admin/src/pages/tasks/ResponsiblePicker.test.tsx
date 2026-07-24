// Overlay de seleção de responsáveis (Figma 1614-13773). describe/it/expect
// vêm dos globals do Vitest.
//
// O client de work orders é mockado inteiro: o contrato já é coberto em
// services/api/workOrders.test.ts; aqui interessa o comportamento do overlay
// (seleção local, busca client-side, estados, o que chega no onConfirm).
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { ApiError } from '@/services/api/http'
import type { AssignableWorker } from '@/services/api/workOrders'
import { ResponsiblePicker } from './ResponsiblePicker'

const { assignableMock } = vi.hoisted(() => ({ assignableMock: vi.fn() }))
vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    assignable: assignableMock,
  },
}))

// birthDate chega ISO datetime (o backend materializa a data de calendário
// como meia-noite UTC) — ver comentário do contrato em workOrders.ts.
const ANA: AssignableWorker = {
  id: 'w_1',
  name: 'Ana Souza',
  jobTitle: 'Administradora de Sistema',
  sector: 'Engenharia Civil',
  birthDate: '1994-03-10T00:00:00.000Z',
  avatar: 'https://cdn.test/ana.png',
}

// Aniversário no dia SEGUINTE ao "hoje" congelado: 31, não 32.
const BRUNO: AssignableWorker = {
  id: 'w_2',
  name: 'Bruno Lima',
  jobTitle: 'Segurança do trabalho',
  sector: 'Técnico',
  birthDate: '1994-07-22T00:00:00.000Z',
  avatar: '',
}

const CARLA: AssignableWorker = {
  id: 'w_3',
  name: 'Carla Dias',
  jobTitle: 'Engenheira Civil',
  sector: 'Setor Norte',
  birthDate: null,
  avatar: '',
}

// Homônimos de MESMO cargo: só o setor os distingue. O backend não impede dois
// trabalhadores de mesmo nome, e nome sozinho no label acessível produziria
// dois checkboxes indistinguíveis.
const CARLOS_LESTE: AssignableWorker = {
  id: 'w_4',
  name: 'Carlos Silva',
  jobTitle: 'Eletricista',
  sector: 'Setor Leste',
  birthDate: '1990-01-05T00:00:00.000Z',
  avatar: '',
}

const CARLOS_NORTE: AssignableWorker = {
  ...CARLOS_LESTE,
  id: 'w_5',
  sector: 'Setor Norte',
}

function renderPicker(
  props: {
    selectedIds?: string[]
    onConfirm?: (ids: string[]) => void
    onCancel?: () => void
  } = {},
) {
  return render(
    <SwiThemeProvider>
      <ResponsiblePicker
        selectedIds={props.selectedIds ?? []}
        onConfirm={props.onConfirm ?? vi.fn()}
        onCancel={props.onCancel ?? vi.fn()}
      />
    </SwiThemeProvider>,
  )
}

const search = () => screen.getByPlaceholderText('Pesquisar')
// O nome acessível qualifica a pessoa com o setor (ver homônimos abaixo).
const checkboxFor = (worker: AssignableWorker) =>
  screen.getByRole('checkbox', { name: `Selecionar ${worker.name}, ${worker.sector}` })

beforeEach(() => {
  assignableMock.mockReset()
  assignableMock.mockResolvedValue([ANA, BRUNO, CARLA])
  // "Hoje" congelado: a idade exibida não pode depender do dia em que a suíte
  // roda. shouldAdvanceTime mantém o waitFor do testing-library funcional.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ResponsiblePicker', () => {
  it('busca os atribuíveis ao montar e lista nome, cargo e setor', async () => {
    renderPicker()

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
    expect(assignableMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Administradora de Sistema')).toBeInTheDocument()
    // O backend não tem "formação"; o setor ocupa o lugar dela no layout.
    expect(screen.getByText('Engenharia Civil')).toBeInTheDocument()
  })

  // QA C2 (2026-07-24): em 1366×900 a lista estourava o viewport e o rodapé
  // Cancelar/Continuar ficava inalcançável (overlay sem scroll interno). A
  // lista vive num container ROLÁVEL próprio; header/busca/rodapé ficam fixos.
  it('as linhas ficam dentro do container rolável da lista (rodapé fora dele)', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
    const list = screen.getByTestId('responsible-picker-list')
    expect(list).toContainElement(screen.getByText('Ana Souza'))
    // O rodapé NÃO pode estar dentro do scroll — precisa ficar sempre visível.
    expect(list).not.toContainElement(
      screen.getByRole('button', { name: 'Confirmar responsáveis' }),
    )
  })

  it('calcula a idade a partir do birthDate ISO', async () => {
    renderPicker()

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
    expect(screen.getByText('32 anos')).toBeInTheDocument()
  })

  it('não conta o aniversário que ainda não chegou no ano corrente', async () => {
    renderPicker()

    await waitFor(() => expect(screen.getByText('Bruno Lima')).toBeInTheDocument())
    // Nasceu em 22/07; hoje é 21/07 — ainda tem 31.
    expect(screen.getByText('31 anos')).toBeInTheDocument()
  })

  it('mostra "Idade não informada" quando birthDate é null', async () => {
    renderPicker()

    await waitFor(() => expect(screen.getByText('Carla Dias')).toBeInTheDocument())
    expect(screen.getByText('Idade não informada')).toBeInTheDocument()
  })

  // O react-native-web desta versão não emite aria-checked (nem no Pressable
  // cru), então o estado marcado se prova pelo comportamento observável: o que
  // sai no "Continuar" sem que ninguém tenha clicado em nada.
  it('pré-marca quem já é responsável', async () => {
    const onConfirm = vi.fn()
    renderPicker({ selectedIds: ['w_2'], onConfirm })
    await waitFor(() => expect(screen.getByText('Bruno Lima')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledWith(['w_2'])
  })

  it('devolve os ids selecionados no "Continuar"', async () => {
    const onConfirm = vi.fn()
    renderPicker({ onConfirm })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))
    fireEvent.click(checkboxFor(CARLA))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(['w_1', 'w_3'])
  })

  it('marcar não comunica nada ao pai antes do "Continuar"', async () => {
    const onConfirm = vi.fn()
    renderPicker({ onConfirm })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('desmarcar tira o id da seleção, inclusive de quem veio pré-marcado', async () => {
    const onConfirm = vi.fn()
    renderPicker({ selectedIds: ['w_1', 'w_2'], onConfirm })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledWith(['w_2'])
  })

  it('"Cancelar" chama onCancel e não confirma nada', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderPicker({ onConfirm, onCancel })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar seleção' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('distingue homônimos pelo setor no nome acessível e seleciona o certo', async () => {
    const onConfirm = vi.fn()
    assignableMock.mockResolvedValue([CARLOS_LESTE, CARLOS_NORTE])
    renderPicker({ onConfirm })
    await waitFor(() => expect(screen.getAllByText('Carlos Silva')).toHaveLength(2))

    // Nome sozinho daria match múltiplo aqui — o setor é o que desempata.
    expect(
      screen.getByRole('checkbox', { name: 'Selecionar Carlos Silva, Setor Leste' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Carlos Silva, Setor Norte' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledWith(['w_5'])
  })

  it('a busca filtra por nome, sem nova chamada ao backend', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.change(search(), { target: { value: 'bru' } })

    await waitFor(() => expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument())
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
    expect(assignableMock).toHaveBeenCalledTimes(1)
  })

  it('a busca também filtra por cargo e por setor', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.change(search(), { target: { value: 'segurança' } })
    await waitFor(() => expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument())
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()

    fireEvent.change(search(), { target: { value: 'setor norte' } })
    await waitFor(() => expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument())
    expect(screen.getByText('Carla Dias')).toBeInTheDocument()
  })

  it('a seleção sobrevive ao filtro que esconde o selecionado', async () => {
    const onConfirm = vi.fn()
    renderPicker({ onConfirm })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))
    // Filtra de forma que Ana suma da lista renderizada.
    fireEvent.change(search(), { target: { value: 'bruno' } })
    await waitFor(() => expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument())

    fireEvent.click(checkboxFor(BRUNO))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledWith(['w_1', 'w_2'])
  })

  it('limpar a busca traz de volta o selecionado ainda marcado', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.click(checkboxFor(ANA))
    fireEvent.change(search(), { target: { value: 'bruno' } })
    await waitFor(() => expect(screen.queryByText('Ana Souza')).not.toBeInTheDocument())
    fireEvent.change(search(), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    // Ana voltou MARCADA: um clique nela agora desmarca e zera a seleção, o que
    // desabilita o CTA. Se tivesse voltado limpa, o clique marcaria e o CTA
    // seguiria habilitado.
    fireEvent.click(checkboxFor(ANA))

    expect(screen.getByRole('button', { name: 'Confirmar responsáveis' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('"Continuar" fica desabilitado com zero selecionados', async () => {
    const onConfirm = vi.fn()
    renderPicker({ onConfirm })
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    const confirm = screen.getByRole('button', { name: 'Confirmar responsáveis' })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(checkboxFor(ANA))
    expect(screen.getByRole('button', { name: 'Confirmar responsáveis' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('mostra o estado de carregando enquanto a busca não resolve', () => {
    assignableMock.mockReturnValue(new Promise(() => {}))
    renderPicker()

    expect(screen.getByTestId('responsible-picker-loading')).toBeInTheDocument()
  })

  // Os dois vazios têm textos diferentes de propósito ("não há ninguém" ≠ "sua
  // busca não achou ninguém"). Asserção no texto EXATO nos dois: com /nenhum/i
  // frouxo, inverter o ternário passaria despercebido.
  it('mostra o estado vazio quando não há atribuíveis', async () => {
    assignableMock.mockResolvedValue([])
    renderPicker()

    await waitFor(() =>
      expect(screen.getByTestId('responsible-picker-empty')).toHaveTextContent(
        'Nenhum responsável disponível para atribuição.',
      ),
    )
  })

  it('mostra o vazio de BUSCA quando o filtro não casa com ninguém', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    fireEvent.change(search(), { target: { value: 'zzz' } })

    await waitFor(() =>
      expect(screen.getByTestId('responsible-picker-empty')).toHaveTextContent(
        'Nenhum responsável encontrado para esta busca.',
      ),
    )
  })

  it('mostra a mensagem do ApiError e refaz a busca no "Tentar novamente"', async () => {
    assignableMock.mockRejectedValueOnce(new ApiError('Não foi possível conectar ao servidor', 0))
    assignableMock.mockResolvedValueOnce([ANA, BRUNO, CARLA])
    renderPicker()

    await waitFor(() =>
      expect(screen.getByTestId('responsible-picker-error')).toHaveTextContent(
        'Não foi possível conectar ao servidor',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
    expect(screen.queryByTestId('responsible-picker-error')).not.toBeInTheDocument()
    expect(assignableMock).toHaveBeenCalledTimes(2)
  })
})
