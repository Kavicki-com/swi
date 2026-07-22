// ConfirmDialog — diálogo de confirmação compartilhado (extraído do ConfirmReject
// da fila de aprovação). Composição DS (Pressable scrim + card + Title + Text +
// Button Cancelar/confirmLabel) + useTheme. Interações via fireEvent (convenção
// do projeto; @testing-library/user-event não é dependência direta).
// vitest globals (describe/it/expect) via globals: true.
import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'
import { renderPage } from '@/test-utils/renderPage'

describe('ConfirmDialog', () => {
  it('renderiza título e mensagem', () => {
    renderPage(
      <ConfirmDialog
        title="Excluir administrador?"
        message="Fulano será removido do sistema."
        confirmLabel="Excluir"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Excluir administrador?')).toBeTruthy()
    expect(screen.getByText('Fulano será removido do sistema.')).toBeTruthy()
  })

  it('botão de confirmar chama onConfirm', () => {
    const onConfirm = vi.fn()
    renderPage(
      <ConfirmDialog
        title="Excluir administrador?"
        message="Fulano será removido do sistema."
        confirmLabel="Excluir"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('botão Cancelar chama onCancel', () => {
    const onCancel = vi.fn()
    renderPage(
      <ConfirmDialog
        title="Excluir administrador?"
        message="Fulano será removido do sistema."
        confirmLabel="Excluir"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('clicar no scrim chama onCancel', () => {
    const onCancel = vi.fn()
    renderPage(
      <ConfirmDialog
        title="Excluir administrador?"
        message="Fulano será removido do sistema."
        confirmLabel="Excluir"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByLabelText('Fechar'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape chama onCancel', () => {
    const onCancel = vi.fn()
    renderPage(
      <ConfirmDialog
        title="Excluir administrador?"
        message="Fulano será removido do sistema."
        confirmLabel="Excluir"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
