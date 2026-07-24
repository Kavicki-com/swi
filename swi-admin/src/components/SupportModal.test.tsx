// QA F (2026-07-24): o "Enviar solicitação" do modal de suporte era
// onPress={onClose} — descartava o form. Estes testes travam o envio REAL
// (POST /support via supportApi) + validação pt-BR antes de qualquer rede.
// vitest globals (describe/it/expect/afterEach) via globals: true.
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { SupportModal } from './SupportModal'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { supportApi } from '@/services/api/support'

vi.mock('@/services/api/support', () => ({
  supportApi: { send: vi.fn() },
}))

// O DS Combobox NÃO abre em jsdom (precisa de measureInWindow — ver nota no
// NewReport.test.tsx). Substituímos SÓ o Combobox por opções clicáveis,
// preservando o resto do DS real; o que se testa é o comportamento do modal.
vi.mock('@kavicki/swi-design-system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kavicki/swi-design-system')>()
  return {
    ...actual,
    Combobox: ({
      label,
      options,
      onChange,
    }: {
      label: string
      options: { label: string; value: string }[]
      onChange: (v: string) => void
    }) => (
      <div>
        <span>{label}</span>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    ),
  }
})

const sendMock = vi.mocked(supportApi.send)

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

const fillAndSubmit = async () => {
  // Flush do getSession async do AuthProvider — em prod o RequireAuth já
  // garante user carregado antes do settings montar; aqui o clique viria antes.
  await act(async () => {})
  // Combobox mockado acima: cada opção vira um botão direto.
  fireEvent.click(screen.getByRole('button', { name: 'Problema técnico' }))
  fireEvent.change(screen.getByPlaceholderText('Digite aqui'), {
    target: { value: 'Mapa não carrega' },
  })
  fireEvent.change(screen.getByPlaceholderText('Digite aqui a sua mensagem'), {
    target: { value: 'A aba Mapas fica em branco.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
}

describe('SupportModal', () => {
  it('submit válido → supportApi.send com o LABEL do motivo + e-mail da sessão, e mostra sucesso', async () => {
    sendMock.mockResolvedValue({ data: { sent: true }, error: null })
    renderPage(<SupportModal onClose={() => {}} />)

    await fillAndSubmit()

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock).toHaveBeenCalledWith({
      reason: 'Problema técnico',
      title: 'Mapa não carrega',
      message: 'A aba Mapas fica em branco.',
      email: 'admin@swi.test', // sessão seedada pelo renderPage
    })
    // Estado de sucesso substitui o form — não fecha sozinho.
    expect(await screen.findByText(/solicitação enviada/i)).toBeTruthy()
  })

  it('campos vazios → erro de validação pt-BR e NENHUMA chamada de rede', async () => {
    renderPage(<SupportModal onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('falha do backend → mostra o erro e mantém o form preenchido', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Falha ao enviar solicitação' } })
    renderPage(<SupportModal onClose={() => {}} />)

    await fillAndSubmit()

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    // O título digitado continua lá (nada foi descartado).
    expect((screen.getByPlaceholderText('Digite aqui') as HTMLInputElement).value).toBe(
      'Mapa não carrega',
    )
  })
})
