// describe/it/expect/vi vêm dos globals do Vitest.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { oxygenSafety, pressureSafety } from '@/test-utils/calibrationFixtures'
import { CalibrationSafetyTab } from './CalibrationSafetyTab'

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

const input = (id: string) => screen.getByTestId(id) as HTMLInputElement

afterEach(() => {
  clearSession()
  toast.show.mockReset()
})

describe('CalibrationSafetyTab: administrador', () => {
  it('mostra o padrão em texto e o que vale, com os campos preenchidos', async () => {
    await renderPage(
      <CalibrationSafetyTab
        safety={[oxygenSafety(), pressureSafety()]}
        canEdit
        onSave={vi.fn()}
        onRevert={vi.fn()}
      />,
    )
    const row = screen.getByTestId('safety-row-OXYGEN_LOW')
    expect(row).toHaveTextContent('Oxigenação baixa')
    expect(row).toHaveTextContent('Padrão: abaixo de 90% por 60 s')
    expect(row).toHaveTextContent('Em vigor: abre em 90%, fecha em 92%')
    expect(input('safety-OXYGEN_LOW-openAt').value).toBe('90')
    // Pressão tem os quatro valores.
    expect(input('safety-BLOOD_PRESSURE_HIGH-systolicAt').value).toBe('160')
    expect(input('safety-BLOOD_PRESSURE_HIGH-diastolicRecoverBelow').value).toBe('95')
    expect(screen.queryByRole('button', { name: /Voltar ao padrão/ })).not.toBeInTheDocument()
  })

  it('salva os quatro valores da pressão', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    await renderPage(
      <CalibrationSafetyTab
        safety={[pressureSafety()]}
        canEdit
        onSave={onSave}
        onRevert={vi.fn()}
      />,
    )
    fireEvent.change(input('safety-BLOOD_PRESSURE_HIGH-systolicAt'), {
      target: { value: '170' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar trava de Pressão alta' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('BLOOD_PRESSURE_HIGH', {
        systolicAt: 170,
        diastolicAt: 100,
        systolicRecoverBelow: 150,
        diastolicRecoverBelow: 95,
      }),
    )
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Trava salva', expect.any(String)))
  })

  it('a recusa do servidor vai para o toast', async () => {
    const refusal = 'A abertura da trava de oxigenação baixa deve ficar entre 80 e 95.'
    const onSave = vi.fn().mockResolvedValue(refusal)
    await renderPage(
      <CalibrationSafetyTab safety={[oxygenSafety()]} canEdit onSave={onSave} onRevert={vi.fn()} />,
    )
    fireEvent.change(input('safety-OXYGEN_LOW-openAt'), { target: { value: '97' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar trava de Oxigenação baixa' }))
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Não foi possível salvar a trava', refusal),
    )
    expect(screen.getByTestId('safety-error-OXYGEN_LOW')).toHaveTextContent(refusal)
  })

  it('valor em branco não sai da tela', async () => {
    const onSave = vi.fn()
    await renderPage(
      <CalibrationSafetyTab safety={[oxygenSafety()]} canEdit onSave={onSave} onRevert={vi.fn()} />,
    )
    fireEvent.change(input('safety-OXYGEN_LOW-closeAt'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar trava de Oxigenação baixa' }))
    expect(await screen.findByText('Informe um número.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('personalizada volta ao padrão depois de confirmar', async () => {
    const onRevert = vi.fn().mockResolvedValue(null)
    const custom = oxygenSafety({
      effective: { openAt: 88, closeAt: 91 },
      custom: true,
      updatedAt: '2026-10-21T12:00:00.000Z',
    })
    await renderPage(
      <CalibrationSafetyTab safety={[custom]} canEdit onSave={vi.fn()} onRevert={onRevert} />,
    )
    expect(screen.getByTestId('safety-row-OXYGEN_LOW')).toHaveTextContent('Personalizada')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao padrão: Oxigenação baixa' }))
    expect(screen.getByText('Voltar ao padrão?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao padrão' }))
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith('OXYGEN_LOW'))
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Trava de volta ao padrão', expect.any(String)),
    )
  })
})

describe('CalibrationSafetyTab: supervisor', () => {
  it('só lê: sem campos, sem salvar, com o aviso', async () => {
    const custom = oxygenSafety({ effective: { openAt: 88, closeAt: 91 }, custom: true })
    await renderPage(
      <CalibrationSafetyTab
        safety={[custom, pressureSafety()]}
        canEdit={false}
        onSave={vi.fn()}
        onRevert={vi.fn()}
      />,
    )
    expect(screen.getByText('Só o administrador ajusta as travas.')).toBeInTheDocument()
    expect(screen.getByTestId('safety-row-OXYGEN_LOW')).toHaveTextContent(
      'Em vigor: abre em 88%, fecha em 91%',
    )
    expect(screen.queryByTestId('safety-OXYGEN_LOW-openAt')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Salvar trava/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Voltar ao padrão/ })).not.toBeInTheDocument()
  })
})
