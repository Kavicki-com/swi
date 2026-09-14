// Bloco "Aparelho" do detalhe do funcionário: pareamento do iPhone do piloto.
// Composição de primitivos do DS (StatusTag, Title, TimeStamp, Text, Button);
// nenhum primitivo é reimplementado aqui. O bloco é dono do próprio ciclo:
// carrega o estado, gera o código, conta a validade, revoga com confirmação.
//
// O código só existe em claro no retorno da criação (regra do backend). Depois
// de recarregar a página o painel sabe que há um código válido, e até quando,
// mas não qual; gerar outro é permitido e o anterior continua valendo até
// expirar.
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { Button, StatusTag, Text, TimeStamp, Title, useTheme } from '@kavicki/swi-design-system'
import { telemetryDevicesApi, type WorkerDevice } from '@/services/api/telemetryDevices'
import { useDemoToast } from '@/lib/demoToast'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unpaired'; pendingUntil: string | null }
  | { kind: 'code'; code: string; expiresAt: string }
  | { kind: 'paired'; device: WorkerDevice; confirming: boolean }

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const dayAndClock = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function DeviceSection({ workerId }: { workerId: string }) {
  const theme = useTheme()
  const { show: showToast } = useDemoToast()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  // Relógio local só para a validade do código: um tick por segundo enquanto
  // houver código na tela, e nenhum fora disso.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const { data, error } = await telemetryDevicesApi.stateOf(workerId)
    if (error || !data) {
      setPhase({ kind: 'error' })
      return
    }
    if (data.device) {
      setPhase({ kind: 'paired', device: data.device, confirming: false })
      return
    }
    setPhase({ kind: 'unpaired', pendingUntil: data.pendingEnrollment?.expiresAt ?? null })
  }, [workerId])

  useEffect(() => {
    let cancelled = false
    setPhase({ kind: 'loading' })
    telemetryDevicesApi.stateOf(workerId).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) {
        setPhase({ kind: 'error' })
      } else if (data.device) {
        setPhase({ kind: 'paired', device: data.device, confirming: false })
      } else {
        setPhase({ kind: 'unpaired', pendingUntil: data.pendingEnrollment?.expiresAt ?? null })
      }
    })
    return () => {
      cancelled = true
    }
  }, [workerId])

  useEffect(() => {
    if (phase.kind !== 'code') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [phase.kind])

  const pair = async () => {
    setBusy(true)
    const { data, error } = await telemetryDevicesApi.createEnrollment(workerId)
    setBusy(false)
    if (error || !data) {
      showToast('Falha ao gerar o código', error?.message ?? 'Tente de novo')
      return
    }
    setNow(Date.now())
    setPhase({ kind: 'code', code: data.code, expiresAt: data.expiresAt })
  }

  const revoke = async (device: WorkerDevice) => {
    setBusy(true)
    const { error } = await telemetryDevicesApi.revoke(device.id)
    setBusy(false)
    if (error) {
      showToast('Falha ao revogar', error.message)
      setPhase({ kind: 'paired', device, confirming: false })
      return
    }
    await load()
  }

  const heading = (
    <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
      Aparelho
    </Text>
  )

  if (phase.kind === 'loading') {
    return (
      <View testID="device-section-loading" style={{ gap: theme.gap.s }}>
        {heading}
        <Text variant="body.s" color={theme.content.medium}>
          Carregando aparelho…
        </Text>
      </View>
    )
  }

  if (phase.kind === 'error') {
    return (
      <View testID="device-section-error" style={{ gap: theme.gap.s }}>
        {heading}
        <Text variant="body.s" color={theme.content.medium}>
          Não foi possível carregar o aparelho.
        </Text>
        <Button
          label="Tentar de novo"
          variant="outline"
          accessibilityLabel="Tentar carregar o aparelho de novo"
          onPress={() => void load()}
        />
      </View>
    )
  }

  if (phase.kind === 'code') {
    const expired = Date.parse(phase.expiresAt) <= now
    return (
      <View testID={expired ? 'device-section-code-expired' : 'device-section-code'} style={{ gap: theme.gap.s }}>
        {heading}
        {expired ? (
          <>
            <StatusTag status="canceled" label="Código expirado" />
            <Text variant="body.s" color={theme.content.medium}>
              O código não foi usado a tempo. Gere outro e leia para o funcionário.
            </Text>
            <Button
              label={busy ? 'Gerando…' : 'Gerar outro'}
              variant="contained"
              disabled={busy}
              accessibilityLabel="Gerar outro código de pareamento"
              onPress={() => void pair()}
            />
          </>
        ) : (
          <>
            <StatusTag status="pending" label="Aguardando o funcionário" />
            <Title variant="title.m" color={theme.content.dark} testID="device-code">
              {phase.code}
            </Title>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
              <Text variant="body.s" color={theme.content.medium}>
                Válido até
              </Text>
              <TimeStamp time={clock(phase.expiresAt)} testID="device-code-expires" />
            </View>
            <Text variant="body.s" color={theme.content.medium}>
              Leia o código para o funcionário. Ele digita no app, em Parear aparelho.
            </Text>
          </>
        )}
      </View>
    )
  }

  if (phase.kind === 'unpaired') {
    return (
      <View testID="device-section-unpaired" style={{ gap: theme.gap.s }}>
        {heading}
        <StatusTag status="canceled" label="Não pareado" />
        {phase.pendingUntil ? (
          <Text variant="body.s" color={theme.content.medium}>
            {`Há um código válido até ${clock(phase.pendingUntil)}, gerado nesta ou noutra sessão do painel. Gerar outro não invalida o anterior antes de expirar.`}
          </Text>
        ) : (
          <Text variant="body.s" color={theme.content.medium}>
            Gere um código de seis dígitos e leia para o funcionário. Ele digita no app, em Parear aparelho.
          </Text>
        )}
        <Button
          label={busy ? 'Gerando…' : phase.pendingUntil ? 'Gerar outro' : 'Parear'}
          variant="contained"
          disabled={busy}
          accessibilityLabel="Gerar código de pareamento"
          onPress={() => void pair()}
        />
      </View>
    )
  }

  const { device, confirming } = phase
  return (
    <View testID="device-section-paired" style={{ gap: theme.gap.s }}>
      {heading}
      <StatusTag status="accept" label="Pareado" />
      <Text variant="body.s" color={theme.content.dark}>
        {`Desde ${dayAndClock(device.pairedAt)}${device.model ? `, ${device.model}` : ''}`}
      </Text>
      <Text variant="body.s" color={theme.content.medium}>
        {device.lastSeenAt ? `Último contato às ${clock(device.lastSeenAt)}` : 'Sem contato ainda'}
      </Text>
      {confirming ? (
        <>
          <Text variant="body.s" color={theme.content.dark}>
            O aparelho perde o acesso na hora. O app do funcionário volta a pedir pareamento.
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <Button
              label={busy ? 'Revogando…' : 'Confirmar revogação'}
              variant="contained"
              backgroundColor={theme.surface.danger}
              labelColor={theme.content.light}
              disabled={busy}
              accessibilityLabel="Confirmar a revogação do aparelho"
              onPress={() => void revoke(device)}
            />
            <Button
              label="Cancelar"
              variant="ghost"
              disabled={busy}
              accessibilityLabel="Cancelar a revogação"
              onPress={() => setPhase({ kind: 'paired', device, confirming: false })}
            />
          </View>
        </>
      ) : (
        <Button
          label="Revogar"
          variant="outline"
          accessibilityLabel="Revogar o aparelho pareado"
          onPress={() => setPhase({ kind: 'paired', device, confirming: true })}
        />
      )}
    </View>
  )
}
