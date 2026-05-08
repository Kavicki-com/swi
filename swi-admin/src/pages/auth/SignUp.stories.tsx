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

export const Default: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Cadastro B2B (Figma 22:2178). Três seções (empresa, endereço, responsável) + radio de função + ações Voltar/Finalizar Cadastro.',
      },
    },
  },
}

export const Loading: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Botão em loading; reproduzir clicando em "Finalizar Cadastro" após preencher todos os campos válidos com mock lento.',
      },
    },
  },
}

export const Error: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Erro do mockApi.signUp — usar e-mail já registrado (admin@swi.test) no campo "Email" do responsável.',
      },
    },
  },
}

export const Filled: StoryObj<typeof SignUp> = {
  parameters: {
    docs: {
      description: {
        story:
          'Form preenchido com todos os campos obrigatórios das 3 seções, função selecionada (ex: Dono/Fundador) e e-mail novo.',
      },
    },
  },
}
