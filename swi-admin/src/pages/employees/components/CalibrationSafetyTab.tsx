// Aba "Travas" da página de calibração: o piso de proteção que não aprende.
// Cada trava mostra o padrão em texto (vem pronto do backend) e o que vale.
// Só o administrador edita e volta ao padrão; o supervisor lê. A pressão tem
// quatro valores (abre e fecha, sistólica e diastólica); as outras, dois.
import { useState } from 'react'
import { View } from 'react-native'
import { Button, Input, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { SafetyDetail, SafetyRule, SafetyValues } from '@/services/api/calibration'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'
import { useDemoToast } from '@/lib/demoToast'
import {
  SAFETY_TITLES,
  draftOfSafety,
  safetyFieldsOf,
  safetyFromDraft,
  safetyValuesLabel,
  type Draft,
  type Errors,
} from '../calibrationFields'
import type { WriteResult } from '../hooks/useWorkerCalibration'

type Props = {
  safety: SafetyDetail[]
  /** Só o administrador; o supervisor vê a mesma aba sem campos. */
  canEdit: boolean
  onSave: (rule: SafetyRule, values: SafetyValues) => WriteResult
  onRevert: (rule: SafetyRule) => WriteResult
}

export function CalibrationSafetyTab({ safety, canEdit, onSave, onRevert }: Props) {
  const theme = useTheme()
  const { show } = useDemoToast()
  const [reverting, setReverting] = useState<SafetyRule | null>(null)

  const confirmRevert = async () => {
    const rule = reverting
    setReverting(null)
    if (!rule) return
    const failure = await onRevert(rule)
    if (failure) show('Não foi possível voltar ao padrão', failure)
    else show('Trava de volta ao padrão', `${SAFETY_TITLES[rule]} segue o padrão do sistema.`)
  }

  return (
    <View testID="calibration-safety" style={{ gap: theme.gap.m }}>
      {canEdit ? null : (
        <Text testID="safety-read-only" variant="body.m" color={theme.content.medium}>
          Só o administrador ajusta as travas.
        </Text>
      )}
      {safety.map((item) => (
        <SafetyRow
          key={`${item.rule}:${JSON.stringify(item.effective)}`}
          item={item}
          canEdit={canEdit}
          onSave={onSave}
          onAskRevert={() => setReverting(item.rule)}
        />
      ))}
      {reverting ? (
        <ConfirmDialog
          title="Voltar ao padrão?"
          message={`A trava personalizada de ${SAFETY_TITLES[reverting]} sai, e vale de novo o padrão do sistema.`}
          confirmLabel="Voltar ao padrão"
          onConfirm={() => void confirmRevert()}
          onCancel={() => setReverting(null)}
        />
      ) : null}
    </View>
  )
}

function SafetyRow({
  item,
  canEdit,
  onSave,
  onAskRevert,
}: {
  item: SafetyDetail
  canEdit: boolean
  onSave: Props['onSave']
  onAskRevert: () => void
}) {
  const theme = useTheme()
  const { show } = useDemoToast()
  const { rule } = item
  const title = SAFETY_TITLES[rule]
  const [draft, setDraft] = useState<Draft>(() => draftOfSafety(rule, item.effective))
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const result = safetyFromDraft(rule, draft)
    setServerError(null)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaving(true)
    const failure = await onSave(rule, result.values)
    setSaving(false)
    if (failure) {
      setServerError(failure)
      show('Não foi possível salvar a trava', failure)
    } else {
      show('Trava salva', `${title} passa a valer com os valores novos.`)
    }
  }

  return (
    <View
      testID={`safety-row-${rule}`}
      style={{
        backgroundColor: theme.surface.standard,
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
        <Title variant="title.xs" color={theme.content.dark}>
          {title}
        </Title>
        <StatusTag
          status={item.custom ? 'pending' : 'info'}
          label={item.custom ? 'Personalizada' : 'Padrão'}
        />
      </View>
      <Text variant="body.s" color={theme.content.medium}>
        {`Padrão: ${item.defaultLabel}`}
      </Text>
      <Text variant="body.m" color={theme.content.dark}>
        {`Em vigor: ${safetyValuesLabel(rule, item.effective) ?? 'sem valores legíveis'}`}
      </Text>

      {canEdit ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
            {safetyFieldsOf(rule).map((field) => (
              <View key={field.key} style={{ flexGrow: 1, flexBasis: '40%' }}>
                <Input
                  testID={`safety-${rule}-${field.key}`}
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

          {serverError ? (
            <Text testID={`safety-error-${rule}`} variant="body.s" color={theme.content.error}>
              {serverError}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
            <Button
              label={saving ? 'Salvando…' : 'Salvar'}
              variant="contained"
              accessibilityLabel={`Salvar trava de ${title}`}
              disabled={saving}
              onPress={() => void save()}
            />
            {item.custom ? (
              <Button
                label="Voltar ao padrão"
                variant="outline"
                accessibilityLabel={`Voltar ao padrão: ${title}`}
                disabled={saving}
                onPress={onAskRevert}
              />
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  )
}
