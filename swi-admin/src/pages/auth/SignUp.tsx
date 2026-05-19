// src/pages/auth/SignUp.tsx
//
// B2B company sign-up — Figma frame 22:2178.
// Layout: 2-column (form on the left, Logo top-right) on wider viewports;
// stacks naturally on narrow viewports thanks to flex-wrap on the form rows.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Image, View } from 'react-native'
import { Button, Input, Logo, Radio, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'
import signupBg from '@/assets/bg/signup-bg.png'

type Role = 'owner' | 'partner' | 'manager' | 'safety'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Dono/Fundador' },
  { value: 'partner', label: 'Sócio' },
  { value: 'manager', label: 'Gestor' },
  { value: 'safety', label: 'Segurança do trabalho' },
]

export function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()

  const [company, setCompany] = useState({ name: '', cnpj: '', site: '' })
  const [address, setAddress] = useState({
    cep: '',
    street: '',
    number: '',
    neighborhood: '',
    uf: '',
  })
  const [responsible, setResponsible] = useState<{
    name: string
    phone: string
    email: string
    role: Role | ''
  }>({ name: '', phone: '', email: '', role: '' })

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    setError(null)

    // Section 1: Dados da empresa
    if (!requiredText(company.name)) {
      setError('Informe o nome da empresa')
      return
    }
    if (!requiredText(company.cnpj)) {
      setError('Informe o CNPJ da empresa')
      return
    }
    // company.site is optional

    // Section 2: Dados do endereço
    if (!requiredText(address.cep)) {
      setError('Informe o CEP')
      return
    }
    if (!requiredText(address.street)) {
      setError('Informe o logradouro')
      return
    }
    if (!requiredText(address.number)) {
      setError('Informe o número')
      return
    }
    if (!requiredText(address.neighborhood)) {
      setError('Informe o bairro')
      return
    }
    if (!requiredText(address.uf)) {
      setError('Informe a UF')
      return
    }

    // Section 3: Dados do responsável
    if (!requiredText(responsible.name)) {
      setError('Informe o nome do responsável')
      return
    }
    if (!requiredText(responsible.phone)) {
      setError('Informe o telefone do responsável')
      return
    }
    if (!isEmail(responsible.email)) {
      setError('E-mail inválido')
      return
    }
    if (!responsible.role) {
      setError('Selecione a função do responsável na empresa')
      return
    }

    setLoading(true)
    const result = await signUp({
      email: responsible.email,
      // TODO(S2): replace with proper invite-flow when mockApi.signUp accepts B2B payload
      password: 'pending',
      full_name: responsible.name,
      consent: true,
    })
    setLoading(false)
    if (result.ok) {
      navigate('/', { replace: true })
    } else {
      setError(result.message ?? 'Falha ao cadastrar')
    }
  }

  const sectionHeader = (label: string) => (
    <Title variant="title.xs" color={theme.content.primary}>
      {label}
    </Title>
  )

  return (
    <View
      testID="signup-page"
      style={{
        flex: 1,
        minHeight: '100vh' as unknown as number,
        backgroundColor: theme.background,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* L0 — full-screen Figma backdrop (covers viewport with cover/bleed). */}
      <Image
        source={{ uri: signupBg }}
        accessible={false}
        resizeMode="cover"
        testID="signup-bg-l0"
        // eslint-disable-next-line react-native/no-inline-styles
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* L1 — dark panel (#171717) with diagonal cut at bottom-right.
          SVG path from Figma 22:2432 is `M0 0H1066L818 829H0V0Z`; converting
          to percent inside a 1066×829 box gives the polygon below. The cut
          exposes the L0 backdrop (creating the blue corner glow). */}
      <View
        aria-hidden
        testID="signup-bg-l1"
        style={
          {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1066,
            maxWidth: '100%',
            height: 829,
            maxHeight: '100%',
            backgroundColor: '#171717',
            pointerEvents: 'none',
            clipPath: 'polygon(0 0, 100% 0, 76.74% 100%, 0 100%)',
          } as object
        }
      />
      {/* Foreground content wrapper — keeps the existing responsive flex-wrap. */}
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: theme.padding.xl,
          gap: theme.gap.xl,
        }}
      >
        {/* Form column (left) */}
        <View
          style={{
            width: 596,
            maxWidth: '100%' as unknown as number,
            gap: theme.gap.xl,
          }}
        >
          {/* Section 1: Dados da empresa */}
          <View style={{ gap: theme.gap.sm }}>
            {sectionHeader('Dados da empresa')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.sm }}>
              <View style={{ width: 596, maxWidth: '100%' as unknown as number }}>
                <Input
                  label="Nome da empresa"
                  accessibilityLabel="Nome da empresa"
                  value={company.name}
                  onChangeText={(v: string) => setCompany((c) => ({ ...c, name: v }))}
                />
              </View>
              <View style={{ width: 292, flexGrow: 1 }}>
                <Input
                  label="CNPJ"
                  accessibilityLabel="CNPJ"
                  placeholder="00.000.000/0001-00"
                  value={company.cnpj}
                  onChangeText={(v: string) => setCompany((c) => ({ ...c, cnpj: v }))}
                />
              </View>
              <View style={{ width: 292, flexGrow: 1 }}>
                <Input
                  label="Site"
                  accessibilityLabel="Site"
                  placeholder="www.sitedaempresa.com.br"
                  value={company.site}
                  onChangeText={(v: string) => setCompany((c) => ({ ...c, site: v }))}
                  autoCapitalize="none"
                />
              </View>
            </View>
          </View>

          {/* Section 2: Dados do endereço */}
          <View style={{ gap: theme.gap.sm }}>
            {sectionHeader('Dados do endereço')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.sm }}>
              <View style={{ width: 107 }}>
                <Input
                  label="CEP"
                  accessibilityLabel="CEP"
                  placeholder="00000-000"
                  value={address.cep}
                  onChangeText={(v: string) => setAddress((a) => ({ ...a, cep: v }))}
                />
              </View>
              <View style={{ width: 477, flexGrow: 1 }}>
                <Input
                  label="Logradouro"
                  accessibilityLabel="Logradouro"
                  placeholder="Avenida Quatro de Julho"
                  value={address.street}
                  onChangeText={(v: string) => setAddress((a) => ({ ...a, street: v }))}
                />
              </View>
              <View style={{ width: 147 }}>
                <Input
                  label="Número"
                  accessibilityLabel="Número"
                  placeholder="00"
                  value={address.number}
                  onChangeText={(v: string) => setAddress((a) => ({ ...a, number: v }))}
                />
              </View>
              <View style={{ width: 353, flexGrow: 1 }}>
                <Input
                  label="Bairro"
                  accessibilityLabel="Bairro"
                  placeholder="Pampulha"
                  value={address.neighborhood}
                  onChangeText={(v: string) => setAddress((a) => ({ ...a, neighborhood: v }))}
                />
              </View>
              <View style={{ width: 71 }}>
                <Input
                  label="UF"
                  accessibilityLabel="UF"
                  placeholder="MG"
                  value={address.uf}
                  onChangeText={(v: string) => setAddress((a) => ({ ...a, uf: v }))}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          </View>

          {/* Section 3: Dados do responsável */}
          <View style={{ gap: theme.gap.sm }}>
            {sectionHeader('Dados do responsável')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.sm }}>
              <View style={{ width: 596, maxWidth: '100%' as unknown as number }}>
                <Input
                  label="Nome"
                  accessibilityLabel="Nome"
                  placeholder="Nome do Responsável"
                  value={responsible.name}
                  onChangeText={(v: string) => setResponsible((r) => ({ ...r, name: v }))}
                />
              </View>
              <View style={{ width: 284, flexGrow: 1 }}>
                <Input
                  label="Telefone"
                  accessibilityLabel="Telefone"
                  placeholder="(00) 00000-0000"
                  value={responsible.phone}
                  onChangeText={(v: string) => setResponsible((r) => ({ ...r, phone: v }))}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={{ width: 296, flexGrow: 1 }}>
                <Input
                  label="Email"
                  accessibilityLabel="Email"
                  placeholder="seu@email.com"
                  value={responsible.email}
                  onChangeText={(v: string) => setResponsible((r) => ({ ...r, email: v }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={{ gap: theme.gap.sm, marginTop: theme.gap.s }}>
              <Text variant="body.m" style={{ fontWeight: '700' as const }}>
                Qual a sua função na empresa?
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.m }}>
                {ROLE_OPTIONS.map((opt) => (
                  <Radio
                    key={opt.value}
                    label={opt.label}
                    accessibilityLabel={opt.label}
                    value={opt.value}
                    checked={responsible.role === opt.value}
                    onChange={(checked: boolean) => {
                      if (checked) setResponsible((r) => ({ ...r, role: opt.value }))
                    }}
                  />
                ))}
              </View>
            </View>
          </View>

          <FormError message={error} />

          {/* Actions row */}
          <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                variant="outline"
                label="Voltar"
                fullWidth
                accessibilityLabel="Voltar"
                onPress={() => navigate('/login')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="contained"
                label="Finalizar Cadastro"
                fullWidth
                accessibilityLabel="Finalizar Cadastro"
                onPress={onSubmit}
                disabled={loading}
              />
            </View>
          </View>
        </View>

        {/* Logo column (right top) */}
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: theme.padding.s,
          }}
        >
          <Logo size="l" />
        </View>
      </View>
    </View>
  )
}
