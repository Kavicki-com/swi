// src/app/routes.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_ROUTES } from './routes'
import { App } from './App'

describe('Admin router', () => {
  it.each(ADMIN_ROUTES.map((r) => [r.path, r.label]))(
    'renders placeholder for %s',
    (path, label) => {
      const concretePath = path.replace(':id', 'seed_id')
      render(
        <MemoryRouter initialEntries={[concretePath]}>
          <App />
        </MemoryRouter>,
      )
      expect(screen.getByTestId(`placeholder-${label}`)).toBeInTheDocument()
    },
  )
})
