import { vi } from 'vitest'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { PrivacyPolicyModal } from './PrivacyPolicyModal'

// A política que o painel mostra é a real da plataforma, versionada no próprio
// texto e idêntica à do app. Nada do texto de exemplo da empresa fictícia pode
// sobrar.

afterEach(() => clearSession())

describe('PrivacyPolicyModal: texto da política', () => {
  it('não traz mais o texto de exemplo da empresa fictícia', async () => {
    const { container } = await renderPage(<PrivacyPolicyModal onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Excelsior')
  })

  it('mostra a versão e a data da política', async () => {
    const { container } = await renderPage(<PrivacyPolicyModal onClose={vi.fn()} />)
    expect(container.textContent).toContain('Versão 1.0, 15 de outubro de 2026')
  })
})
