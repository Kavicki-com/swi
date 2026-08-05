// Regressões do QA de volume 2026-07-26 no detalhe de funcionário/admin.
// Os bugs aqui tinham a mesma assinatura: a tela mostrava um número ou rótulo
// CONFIANTE que não correspondia a nenhum dado real.
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
  // fatigueRate/effort vêm em 0-100 (simulatedVitalsFor). O formatPct antigo
  // multiplicava por 100 de novo e a tela exibia "8.900,0%".
  it('formata fadiga/esforço na escala 0-100, sem multiplicar de novo', async () => {
    await renderLayout({ fatigueRate: 89, effort: 92 })
    expect(screen.getByText('89,0%')).toBeInTheDocument()
    expect(screen.getByText('92,0%')).toBeInTheDocument()
    expect(screen.queryByText('8.900,0%')).not.toBeInTheDocument()
  })

  // Sem gênero cadastrado o ternário mandava TODO mundo pra "Feminino".
  it('não inventa gênero quando o cadastro não tem o campo', async () => {
    await renderLayout({})
    expect(screen.getByText('Não informado')).toBeInTheDocument()
    expect(screen.queryByText('Feminino')).not.toBeInTheDocument()
  })

  it('mostra o gênero real quando cadastrado', async () => {
    await renderLayout({ gender: 'male' })
    expect(screen.getByText('Masculino')).toBeInTheDocument()
  })

  // Título sozinho lê como falha de carregamento; o estado vazio é informação.
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

  // Sem posição ao vivo o mini-mapa NÃO pina numa coordenada default (era a
  // mesma pra todo funcionário do quadro).
  it('declara a ausência de posição em vez de pinar num ponto fixo', async () => {
    await renderLayout({}, null)
    expect(screen.getByText('Sem posição ao vivo')).toBeInTheDocument()
  })
})
