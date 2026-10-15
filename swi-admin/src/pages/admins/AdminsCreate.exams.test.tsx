// Exames clínicos no cadastro e na edição (AdminsCreate serve /admins e
// /employees). Extraído de AdminsCreate.test.tsx para o arquivo não passar do
// gate de 800 linhas. describe/it/expect vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import * as uploadMod from '@/services/api/upload'
import { AdminsCreate } from './AdminsCreate'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function finalizar() {
  fireEvent.click(screen.getByRole('button', { name: /finalizar cadastro/i }))
}

// Fixture mínima do usuário já gravado (modo edição).
const GRAVADO = {
  id: 'u1',
  name: 'Carlos Mendes',
  email: 'carlos@x.com',
  phone: '11998765432',
  cpf: '41255687890',
  birthDate: '1992-03-14',
  gender: 'male',
  bloodType: 'O+',
  allergies: 'Penicilina',
  chronicConditions: '',
  username: 'carlos.m',
  role: 'ADMIN',
  exams: [],
}

describe('AdminsCreate: exames clínicos', () => {
  const arquivo = () => new File(['x'], 'laudo.pdf', { type: 'application/pdf' })

  const preencherExame = (nome: string, validade: string) => {
    fireEvent.change(screen.getByTestId('admins-create-exam-name'), { target: { value: nome } })
    fireEvent.change(screen.getByTestId('admins-create-exam-date'), { target: { value: validade } })
  }

  const escolherArquivo = () => {
    fireEvent.click(screen.getByRole('button', { name: /enviar exame/i }))
    fireEvent.change(screen.getByTestId('admins-create-exam-input'), {
      target: { files: [arquivo()] },
    })
  }

  it('no cadastro, o exame entra na fila e só sobe depois do usuário existir', async () => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'novo-1' } as never, error: null })
    const addExam = vi
      .spyOn(employeesApi, 'addExam')
      .mockResolvedValue({ data: { id: 'e1' } as never, error: null })
    const upload = vi.spyOn(uploadMod, 'uploadImage').mockResolvedValue('exams/k.pdf')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'Senha@123')
    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()

    // Enquanto o cadastro não existe, nada subiu: não há a quem anexar.
    await waitFor(() => expect(screen.getByText('Hemograma')).toBeTruthy())
    expect(upload).not.toHaveBeenCalled()
    expect(addExam).not.toHaveBeenCalled()

    finalizar()

    await waitFor(() => expect(addExam).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(addExam.mock.calls[0]?.[0]).toBe('novo-1')
    expect(addExam.mock.calls[0]?.[1]).toEqual({
      name: 'Hemograma',
      date: '2027-03-14',
      fileKey: 'exams/k.pdf',
    })
  })

  // Se o cadastro falhou, não existe usuário: subir o arquivo deixaria objeto
  // órfão no bucket em nome de alguém que não foi criado.
  it('cadastro recusado não sobe exame nenhum', async () => {
    vi.spyOn(employeesApi, 'create').mockResolvedValue({
      data: null,
      error: { message: 'E-mail já cadastrado' },
    })
    const addExam = vi.spyOn(employeesApi, 'addExam')
    const upload = vi.spyOn(uploadMod, 'uploadImage')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'Senha@123')
    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()
    finalizar()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/já cadastrado/i))
    expect(upload).not.toHaveBeenCalled()
    expect(addExam).not.toHaveBeenCalled()
  })

  it('exame sem nome ou sem validade não entra na fila e diz o que falta', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /enviar exame/i }))

    // Casa a MENSAGEM, não o rótulo "Nome do exame" do campo, que existe sempre.
    await waitFor(() => expect(screen.getByText(/informe o nome do exame/i)).toBeTruthy())
  })

  it('na edição o exame sobe na hora, porque o cadastro já existe', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    const addExam = vi.spyOn(employeesApi, 'addExam').mockResolvedValue({
      data: { id: 'e9', name: 'Hemograma', date: '2027-03-14', fileUrl: 'signed:k' },
      error: null,
    })
    vi.spyOn(uploadMod, 'uploadImage').mockResolvedValue('exams/k.pdf')
    await renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()

    await waitFor(() =>
      expect(addExam).toHaveBeenCalledWith('u1', {
        name: 'Hemograma',
        date: '2027-03-14',
        fileKey: 'exams/k.pdf',
      }),
    )
  })

  it('no cadastro, dá pra tirar um exame da fila sem perder o resto', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()
    await waitFor(() => expect(screen.getByText('Hemograma')).toBeTruthy())

    // Reversível (basta reanexar): remover vai direto, sem confirmação.
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Hemograma' }))

    await waitFor(() => expect(screen.queryByText('Hemograma')).toBeNull())
    // O resto do formulário continua.
    expect(screen.getByTestId('admins-create-nome')).toHaveValue('Zé da Silva')
  })

  it('na edição, excluir um exame gravado pede confirmação e chama a rota', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({
      data: {
        ...GRAVADO,
        exams: [{ id: 'e1', name: 'Audiometria', date: '2027-08-01', fileUrl: 'signed:a' }],
      },
      error: null,
    })
    const removeExam = vi
      .spyOn(employeesApi, 'removeExam')
      .mockResolvedValue({ data: null, error: null })
    await renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })
    await waitFor(() => expect(screen.getByText('Audiometria')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Audiometria' }))

    // Irreversível: confirma no diálogo antes de chamar a rota.
    expect(removeExam).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    await waitFor(() => expect(removeExam).toHaveBeenCalledWith('u1', 'e1'))
    await waitFor(() => expect(screen.queryByText('Audiometria')).toBeNull())
  })

  it('a edição mostra os exames que já estavam gravados', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({
      data: {
        ...GRAVADO,
        exams: [{ id: 'e1', name: 'Audiometria', date: '2027-08-01', fileUrl: 'signed:a' }],
      },
      error: null,
    })
    await renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })

    await waitFor(() => expect(screen.getByText('Audiometria')).toBeTruthy())
  })
})
