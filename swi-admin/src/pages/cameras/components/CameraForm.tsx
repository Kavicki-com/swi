// Formulário de câmera: nome, posição marcada no mapa e endereço opcional.
// Criar manda tudo; editar manda só o que mudou, e endereço apagado vai como
// null, que o backend entende como "limpar".
import { useState } from 'react'
import { View } from 'react-native'
import { Button, Input, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { Camera, CameraInput } from '@/services/api/cameras'
import { PositionPicker, type LatLng } from './PositionPicker'

type Errors = { name?: string; position?: string; url?: string }

// Endereço completo (o navegador consegue abrir), só http ou https: o
// "https://" sozinho, ou com espaço no meio, não passa.
function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function changesFrom(initial: Camera, next: CameraInput): Partial<CameraInput> {
  const patch: Partial<CameraInput> = {}
  if (next.name !== initial.name) patch.name = next.name
  if (next.lat !== initial.lat || next.lng !== initial.lng) {
    patch.lat = next.lat
    patch.lng = next.lng
  }
  if (next.url !== initial.url) patch.url = next.url
  return patch
}

export function CameraForm({
  initial,
  center,
  onSubmit,
  onCancel,
}: {
  /** Câmera em edição; ausente, o formulário cria uma nova. */
  initial?: Camera
  center: [number, number]
  onSubmit: (input: CameraInput) => Promise<void>
  onCancel: () => void
}) {
  const theme = useTheme()
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [position, setPosition] = useState<LatLng | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : null,
  )
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    const next: Errors = {}
    if (!trimmedName) next.name = 'Informe o nome da câmera.'
    if (!position) next.position = 'Clique no mapa para marcar a posição.'
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      next.url = 'Informe o endereço completo, começando com http:// ou https://'
    }
    setErrors(next)
    if (next.name || next.position || next.url || !position) return

    setSaving(true)
    setSubmitError(null)
    try {
      await onSubmit({
        name: trimmedName,
        lat: position.lat,
        lng: position.lng,
        url: trimmedUrl || null,
      })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Não foi possível salvar a câmera')
      setSaving(false)
    }
  }

  return (
    <View testID="camera-form" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.primary}>
        {initial ? 'Editar câmera' : 'Nova câmera'}
      </Title>
      <Input
        testID="camera-form-name"
        label="Nome"
        placeholder="Ex.: Portaria norte"
        value={name}
        onChangeText={setName}
        maxLength={80}
        description={errors.name}
        descriptionVariant={errors.name ? 'error' : 'default'}
      />
      <PositionPicker
        value={position}
        center={center}
        onChange={setPosition}
        error={errors.position}
      />
      <Input
        testID="camera-form-url"
        label="Endereço da câmera (opcional)"
        placeholder="https://"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        description={errors.url ?? 'Página da câmera no sistema de monitoramento da obra.'}
        descriptionVariant={errors.url ? 'error' : 'default'}
      />
      {submitError ? (
        <Text testID="camera-form-error" variant="body.m" color={theme.content.error}>
          {submitError}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.gap.s }}>
        <Button label="Cancelar" variant="outline" onPress={onCancel} disabled={saving} />
        <Button label="Salvar" variant="contained" onPress={submit} disabled={saving} />
      </View>
    </View>
  )
}
