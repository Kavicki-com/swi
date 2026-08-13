// ResponsablesModal — smoke (modo rota) + modo CONTROLADO (onConfirm/onClose).
// describe/it/expect/beforeEach vêm dos globals do Vitest.
//
// adminsApi é mockado: o overlay carrega a lista dele. No modo controlado o
// NewReport monta este componente e recebe os NOMES dos admins marcados.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { seedSession, clearSession, renderPage } from '@/test-utils/renderPage'
import { ResponsablesModal } from './ResponsablesModal'

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))

vi.mock('@/services/admins', () => ({
  adminsApi: { list: listMock },
}))

const ELISA = {
  id: 'admin-01',
  name: 'Elisa Siqueira Jordão',
  age: 26,
  bloodType: 'O+',
  role: 'Administradora de Sistema',
  specialization: 'Engenheira Civil',
  avatarUri: '',
  active: true,
}
const MATHIAS = {
  id: 'admin-02',
  name: 'Mathias Campos S.',
  age: 32,
  bloodType: 'AB-',
  role: 'Segurança do trabalho',
  specialization: 'Técnico',
  avatarUri: '',
  active: true,
}

function renderControlled(props: {
  onConfirm?: (names: string[]) => void
  onClose?: () => void
  initialSelectedNames?: string[]
}) {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter>
          <ResponsablesModal {...props} />
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

beforeEach(() => {
  listMock.mockReset()
  listMock.mockResolvedValue({ data: [ELISA, MATHIAS], error: null })
})

afterEach(clearSession)

describe('ResponsablesModal', () => {
  it('renders without crashing (modo rota)', async () => {
    await expect(renderPage(<ResponsablesModal />, { route: '/modals/responsables' })).resolves.toBeDefined()
  })

  it('no modo controlado, Continuar devolve os NOMES marcados via onConfirm', async () => {
    const onConfirm = vi.fn()
    renderControlled({ onConfirm, onClose: vi.fn() })

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Selecionar Elisa Siqueira Jordão como responsável' }),
      ).toBeVisible()
    })
    fireEvent.click(
      screen.getByRole('radio', { name: 'Selecionar Elisa Siqueira Jordão como responsável' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(['Elisa Siqueira Jordão'])
  })

  it('Continuar fica travado enquanto ninguém está marcado', async () => {
    const onConfirm = vi.fn()
    renderControlled({ onConfirm })

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Selecionar Elisa Siqueira Jordão como responsável' }),
      ).toBeVisible()
    })
    // O CTA do DS Button desabilitado sai como aria-disabled.
    expect(screen.getByRole('button', { name: 'Confirmar responsáveis' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('initialSelectedNames pré-marca quem já foi escolhido', async () => {
    const onConfirm = vi.fn()
    renderControlled({ onConfirm, initialSelectedNames: ['Mathias Campos S.'] })

    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Selecionar Mathias Campos S. como responsável' }),
      ).toBeVisible()
    })
    // Já vem marcado: confirmar sem tocar em nada devolve o nome semeado.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
    expect(onConfirm).toHaveBeenCalledWith(['Mathias Campos S.'])
  })

  it('onClose fecha sem confirmar', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderControlled({ onConfirm, onClose })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar seleção' })).toBeVisible()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar seleção' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
