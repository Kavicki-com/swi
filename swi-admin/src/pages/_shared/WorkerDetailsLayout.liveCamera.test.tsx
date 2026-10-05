// Botão "Ver câmera da posição" do minimapa do detalhe. Arquivo próprio para
// não crescer os outros dois testes do layout; o que o botão faz depois tem
// teste em hooks/useOpenLiveCamera.test.tsx.
// vitest globals (describe/it/expect/vi) via globals: true.
import { fireEvent, screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { vitalsViewFrom } from '@/services/vitals/vitalsView'
import { WorkerDetailsLayout, type WorkerDetailsData } from './WorkerDetailsLayout'

const open = vi.hoisted(() => ({ fn: vi.fn(async (_id: string | undefined, _name: string) => {}) }))
vi.mock('@/hooks/useOpenLiveCamera', () => ({ useOpenLiveCamera: () => open.fn }))
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => null }))

const BASE: WorkerDetailsData = {
  name: 'Fulano de Teste',
  age: 43,
  bloodType: 'B+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: 'https://fotos.test/fulano.png',
  vitals: vitalsViewFrom(null),
}

const renderWith = (worker: WorkerDetailsData) =>
  renderPage(
    <WorkerDetailsLayout
      worker={worker}
      position={{ lat: -23.55, lng: -46.63 }}
      testID="worker-details"
      onBack={() => {}}
      backA11yLabel="Voltar"
      onOpenFullMap={() => {}}
      topRightAction={null}
    />,
  )

beforeEach(() => open.fn.mockClear())

describe('WorkerDetailsLayout: câmera da posição', () => {
  it('no detalhe do funcionário, procura a transmissão dele', async () => {
    await renderWith({ ...BASE, seriesWorkerId: 'w1' })
    fireEvent.click(screen.getByRole('button', { name: 'Ver câmera da posição' }))
    expect(open.fn).toHaveBeenCalledWith('w1', 'Fulano de Teste')
  })

  it('no detalhe do administrador, que não transmite, vai sem id', async () => {
    await renderWith(BASE)
    fireEvent.click(screen.getByRole('button', { name: 'Ver câmera da posição' }))
    expect(open.fn).toHaveBeenCalledWith(undefined, 'Fulano de Teste')
  })
})
