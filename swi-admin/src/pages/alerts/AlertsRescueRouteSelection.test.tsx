// Comportamento da escolha de socorrista: quem entra na lista, como busca e
// filtro a reduzem, e para onde o clique leva.
//
// As posições ao vivo e o diretório da empresa são dublês: a lista real sai do
// cruzamento dos dois, e é esse cruzamento (e não o layout) que precisa de
// prova. O ranqueamento tem suíte própria em services/api/rescue.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AlertsRescueRouteSelection } from './AlertsRescueRouteSelection'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const h = vi.hoisted(() => ({
  positions: [] as Array<Record<string, unknown>>,
  directory: [] as Array<Record<string, unknown>>,
  navigations: [] as string[],
  tierPorId: {} as Record<string, string>,
}))

vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => h.positions }))
// O estado de saúde do candidato NÃO sai do `status` da posição: vem dos vitais
// simulados, determinísticos por id. Fixar o tier por id é o que torna o filtro
// desta tela testável.
vi.mock('@/services/vitals/simulatedVitals', () => ({
  simulatedVitalsFor: (id: string) => ({ tier: h.tierPorId[id] ?? 'excelente' }),
}))
vi.mock('@/services/api/users', () => ({
  employeesApi: { list: async () => ({ data: h.directory, error: null }) },
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      h.navigations.push(to)
    },
  }
})

const pos = (id: string, name: string, status: string, lng: number, lat: number) => ({
  id,
  name,
  lng,
  lat,
  status,
  avatarUri: '',
})

const emp = (id: string, name: string) => ({
  id,
  name,
  age: 30,
  bloodType: 'A+',
  avatarUri: '',
})

const renderSelection = (route = '/alerts/w1/rescue') =>
  renderPage(<AlertsRescueRouteSelection />, { route, path: '/alerts/:employeeId/rescue' })

beforeEach(() => {
  h.positions = [
    pos('w1', 'Ferido', 'low', -46.63, -23.55),
    pos('w2', 'Ana Lima', 'good', -46.631, -23.551),
    pos('w3', 'Bruno Souza', 'alert', -46.64, -23.56),
  ]
  h.directory = [emp('w2', 'Ana Lima'), emp('w3', 'Bruno Souza')]
  h.navigations = []
  h.tierPorId = { w2: 'excelente', w3: 'desgastado' }
})

afterEach(clearSession)

describe('AlertsRescueRouteSelection', () => {
  it('lista todo mundo menos o próprio ferido', async () => {
    await renderSelection()

    expect(await screen.findByLabelText('Selecionar Ana Lima')).toBeTruthy()
    expect(screen.getByLabelText('Selecionar Bruno Souza')).toBeTruthy()
    expect(screen.queryByLabelText('Selecionar Ferido')).toBeNull()
  })

  it('o socorrista mais próximo é marcado como melhor opção', async () => {
    await renderSelection()

    expect(await screen.findByText('Melhor opção de ajuda')).toBeTruthy()
  })

  it('sem posição do ferido, não há candidato para exibir', async () => {
    h.positions = [pos('outro', 'Alguém', 'good', -46.6, -23.5)]
    await renderSelection()

    await waitFor(() => expect(screen.queryByLabelText(/^Selecionar /)).toBeNull())
  })

  it('a busca reduz a lista pelo nome, sem diferenciar maiúsculas', async () => {
    await renderSelection()
    await screen.findByLabelText('Selecionar Ana Lima')

    fireEvent.change(screen.getByPlaceholderText('Pesquisar'), { target: { value: 'BRUNO' } })

    expect(screen.getByLabelText('Selecionar Bruno Souza')).toBeTruthy()
    expect(screen.queryByLabelText('Selecionar Ana Lima')).toBeNull()
  })

  it('o filtro de estado de saúde deixa só quem corresponde', async () => {
    await renderSelection()
    await screen.findByLabelText('Selecionar Ana Lima')

    fireEvent.click(screen.getByText('Risco de incidente'))

    expect(screen.getByLabelText('Selecionar Bruno Souza')).toBeTruthy()
    expect(screen.queryByLabelText('Selecionar Ana Lima')).toBeNull()
  })

  it('voltar para "Todos" restaura a lista inteira', async () => {
    await renderSelection()
    await screen.findByLabelText('Selecionar Ana Lima')

    fireEvent.click(screen.getByText('Urgência médica'))
    expect(screen.queryByLabelText('Selecionar Ana Lima')).toBeNull()
    expect(screen.queryByLabelText('Selecionar Bruno Souza')).toBeNull()

    fireEvent.click(screen.getByText('Todos'))
    expect(screen.getByLabelText('Selecionar Ana Lima')).toBeTruthy()
  })

  it('escolher um socorrista abre a rota do par', async () => {
    await renderSelection()
    await screen.findByLabelText('Selecionar Ana Lima')

    fireEvent.click(screen.getByLabelText('Selecionar Ana Lima'))

    expect(h.navigations).toEqual(['/alerts/w1/rescue/w2'])
  })

  it('quem está no mapa mas fora do diretório ainda pode socorrer', async () => {
    h.directory = [emp('w2', 'Ana Lima')]
    await renderSelection()

    // Bruno não está no diretório: o nome vem da posição ao vivo e os dados
    // clínicos ficam em branco, mas ele continua selecionável.
    expect(await screen.findByLabelText('Selecionar Bruno Souza')).toBeTruthy()
  })
})
