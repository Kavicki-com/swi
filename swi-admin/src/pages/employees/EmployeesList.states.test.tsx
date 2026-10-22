// A falha ao carregar os funcionários não pode se passar por "nenhum
// funcionário cadastrado": a tela diz que falhou e oferece nova tentativa, e a
// espera tem a forma da lista (SkeletonList do DS), como na lista de
// administradores.
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { employeesApi, type Employee } from '@/services/api/users'
import { EmployeesList } from './EmployeesList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const ANA = {
  id: 'w1',
  name: 'Ana Lima',
  age: 30,
  bloodType: 'A+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: '',
  active: true,
} as Employee

const renderList = () => renderPage(<EmployeesList />, { route: '/employees' })

afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
})

describe('EmployeesList: estados da carga', () => {
  it('enquanto a lista não chega, mostra o carregando', async () => {
    vi.spyOn(employeesApi, 'list').mockReturnValue(new Promise(() => {}))
    await renderList()

    expect(screen.getByTestId('employees-loading')).toBeTruthy()
    expect(screen.queryByText('Nenhum funcionário cadastrado')).toBeNull()
  })

  it('falha mostra o erro, não a lista vazia, e Tentar novamente busca de novo', async () => {
    const list = vi
      .spyOn(employeesApi, 'list')
      .mockResolvedValue({ data: null, error: { message: 'Não foi possível conectar ao servidor' } })
    await renderList()

    expect(screen.getByTestId('employees-error').textContent).toBe(
      'Não foi possível conectar ao servidor',
    )
    expect(screen.queryByText('Nenhum funcionário cadastrado')).toBeNull()

    list.mockResolvedValue({ data: [ANA], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await act(async () => {})

    expect(screen.getByText('Ana Lima')).toBeTruthy()
    expect(screen.queryByTestId('employees-error')).toBeNull()
  })
})
