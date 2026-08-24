// Estes testes protegem uma invariante do detalhe de funcionário/admin: a tela
// nunca mostra número ou rótulo CONFIANTE que não corresponda a dado real.
// Onde o dado falta, ela declara a ausência em vez de preencher com um default.
// vitest globals (describe/it/expect) via globals: true.
import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { WorkerDetailsLayout, type WorkerDetailsData } from './WorkerDetailsLayout'

const BASE: WorkerDetailsData = {
  name: 'Fulano de Teste',
  age: 43,
  bloodType: 'B+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: '',
}

const renderLayout = async (
  worker: Partial<WorkerDetailsData>,
  position: { lat: number; lng: number } | null = { lat: -23.55, lng: -46.63 },
) =>
  await renderPage(
    <WorkerDetailsLayout
      worker={{ ...BASE, ...worker }}
      position={position}
      testID="worker-details"
      onBack={() => {}}
      backA11yLabel="Voltar"
      onOpenFullMap={() => {}}
      topRightAction={null}
    />,
    { route: '/employees/w1', path: '/employees/:id' },
  )

describe('WorkerDetailsLayout', () => {
  // fatigueRate/effort vêm em 0-100 (simulatedVitalsFor). Multiplicar por 100
  // de novo na formatação exibiria "8.900,0%".
  it('formata fadiga/esforço na escala 0-100, sem multiplicar de novo', async () => {
    await renderLayout({ fatigueRate: 89, effort: 92 })
    expect(screen.getByText('89,0%')).toBeInTheDocument()
    expect(screen.getByText('92,0%')).toBeInTheDocument()
    expect(screen.queryByText('8.900,0%')).not.toBeInTheDocument()
  })

  // Sem gênero cadastrado a tela não pode eleger "Feminino" como default.
  it('não inventa gênero quando o cadastro não tem o campo', async () => {
    await renderLayout({})
    expect(screen.getByText('Não informado')).toBeInTheDocument()
    expect(screen.queryByText('Feminino')).not.toBeInTheDocument()
  })

  it('mostra o gênero real quando cadastrado', async () => {
    await renderLayout({ gender: 'male' })
    expect(screen.getByText('Masculino')).toBeInTheDocument()
  })

  // Quem se declarou não-binário ou "outro" no cadastro é gravado como 'other'.
  // Cair em "Não informado" apagaria uma declaração que a pessoa FEZ, e a
  // deixaria indistinguível de quem preferiu não responder.
  it('mostra "Outro" para o gênero declarado fora do binário', async () => {
    await renderLayout({ gender: 'other' })
    expect(screen.getByText('Outro')).toBeInTheDocument()
    expect(screen.queryByText('Não informado')).not.toBeInTheDocument()
  })

  // Título sozinho lê como falha de carregamento; o estado vazio é informação.
  // Handle da fase 1 do "Nome do usuário": aparece sob o nome quando existe, e
  // NÃO aparece quando não existe. Um @ vazio ou inventado afirmaria identidade
  // que a conta não tem.
  it('mostra o @handle quando a conta tem um', async () => {
    await renderLayout({ username: 'carlos.m' })
    expect(screen.getByText('@carlos.m')).toBeInTheDocument()
  })

  it('sem handle, nenhum @ é renderizado', async () => {
    await renderLayout({})
    expect(screen.queryByText(/^@/)).toBeNull()
  })

  it('declara os vazios de alergias e exames em vez de deixar a seção muda', async () => {
    await renderLayout({})
    expect(screen.getByText('Nenhuma alergia registrada.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum exame registrado.')).toBeInTheDocument()
  })

  it('pinta uma chip por alergia quando existem', async () => {
    await renderLayout({ allergies: ['Penicilina', 'Látex'] })
    expect(screen.getByText('Penicilina')).toBeInTheDocument()
    expect(screen.getByText('Látex')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma alergia registrada.')).not.toBeInTheDocument()
  })

  // Sem posição ao vivo o mini-mapa NÃO pina numa coordenada default, que
  // seria a mesma pra todo funcionário do quadro.
  it('declara a ausência de posição em vez de pinar num ponto fixo', async () => {
    await renderLayout({}, null)
    expect(screen.getByText('Sem posição ao vivo')).toBeInTheDocument()
  })
})
