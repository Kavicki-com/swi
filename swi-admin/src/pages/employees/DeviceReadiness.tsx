// Prontidão do celular Android dentro do bloco "Aparelho": por onde a leitura
// chega (caminho ativo), a última falha que o app relatou e a lista de
// prontidão, a mesma que o funcionário vê no app, com a hora do relato.
// O backend deriva caminhos e lista do relato e da data de nascimento; aqui só
// se escreve o que veio. Passo sem relato sai "não informado pelo app", nunca
// como pendência inventada. Sem guia por app do fabricante: o guia é do app.
//
// Composição de primitivos do DS (Step, StatusTag, Text, Button); nenhum
// primitivo é reimplementado aqui. A falha é só leitura, sem botão: quem tenta
// de novo é o funcionário, no app.
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, StatusTag, Step, Text, useTheme } from '@kavicki/swi-design-system'
import type {
  ActivePath,
  ReadinessReport,
  ReadinessStep,
  ReadinessStepId,
  WorkerDevice,
} from '@/services/api/telemetryDevices'
import { useAuth } from '@/hooks/useAuth'
import { whenLabel } from '@/lib/whenLabel'

const PATH_LABEL: Record<string, string> = {
  HEALTH_CONNECT: 'Health Connect',
  BLUETOOTH: 'Bluetooth',
}

// Os textos dos passos seguem a ordem e as palavras da lista do app.
const STEP_LABEL: Partial<Record<ReadinessStepId, string>> = {
  PAIR: 'Parear o celular',
  HEALTH_CONNECT_INSTALL: 'Instalar ou atualizar o Health Connect',
  HEALTH_CONNECT_READ: 'Permitir a leitura do Health Connect',
  HEALTH_CONNECT_BACKGROUND: 'Permitir a leitura em segundo plano',
  MANUFACTURER_APP: 'Ligar o envio no app do fabricante',
  BLUETOOTH_BAND: 'Escolher a pulseira por Bluetooth',
  BIRTH_DATE: 'Data de nascimento no cadastro',
}

const FAILURE_REASON: Record<string, string> = {
  PERMISSION_DENIED: 'Permissão do Health Connect negada',
  UNAVAILABLE: 'Health Connect ausente no celular',
  UPDATE_REQUIRED: 'Health Connect desatualizado',
}

// A escuta segue ligada nesses dois estados, mas sem a pulseira.
const DISCONNECTED = new Set(['SEARCHING', 'BLUETOOTH_OFF'])

function pathsLine(paths: ActivePath[]): string {
  const labels = paths.map((p) => PATH_LABEL[p]).filter((l): l is string => Boolean(l))
  return `Caminho ativo: ${labels.length ? labels.join(' e ') : 'nenhum'}`
}

/** "desde 14:32" hoje, "desde 03/10 às 14:32" em outro dia. */
function sinceLabel(iso: string, now: number): string | null {
  const when = whenLabel(iso, now)
  // whenLabel começa com "às " ou "em "; o resto é o que vem depois de "desde".
  return when ? `desde ${when.slice(3)}` : null
}

/**
 * A falha do Health Connect só vale se for mais nova que a última
 * sincronização com sucesso: depois dela, a última rodada deu certo.
 */
function healthConnectFailure(report: ReadinessReport): { at: string; reason: string } | null {
  const failure = report.healthConnect.lastFailure
  if (!failure) return null
  const lastSync = report.healthConnect.lastSyncAt
  if (lastSync && Date.parse(lastSync) >= Date.parse(failure.at)) return null
  return failure
}

function Failures({ report }: { report: ReadinessReport }) {
  const theme = useTheme()
  const now = Date.now()
  const hc = healthConnectFailure(report)
  const hcWhen = hc ? whenLabel(hc.at, now) : null
  const bt = report.bluetooth
  const btDown =
    bt.bandChosen === true && bt.listenerState !== null && DISCONNECTED.has(bt.listenerState)
  const btSince = btDown && bt.listenerStateSince ? sinceLabel(bt.listenerStateSince, now) : null
  return (
    <>
      {hc ? (
        <View testID="device-failure-health-connect" style={{ gap: theme.gap.xs }}>
          <StatusTag
            status="canceled"
            label={hcWhen ? `Sincronização falhou ${hcWhen}` : 'Sincronização falhou'}
          />
          {FAILURE_REASON[hc.reason] ? (
            <Text variant="body.s" color={theme.content.medium}>
              {FAILURE_REASON[hc.reason]}
            </Text>
          ) : null}
        </View>
      ) : null}
      {btDown ? (
        <View testID="device-failure-bluetooth" style={{ gap: theme.gap.xs }}>
          <StatusTag
            status="canceled"
            label={btSince ? `Pulseira desconectada ${btSince}` : 'Pulseira desconectada'}
          />
          {bt.listenerState === 'BLUETOOTH_OFF' ? (
            <Text variant="body.s" color={theme.content.medium}>
              Bluetooth desligado no celular
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  )
}

function StepRow({
  step,
  number,
  workerId,
}: {
  step: ReadinessStep
  number: number
  workerId: string
}) {
  const theme = useTheme()
  const navigate = useNavigate()
  // Sessão sem nível vale Administrador, como no guarda das rotas de gestão.
  const isAdmin = (useAuth().user?.level ?? 'ADMIN') === 'ADMIN'
  const label = STEP_LABEL[step.id] ?? step.id
  const birthDateMissing = step.id === 'BIRTH_DATE' && step.pendente === true
  return (
    <View testID={`readiness-step-${step.id}`} style={{ gap: theme.gap.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Step state={step.pendente === false ? 'done' : 'default'} number={number} />
        <Text
          variant="body.s"
          color={step.pendente === false ? theme.content.medium : theme.content.dark}
          style={{ flexShrink: 1 }}
        >
          {label}
        </Text>
        {step.obrigatorio ? null : <StatusTag status="info" label="Opcional" />}
        {step.pendente === true ? <StatusTag status="pending" label="Pendente" /> : null}
      </View>
      {step.pendente === null ? (
        <Text variant="body.s" color={theme.content.medium}>
          não informado pelo app
        </Text>
      ) : null}
      {birthDateMissing ? (
        isAdmin ? (
          <Button
            label="Preencher no cadastro"
            variant="ghost"
            accessibilityLabel="Preencher a data de nascimento no cadastro"
            onPress={() => navigate(`/employees/${encodeURIComponent(workerId)}/edit`)}
          />
        ) : (
          <Text variant="body.s" color={theme.content.medium}>
            Só o administrador corrige o cadastro.
          </Text>
        )
      ) : null}
    </View>
  )
}

/**
 * Caminho, falha e lista de prontidão do celular Android. Nada no iPhone: lá
 * a lista não se aplica e o backend manda os campos nulos.
 */
export function DeviceReadiness({ device, workerId }: { device: WorkerDevice; workerId: string }) {
  const theme = useTheme()
  const steps = device.pendencias
  if (!steps) return null
  const reportedAt = device.relatadoEm ? whenLabel(device.relatadoEm, Date.now()) : null
  return (
    <>
      <Text variant="body.s" color={theme.content.dark}>
        {pathsLine(device.caminhosAtivos ?? [])}
      </Text>
      {device.relato ? <Failures report={device.relato} /> : null}
      <View testID="device-readiness" style={{ gap: theme.gap.s }}>
        <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
          Lista de prontidão
        </Text>
        <Text variant="body.s" color={theme.content.medium}>
          {reportedAt
            ? `Informado pelo app ${reportedAt}`
            : 'O app ainda não informou a prontidão.'}
        </Text>
        {steps.map((step, i) => (
          <StepRow key={step.id} step={step} number={i + 1} workerId={workerId} />
        ))}
      </View>
    </>
  )
}
