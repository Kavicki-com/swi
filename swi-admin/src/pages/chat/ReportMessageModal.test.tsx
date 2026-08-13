// QA Web #9 — "Denunciar" no menu da mensagem do chat. O modal segue o molde
// do SupportModal (Combobox de motivo + texto + estados idle/sending/sent),
// mas o envio vai pro endpoint de denúncia do chat, que dispara o e-mail no
// backend. vitest globals via globals: true.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ReportMessageModal } from './ReportMessageModal'
import type { ChatMessage } from '@/services/chats'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { chatsApi } from '@/services/api/chats'

vi.mock('@/services/api/chats', () => ({
  chatsApi: { reportMessage: vi.fn() },
}))

// O DS Combobox NÃO abre em jsdom (precisa de measureInWindow — ver nota no
// SupportModal.test.tsx). Substituímos SÓ o Combobox por opções clicáveis.
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

const reportMock = vi.mocked(chatsApi.reportMessage)

const MESSAGE: ChatMessage = {
  id: 'm1',
  text: 'Mensagem denunciável.',
  sender: 'them',
  time: '10:40',
}

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

const render = async (onClose = () => {}) =>
  await renderPage(<ReportMessageModal conversationId="me#w1" message={MESSAGE} onClose={onClose} />)

describe('ReportMessageModal', () => {
  it('submit válido → reportMessage com o LABEL do motivo + detalhe, e mostra sucesso', async () => {
    reportMock.mockResolvedValue({ data: null, error: null })
    await render()

    fireEvent.click(screen.getByRole('button', { name: 'Assédio ou intimidação' }))
    fireEvent.change(screen.getByPlaceholderText('Descreva o que aconteceu'), {
      target: { value: 'Ameaçou o colega de equipe.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }))

    await waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1))
    expect(reportMock).toHaveBeenCalledWith('me#w1', 'm1', {
      reason: 'Assédio ou intimidação',
      text: 'Ameaçou o colega de equipe.',
    })
    // Estado de sucesso substitui o form — não fecha sozinho.
    expect(await screen.findByText(/denúncia enviada/i)).toBeTruthy()
  })

  // O detalhamento é a "caixa de ~240 caracteres para detalhar" da planilha:
  // opcional. Só o motivo é obrigatório.
  it('motivo sem detalhe é válido, e o dto sai sem text', async () => {
    reportMock.mockResolvedValue({ data: null, error: null })
    await render()

    fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }))

    await waitFor(() => expect(reportMock).toHaveBeenCalledWith('me#w1', 'm1', { reason: 'Spam' }))
  })

  it('sem motivo → erro de validação pt-BR e NENHUMA chamada de rede', async () => {
    await render()

    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }))

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    expect(reportMock).not.toHaveBeenCalled()
  })

  it('falha do backend → mostra o erro e mantém o form preenchido', async () => {
    reportMock.mockResolvedValue({ data: null, error: { message: 'Falha ao enviar denúncia' } })
    await render()

    fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
    fireEvent.change(screen.getByPlaceholderText('Descreva o que aconteceu'), {
      target: { value: 'Detalhe que não pode se perder.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }))

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    expect(
      (screen.getByPlaceholderText('Descreva o que aconteceu') as HTMLInputElement).value,
    ).toBe('Detalhe que não pode se perder.')
  })

  // O limite de ~240 vem do DS 0.1.132: maxLength corta no campo e o contador
  // mostra quanto falta. Sem o contador o corte seria uma parede muda.
  it('o campo de detalhe expõe o contador 0/240 do DS', async () => {
    await render()

    expect(screen.getByText('0/240')).toBeTruthy()
  })

  // Diferente do SupportModal, aqui a confirmação NÃO repete o verde do
  // cabeçalho: dois títulos verdes empilhados no mesmo card disputam a
  // atenção. O da confirmação sai em branco e um degrau abaixo, então quem
  // separa os dois é a cor, não o tamanho.
  it('o título da confirmação sai em branco, não no verde do cabeçalho', async () => {
    reportMock.mockResolvedValue({ data: null, error: null })
    await render()

    fireEvent.click(screen.getByRole('button', { name: 'Spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }))

    const heading = await screen.findByText('Denúncia enviada')
    const header = screen.getByText('Denunciar mensagem')

    expect(heading.style.color).toBe('rgb(245, 245, 245)')
    expect(heading.style.color).not.toBe(header.style.color)
    expect(Number.parseFloat(heading.style.fontSize)).toBeLessThanOrEqual(
      Number.parseFloat(header.style.fontSize),
    )
  })
})
