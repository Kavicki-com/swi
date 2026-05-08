import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { RecoveryNewPassword } from './RecoveryNewPassword'

const meta: Meta<typeof RecoveryNewPassword> = {
  title: 'Pages/Auth/RecoveryNewPassword',
  component: RecoveryNewPassword,
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <MemoryRouter initialEntries={['/recovery/new-password?token=tok123']}>
          <Story />
        </MemoryRouter>
      </SwiThemeProvider>
    ),
  ],
}
export default meta

export const Default: StoryObj<typeof RecoveryNewPassword> = {}

export const NoToken: StoryObj<typeof RecoveryNewPassword> = {
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <MemoryRouter initialEntries={['/recovery/new-password']}>
          <Story />
        </MemoryRouter>
      </SwiThemeProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Painel de link inválido — reproduzido entrando na rota sem `?token=...` na URL. Mostra os links para solicitar novo e-mail de recuperação e voltar para o login.',
      },
    },
  },
}

export const Error: StoryObj<typeof RecoveryNewPassword> = {
  parameters: {
    docs: {
      description: {
        story:
          'Erro de validação local — submeter "Salvar nova senha" com senhas que não coincidem dispara "As senhas não coincidem" no FormError.',
      },
    },
  },
}

export const Sent: StoryObj<typeof RecoveryNewPassword> = {
  parameters: {
    docs: {
      description: {
        story:
          'Painel de confirmação após reset bem-sucedido. Para visualizar, preencher um par válido (ex.: "novo1234" / "novo1234") e clicar em "Salvar nova senha"; o painel troca para o estado "sent" com a cópia em PT-BR e o link de voltar para login.',
      },
    },
  },
}
