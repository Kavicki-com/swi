// Aba "Faixas" da página de calibração: uma linha por medição, com os dias
// válidos, o aprendido e o que está em vigor, e um campo por corte. Admin e
// supervisor corrigem; "Voltar ao aprendido" só aparece com correção gravada.
// Compõe Title, Text, StatusTag, Input e Button do DS como estão.
import { useState } from 'react'
import { View } from 'react-native'
import {
  Button,
  Input,
  StatusTag,
  Text,
  Title,
  useTheme,
  type StatusTagStatus,
} from '@kavicki/swi-design-system'
import type { CalibrationMetric, CalibrationMetricDetail, Cuts } from '@/services/api/calibration'
import { limitsLabelOf } from '@/services/vitals/calibrationView'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'
import { useDemoToast } from '@/lib/demoToast'
import {
  METRIC_TITLES,
  cutFieldsOf,
  cutsFromDraft,
  draftOfCuts,
  type Draft,
  type Errors,
} from '../calibrationFields'
import type { WriteResult } from '../hooks/useWorkerCalibration'

type Props = {
  metrics: CalibrationMetricDetail[]
  onSave: (metric: CalibrationMetric, cuts: Cuts) => WriteResult
  onRevert: (metric: CalibrationMetric) => WriteResult
}

const SOURCE_TAGS: Record<
  CalibrationMetricDetail['source'],
  { label: string; status: StatusTagStatus }
> = {
  OVERRIDE: { label: 'Corrigida pelo gestor', status: 'pending' },
  LEARNED: { label: 'Aprendida', status: 'accept' },
  START: { label: 'Partida padrão', status: 'info' },
}

const validDaysLabel = (n: number) => (n === 1 ? '1 dia válido' : `${n} dias válidos`)

export function CalibrationBandsTab({ metrics, onSave, onRevert }: Props) {
  const theme = useTheme()
  const { show } = useDemoToast()
  const [reverting, setReverting] = useState<CalibrationMetric | null>(null)

  const confirmRevert = async () => {
    const metric = reverting
    setReverting(null)
    if (!metric) return
    const failure = await onRevert(metric)
    if (failure) show('Não foi possível voltar ao aprendido', failure)
    else show('Faixa de volta ao aprendido', `${METRIC_TITLES[metric]} segue o que foi aprendido.`)
  }

  return (
    <View testID="calibration-bands" style={{ gap: theme.gap.m }}>
      {metrics.map((band) => (
        // A chave muda com o efetivo: depois de salvar, os campos voltam ao que vale.
        <BandRow
          key={`${band.metric}:${JSON.stringify(band.effective)}`}
          band={band}
          onSave={onSave}
          onAskRevert={() => setReverting(band.metric)}
        />
      ))}
      {reverting ? (
        <ConfirmDialog
          title="Voltar ao aprendido?"
          message={`A correção de ${METRIC_TITLES[reverting]} sai, e a faixa volta a seguir o que o sistema aprendeu com as medições.`}
          confirmLabel="Voltar ao aprendido"
          onConfirm={() => void confirmRevert()}
          onCancel={() => setReverting(null)}
        />
      ) : null}
    </View>
  )
}

function BandRow({
  band,
  onSave,
  onAskRevert,
}: {
  band: CalibrationMetricDetail
  onSave: Props['onSave']
  onAskRevert: () => void
}) {
  const theme = useTheme()
  const { show } = useDemoToast()
  const { metric } = band
  const title = METRIC_TITLES[metric]
  const fields = cutFieldsOf(metric)
  const [draft, setDraft] = useState<Draft>(() => draftOfCuts(metric, band.effective))
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const tag = SOURCE_TAGS[band.source]

  const save = async () => {
    const result = cutsFromDraft(metric, draft)
    setServerError(null)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaving(true)
    const failure = await onSave(metric, result.cuts)
    setSaving(false)
    if (failure) {
      setServerError(failure)
      show('Não foi possível salvar a faixa', failure)
    } else {
      show('Faixa salva', `${title} passa a valer com os cortes novos.`)
    }
  }

  return (
    <View
      testID={`band-row-${metric}`}
      // O Input do DS pinta o campo em surface.standard: num cartão da mesma
      // cor ele some. Como nos formulários do painel, o campo fica sobre o
      // background, e a borda delimita o cartão.
      style={{
        backgroundColor: theme.background,
        borderWidth: theme.border.size.s,
        borderColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.m,
        gap: theme.gap.s,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: theme.gap.m,
        }}
      >
        <View style={{ gap: theme.gap.xs, flexShrink: 1 }}>
          <Title variant="title.xs" color={theme.content.dark}>
            {title}
          </Title>
          <Text variant="body.s" color={theme.content.medium}>
            {validDaysLabel(band.validDays)}
          </Text>
        </View>
        <StatusTag status={tag.status} label={tag.label} />
      </View>

      <Text variant="body.s" color={theme.content.medium}>
        {`Aprendido: ${limitsLabelOf(metric, band.learned) ?? 'sem cortes'}`}
      </Text>
      <Text variant="body.m" color={theme.content.dark}>
        {`Em vigor: ${limitsLabelOf(metric, band.effective) ?? 'sem cortes'}`}
      </Text>

      {/* Respiro entre o resumo e os rótulos dos campos, que encostavam. */}
      <View
        testID={`band-inputs-${metric}`}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s, marginTop: theme.gap.m }}
      >
        {fields.map((field) => (
          <View key={field.key} style={{ flexGrow: 1, flexBasis: '40%' }}>
            <Input
              testID={`band-${metric}-${field.key}`}
              accessibilityLabel={`${title}: ${field.label}`}
              label={field.label}
              value={draft[field.key] ?? ''}
              onChangeText={(text) => setDraft((prev) => ({ ...prev, [field.key]: text }))}
              keyboardType="decimal-pad"
              description={errors[field.key]}
              descriptionVariant={errors[field.key] ? 'error' : 'default'}
            />
          </View>
        ))}
      </View>
      <Text variant="body.s" color={theme.content.medium}>
        Campo em branco desliga aquele corte.
      </Text>

      {serverError ? (
        <Text testID={`band-error-${metric}`} variant="body.s" color={theme.content.error}>
          {serverError}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
        <Button
          label={saving ? 'Salvando…' : 'Salvar'}
          variant="contained"
          accessibilityLabel={`Salvar faixa de ${title}`}
          disabled={saving}
          onPress={() => void save()}
        />
        {band.override !== null ? (
          <Button
            label="Voltar ao aprendido"
            variant="outline"
            accessibilityLabel={`Voltar ao aprendido: ${title}`}
            disabled={saving}
            onPress={onAskRevert}
          />
        ) : null}
      </View>
    </View>
  )
}
