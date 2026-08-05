import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { settleAuth } from '@/test-utils/renderPage'

// Dublê marcável: o componente real só injeta CSS, que não deixa rastro
// observável no jsdom (ver o teste do autofill abaixo).
vi.mock('./GlobalStyles', () => ({
  GlobalStyles: () => <div data-testid="global-styles" />,
}))

describe('App', () => {
  it('renders inside SwiThemeProvider without crashing', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
  })

  // QA Web #5: sem o GlobalStyles o Chrome pinta de amarelo todo campo que ele
  // autopreenche, furando o tema escuro.
  //
  // O teste guarda a MONTAGEM, não o CSS. Verificar o CSS aqui é impossível: o
  // jsdom lê as regras do styled-components (13 KB delas), mas DESCARTA esta,
  // porque não reconhece o pseudo-seletor `:-webkit-autofill`. A regra em si
  // foi conferida no navegador, com as cores do tema resolvidas.
  //
  // O que este teste pega é o modo silencioso de perder a correção: alguém tira
  // <GlobalStyles /> do App e nada mais quebra.
  it('monta o GlobalStyles, que neutraliza o autofill do Chrome', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(screen.getByTestId('global-styles')).toBeInTheDocument()
  })
})
