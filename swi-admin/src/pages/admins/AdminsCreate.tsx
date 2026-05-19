// src/pages/admins/AdminsCreate.tsx
// Admin registration form — Figma 48:5151. Three sections (Dados do cadastro,
// Dados de saúde, Exames clínicos) followed by Voltar / Finalizar Cadastro
// footer. Rendered by AdminsList when tab='cadastrar'.
import { useState } from 'react'
import { View } from 'react-native'
import {
  Button,
  Combobox,
  Icon,
  ImageUploader,
  Input,
  Radio,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'

type FormState = {
  // Dados do cadastro
  nomeCompleto: string
  email: string
  telefone: string
  dataNascimento: string
  cpf: string
  nomeUsuario: string
  senha: string
  // Dados de saúde
  tipoSanguineo: string
  genero: string
  alergico: 'sim' | 'nao' | ''
  alergicoDesc: string
  doencasCronicas: 'sim' | 'nao' | ''
  doencasCronicasDesc: string
}

const TIPO_SANGUINEO_OPTIONS = [
  { value: 'a+', label: 'A+' },
  { value: 'a-', label: 'A-' },
  { value: 'b+', label: 'B+' },
  { value: 'b-', label: 'B-' },
  { value: 'ab+', label: 'AB+' },
  { value: 'ab-', label: 'AB-' },
  { value: 'o+', label: 'O+' },
  { value: 'o-', label: 'O-' },
]

const GENERO_OPTIONS = [
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'nao-binario', label: 'Não-binário' },
  { value: 'outro', label: 'Outro' },
  { value: 'prefiro-nao-informar', label: 'Prefiro não informar' },
]

type SectionProps = { title: string; children: React.ReactNode }

function Section({ title, children }: SectionProps) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.s }}>
      <Title variant="title.xs" color={theme.content.primary}>
        {title}
      </Title>
      <View style={{ gap: theme.gap.s }}>{children}</View>
    </View>
  )
}

type YesNoFieldProps = {
  label: string
  value: 'sim' | 'nao' | ''
  onChange: (v: 'sim' | 'nao') => void
}

function YesNoField({ label, value, onChange }: YesNoFieldProps) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.xs }}>
      {/* Matches the Figma body/m bold spec used by the DS Input.Label
          (14px Inter, weight 700). DS Text has body.m at 14px regular and
          no built-in bold variant, so we override only weight inline — all
          other tokens (family, size, color) flow from the variant. */}
      <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
        {label}
      </Text>
      {/* minHeight matches the sibling Input.Row height (label+gap+padded row)
          so the radios end up vertically centered at the same y as the input
          field text — keeps the "Sim/Não" controls visually paired with the
          "Quais?" input box. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.l,
          minHeight: 43,
        }}
      >
        <Radio label="Sim" checked={value === 'sim'} onChange={(c) => c && onChange('sim')} />
        <Radio label="Não" checked={value === 'nao'} onChange={(c) => c && onChange('nao')} />
      </View>
    </View>
  )
}

export function AdminsCreate({
  onBack,
  subject = 'administrador',
}: {
  onBack?: () => void
  // Customizes the "Nome Completo" placeholder so this form can be reused
  // for /employees cadastro (subject="funcionário") without duplicating 250
  // lines of fields/validation/upload wiring. Both admin and employee
  // registration use the same Figma template (48:5151 / 53:5816).
  subject?: 'administrador' | 'funcionário'
}) {
  const theme = useTheme()
  const [form, setForm] = useState<FormState>({
    nomeCompleto: '',
    email: '',
    telefone: '',
    dataNascimento: '',
    cpf: '',
    nomeUsuario: '',
    senha: '',
    tipoSanguineo: '',
    genero: '',
    alergico: '',
    alergicoDesc: '',
    doencasCronicas: '',
    doencasCronicasDesc: '',
  })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <View testID="admins-create" style={{ gap: theme.gap.l }}>
      <Section title="Dados de cadastro">
        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Nome Completo"
              placeholder={`Nome completo do novo ${subject}`}
              value={form.nomeCompleto}
              onChangeText={(v) => update('nomeCompleto', v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Email"
              placeholder="seu@email.com"
              value={form.email}
              onChangeText={(v) => update('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Telefone"
              placeholder="(00) 00000-0000"
              value={form.telefone}
              onChangeText={(v) => update('telefone', v)}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Data de Nascimento"
              placeholder="DD/MM/AAAA"
              value={form.dataNascimento}
              onChangeText={(v) => update('dataNascimento', v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="CPF"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChangeText={(v) => update('cpf', v)}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Nome do usuário"
              placeholder="usuario"
              value={form.nomeUsuario}
              onChangeText={(v) => update('nomeUsuario', v)}
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Senha"
              placeholder="digite aqui"
              value={form.senha}
              onChangeText={(v) => update('senha', v)}
              secureTextEntry
              iconRight={<Icon name="visibility" size={20} color={theme.content.dark} />}
            />
          </View>
        </View>
      </Section>

      <Section title="Dados de saúde">
        {/* position:relative + zIndex lifts the Combobox row above the YesNo
            questions, ImageUploader and footer that follow. Without this, the
            dropdown panels paint behind later DOM siblings. */}
        <View style={{ flexDirection: 'row', gap: theme.gap.s, position: 'relative', zIndex: 10 }}>
          <View style={{ flex: 1 }}>
            <Combobox
              label="Tipo sanguíneo"
              placeholder="Selecione aqui"
              options={TIPO_SANGUINEO_OPTIONS}
              value={form.tipoSanguineo}
              onChange={(v) => update('tipoSanguineo', v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Combobox
              label="Gênero"
              placeholder="Selecione aqui"
              options={GENERO_OPTIONS}
              value={form.genero}
              onChange={(v) => update('genero', v)}
            />
          </View>
        </View>

        {/* Two yes/no questions stacked vertically. The describe Input next
            to each is disabled until the user picks "Sim" — matches Figma
            48:5151 / 53:5816 where the "Quais?" field is shown in the DS
            disabled state (outlined, faded placeholder) when answer is "Não". */}
        <View style={{ gap: theme.gap.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap.m }}>
            <View style={{ width: 240 }}>
              <YesNoField
                label="Possui alergias?"
                value={form.alergico}
                onChange={(v) => update('alergico', v)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Quais?"
                placeholder="Descrever aqui"
                value={form.alergicoDesc}
                onChangeText={(v) => update('alergicoDesc', v)}
                disabled={form.alergico !== 'sim'}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap.m }}>
            <View style={{ width: 240 }}>
              <YesNoField
                label="Doenças crônicas?"
                value={form.doencasCronicas}
                onChange={(v) => update('doencasCronicas', v)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Quais?"
                placeholder="Descrever aqui"
                value={form.doencasCronicasDesc}
                onChangeText={(v) => update('doencasCronicasDesc', v)}
                disabled={form.doencasCronicas !== 'sim'}
              />
            </View>
          </View>
        </View>
      </Section>

      <Section title="Exames clínicos">
        {/* Use DS defaults for helperText / pickFileLabel — the DS ships the
            exact Figma copy ("Selecione arquivos do tipo: JPG ou PNG",
            "Enviar arquivo" singular). Earlier this screen overrode both
            with subtly different strings (".JPG/.PNG" + plural) which is
            why the section diverged from the design. */}
        <ImageUploader showTakePhoto={false} accessibilityLabel="Upload de exames clínicos" />
      </Section>

      {/* Footer: two buttons sharing the section width 50/50 (full-width
          split) per Figma 48:5151. Voltar uses outline; Finalizar Cadastro
          is the primary green CTA (surface.primary), not the blue used
          elsewhere — matches the green action accent of this flow. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.s,
          marginTop: theme.gap.s,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            label="Voltar"
            variant="outline"
            size="large"
            fullWidth
            onPress={() => onBack?.()}
            accessibilityLabel="Voltar para a lista de administradores"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Finalizar Cadastro"
            variant="contained"
            size="large"
            fullWidth
            backgroundColor={theme.surface.primary}
            onPress={() => {
              /* Mock: no backend wiring yet. */
            }}
            accessibilityLabel="Finalizar cadastro do administrador"
          />
        </View>
      </View>
    </View>
  )
}
