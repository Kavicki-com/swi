import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { RecoveryEmail } from './RecoveryEmail'

const meta: Meta<typeof RecoveryEmail> = {
  title: 'Pages/Auth/RecoveryEmail',
  component: RecoveryEmail,
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <MemoryRouter initialEntries={['/recovery/email']}>
          <Story />
        </MemoryRouter>
      </SwiThemeProvider>
    ),
  ],
}
export default meta

export const Default: StoryObj<typeof RecoveryEmail> = {}

export const Loading: StoryObj<typeof RecoveryEmail> = {
  parameters: {
    docs: {
      description: {
        story:
          'Botão em loading; reproduzir clicando em "Enviar instruções" com mock lento após preencher o e-mail.',
      },
    },
  },
}

export const Error: StoryObj<typeof RecoveryEmail> = {
  parameters: {
    docs: {
      description: {
        story:
          'Erro de validação local — submeter com e-mail inválido (ex.: "not-an-email") dispara "Informe um e-mail válido".',
      },
    },
  },
}

export const Sent: StoryObj<typeof RecoveryEmail> = {
  parameters: {
    docs: {
      description: {
        story:
          'Painel de confirmação após submit válido. Para visualizar, preencher um e-mail válido (ex.: "qualquer@swi.test") e clicar em "Enviar instruções"; o painel troca para o estado "sent" com a cópia em PT-BR e o link de voltar para login.',
      },
    },
  },
}
