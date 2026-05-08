import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { Login } from './Login'

const meta: Meta<typeof Login> = {
  title: 'Pages/Auth/Login',
  component: Login,
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Story />
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>
    ),
  ],
}
export default meta

export const Default: StoryObj<typeof Login> = {}

export const Loading: StoryObj<typeof Login> = {
  parameters: {
    docs: {
      description: { story: 'Botão em loading; reproduzir clicando em "Entrar" com mock lento.' },
    },
  },
}

export const Error: StoryObj<typeof Login> = {
  parameters: {
    docs: {
      description: { story: 'Erro do mockApi.signIn — usar credenciais inválidas.' },
    },
  },
}

export const Filled: StoryObj<typeof Login> = {
  parameters: {
    docs: {
      description: { story: 'Form preenchido com credenciais demo (admin@swi.test / demo1234).' },
    },
  },
}
