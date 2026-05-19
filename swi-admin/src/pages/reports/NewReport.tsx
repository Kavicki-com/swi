// src/pages/reports/NewReport.tsx
// /reports/new — Figma 105:11725. Lives inside AppLayout. Form with:
//   1. Voltar GhostButton.
//   2. Title row: "Novo relatório" green + "Atribuir responsáveis" CTA.
//   3. Inputs: Título / Resumo / Detalhes (tall).
//   4. "Anexos" section: 4 image slot placeholders + DS ImageUploader.
//   5. Actions: Cancelar (outline) + Salvar relatório (contained green).
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Icon,
  ImageUploader,
  Input,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { useDemoToast } from '@/lib/demoToast'

// Empty image slot — Figma 105:12461 placeholder for an uploaded attachment.
// Solid surface.high tile with a centered photo glyph.
function AttachmentSlot() {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 165,
        height: 132,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.high,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="add_a_photo" size={32} color={theme.content.medium} />
    </View>
  )
}

export function NewReport() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')

  return (
    <View testID="new-report" style={{ gap: theme.gap.l }}>
      {/* Section 1 — Voltar GhostButton. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar para a lista de relatórios"
          onPress={() => navigate('/reports')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: theme.padding.sm,
            paddingVertical: theme.padding.sm,
            borderRadius: theme.border.radius.m,
          }}
        >
          <Icon name="keyboard_arrow_left" size={24} color={theme.content.primaryLight} />
          <Text
            variant="body.m"
            color={theme.content.primaryLight}
            style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
          >
            Voltar
          </Text>
        </Pressable>
      </View>

      {/* Section 2 — Title row: "Novo relatório" + Atribuir responsáveis. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Title variant="title.s" color={theme.content.primary}>
          Novo relatório
        </Title>
        <Button
          label="Atribuir responsáveis"
          variant="contained"
          iconRight={
            // @ts-expect-error add_circle is in local DS source; node_modules pin v0.1.35 doesn't have it yet.
            <Icon name="add_circle" size={24} color={theme.content.light} />
          }
          onPress={() => navigate('/modals/responsables')}
          accessibilityLabel="Atribuir responsáveis ao relatório"
        />
      </View>

      {/* Section 3 — Form inputs. */}
      <View style={{ gap: theme.gap.m }}>
        <Input
          label="Título do relatório"
          value={title}
          onChangeText={setTitle}
          placeholder="Nome completo do novo administrador"
        />
        <Input
          label="Resumo do relatório"
          value={summary}
          onChangeText={setSummary}
          placeholder="Digite aqui um resumo do seu relatório"
        />
        {/* No fixed-height wrapper: the DS Input doesn't propagate flex:1 to its
            internal TextInput, so a 365px wrapper leaves ~115px of empty space
            below the visible text-area before the next section. Let the Input
            flow at its natural multiline size — spacing to "Anexos" then comes
            cleanly from the parent section's gap.l (24px). */}
        <Input
          label="Detalhes do relatório"
          value={details}
          onChangeText={setDetails}
          placeholder="Digite aqui o seu relatório"
          multiline
          numberOfLines={12}
        />
      </View>

      {/* Section 4 — Anexos: 4 image slots + ImageUploader. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.xs" color={theme.content.primary}>
          Anexos
        </Title>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: theme.gap.m,
            flexWrap: 'wrap',
          }}
        >
          <AttachmentSlot />
          <AttachmentSlot />
          <AttachmentSlot />
          <AttachmentSlot />
          <View style={{ flex: 1, minWidth: 240 }}>
            <ImageUploader
              helperText="Selecione arquivos do tipo: JPG ou PNG"
              pickFileLabel="Enviar arquivo"
              accentColor={theme.content.primary}
              showTakePhoto={false}
            />
          </View>
        </View>
      </View>

      {/* Section 5 — Actions: Cancelar + Salvar relatório. */}
      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Cancelar"
            variant="outline"
            fullWidth
            onPress={() => navigate('/reports')}
            accessibilityLabel="Cancelar criação do relatório"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Salvar relatório"
            variant="contained"
            fullWidth
            accessibilityLabel="Salvar relatório"
            onPress={() => {
              showToast('Relatório salvo', title.trim() || 'Rascunho enviado para revisão')
              navigate('/reports')
            }}
          />
        </View>
      </View>
    </View>
  )
}
