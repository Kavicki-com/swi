// src/pages/dashboard/Dashboard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { Dashboard } from './Dashboard'

const meta: Meta<typeof Dashboard> = {
  title: 'Pages/Dashboard',
  component: Dashboard,
  decorators: [
    (Story) => {
      // Seed session so Dashboard fetches (getSession real exige token + sessão)
      window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          id: 'u_seed_1',
          email: 'admin@swi.test',
          full_name: 'Admin Seed',
          role: 'super_admin',
          consent_given_at: null,
          created_at: '',
        }),
      )
      return (
        <SwiThemeProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/']}>
              <Story />
            </MemoryRouter>
          </AuthProvider>
        </SwiThemeProvider>
      )
    },
  ],
}
export default meta

export const Loading: StoryObj<typeof Dashboard> = {
  parameters: {
    docs: {
      description: {
        story: 'Initial render — skeleton placeholders enquanto dashboardApi.summary não resolve.',
      },
    },
  },
}

export const Empty: StoryObj<typeof Dashboard> = {
  parameters: {
    docs: {
      description: {
        story: 'Org with no employees/alerts (call summary with unknown orgId).',
      },
    },
  },
}

export const Error: StoryObj<typeof Dashboard> = {
  parameters: {
    docs: {
      description: {
        story: 'Show the error panel; mock summary to reject in dev.',
      },
    },
  },
}

export const Populated: StoryObj<typeof Dashboard> = {
  parameters: {
    docs: {
      description: {
        story: 'Default with seeded org_seed_1 — KPIs + recent activities + weather.',
      },
    },
  },
}
