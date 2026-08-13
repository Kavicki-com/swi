// QA F (2026-07-24): o "Enviar solicitação" do modal de suporte era
// onPress={onClose} — descartava o form. Estes testes travam o envio REAL
// (POST /support via supportApi) + validação pt-BR antes de qualquer rede.
// vitest globals (describe/it/expect/afterEach) via globals: true.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { SupportModal } from './SupportModal'
import { clearSession, renderPage, settleAuth } from '@/test-utils/renderPage'
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
  // Combobox mockado acima: cada opção vira um botão direto.
  // (o getSession do AuthProvider já foi drenado pelo renderPage)
  fireEvent.click(screen.getByRole('button', { name: 'Problema técnico' }))
  fireEvent.change(screen.getByPlaceholderText('Digite aqui'), {
    target: { value: 'Mapa não carrega' },
  })
  fireEvent.change(screen.getByPlaceholderText('Digite aqui a sua mensagem'), {
    target: { value: 'A aba Mapas fica em branco.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))
  // O envio é assíncrono: sem drenar aqui, a resolução cai fora do act e o
  // React acusa. Nenhum teste desta suíte afirma o estado intermediário de
  // envio, então drenar não esconde nada que esteja sendo verificado.
  await settleAuth()
}

// O react-native-web escreve tipografia como style inline, mas manda o resto
// (background, width) pra classes atômicas injetadas via CSSOM. Pra ler essas,
// é preciso iterar document.styleSheets: o textContent das <style> vem vazio.
const resolveStyle = (el: HTMLElement): Record<string, string> => {
  const out: Record<string, string> = {}
  const classes = new Set(el.className.split(' ').filter(Boolean))
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
      const sel = rule.selectorText
      if (!sel || !rule.style) continue
      if (![...classes].some((c) => sel === `.${c}`)) continue
      for (const prop of Array.from(rule.style)) out[prop] = rule.style.getPropertyValue(prop)
    }
  }
  for (const prop of Array.from(el.style)) out[prop] = el.style.getPropertyValue(prop)
  return out
}

const px = (value: string) => Number.parseFloat(value)

describe('SupportModal', () => {
  it('submit válido → supportApi.send com o LABEL do motivo + e-mail da sessão, e mostra sucesso', async () => {
    sendMock.mockResolvedValue({ data: { sent: true }, error: null })
    await renderPage(<SupportModal onClose={() => {}} />)

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
    await renderPage(<SupportModal onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }))

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('falha do backend → mostra o erro e mantém o form preenchido', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Falha ao enviar solicitação' } })
    await renderPage(<SupportModal onClose={() => {}} />)

    await fillAndSubmit()

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    // O título digitado continua lá (nada foi descartado).
    expect((screen.getByPlaceholderText('Digite aqui') as HTMLInputElement).value).toBe(
      'Mapa não carrega',
    )
  })
})

// QA Web #7: o pop-up de confirmação tinha título, mensagem e botão no mesmo
// peso. O cabeçalho e o título do sucesso saíam idênticos (Montserrat 700/16
// em content.primary), o e-mail de retorno se perdia no meio do parágrafo e o
// "Fechar" era o mesmo CTA verde de largura cheia do "Enviar solicitação".
// Estes testes travam RELAÇÕES de hierarquia, não pixels: quem é maior que
// quem, quem pesa mais que quem, quem deixou de ser o CTA sólido.
describe('SupportModal, hierarquia da confirmação (QA Web #7)', () => {
  const renderSent = async () => {
    sendMock.mockResolvedValue({ data: { sent: true }, error: null })
    await renderPage(<SupportModal onClose={() => {}} />)
    await fillAndSubmit()
    await screen.findByText('Solicitação enviada')
  }

  it('o título da confirmação domina o cabeçalho do modal', async () => {
    await renderSent()

    const heading = screen.getByText('Solicitação enviada')
    const header = screen.getByText('Solicitação de suporte')

    expect(px(heading.style.fontSize)).toBeGreaterThan(px(header.style.fontSize))
  })

  it('o e-mail de retorno se destaca do corpo da mensagem', async () => {
    await renderSent()

    const email = screen.getByText('admin@swi.test')
    const message = screen.getByText(/Recebemos a sua solicitação/)

    expect(email.style.fontWeight).toBe('700')
    expect(px(message.style.fontWeight)).toBeLessThan(px(email.style.fontWeight))
    // O corpo recua de cor pro e-mail poder subir.
    expect(message.style.color).not.toBe(email.style.color)
  })

  it('o Fechar da confirmação deixa de ser o CTA verde de largura cheia', async () => {
    await renderSent()

    const close = screen.getAllByRole('button', { name: 'Fechar' }).at(-1)!
    const style = resolveStyle(close)

    // Sólido virou transparente: alpha 0 no rgba do react-native-web.
    expect(style['background-color']).toMatch(/,\s*0(\.0+)?\)$/)
    expect(style.width).not.toBe('100%')
    // Continua sendo botão de verdade, com a borda do variant outline.
    expect(style['border-top-color']).not.toMatch(/,\s*0(\.0+)?\)$/)
  })

  it('o espaçamento separa o bloco de texto da ação', async () => {
    await renderSent()

    const block = screen.getByTestId('support-sent')
    const copy = screen.getByTestId('support-sent-copy')

    expect(px(resolveStyle(copy).gap!)).toBeLessThan(px(resolveStyle(block).gap!))
  })
})
