import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SignUp } from './SignUp'

const meta: Meta<typeof SignUp> = {
  title: 'Pages/Auth/SignUp',
  component: SignUp,
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/sign-up']}>
            <Story />
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>
    ),
  ],
}
export default meta

export const Default: StoryObj<typeof SignUp> = {}

export const Loading: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Botão em loading; reproduzir clicando em "Criar conta" com mock lento após preencher tudo.',
      },
    },
  },
}

export const Error: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Erro do mockApi.signUp — usar e-mail já registrado (admin@swi.test) ou desmarcar consentimento.',
      },
    },
  },
}

export const Filled: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Form preenchido com dados válidos (nome, e-mail novo, senha 8+, confirmação igual, consent marcado).',
      },
    },
  },
}
