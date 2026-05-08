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

export const Error: StoryObj<typeof RecoveryNewPassword> = {
  parameters: {
    docs: {
      description: {
        story:
          'Erro de validação local — submeter "Alterar senha" com senhas que não coincidem dispara "As senhas não coincidem" no FormError.',
      },
    },
  },
}

export const Sent: StoryObj<typeof RecoveryNewPassword> = {
  parameters: {
    docs: {
      description: {
        story:
          'Painel de confirmação após reset bem-sucedido. Para visualizar, preencher um par válido (ex.: "novo1234" / "novo1234") e clicar em "Alterar senha"; o painel troca para o estado "sent" com a cópia em PT-BR e o link de voltar para login.',
      },
    },
  },
}
