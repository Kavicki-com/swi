// src/pages/user/UserSettings.tsx
// User settings screen ("user-settings"). Two-column form:
// LEFT  → Dados do cadastro (name, dob, cpf, email, phone, UF, city,
//         profissão, setor, função, gerente responsável)
// RIGHT → Tipo sanguíneo + Gênero comboboxes, alergias + doenças crônicas
//         textareas, Exames clínicos, Senha de acesso, Permissões.
// Footer → Sair + Salvar Alterações buttons.
// QA F (2026-07-24): a tela era 100% fake (prefill 'Carlos Sampaio', botões
// com toasts simulados). Agora: GET /profile/me pré-preenche, Salvar faz PUT,
// Alterar senha bate no /auth/password/change, foto/exames sobem via presign.
// Estado, efeitos e handlers moram em hooks/useUserSettings.
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Button,
  Combobox,
  Icon,
  Input,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { SupportModal } from '@/components/SupportModal'
import { FormError } from '@/components/FormError'
import { maskCpf, maskDate, maskPhone } from '@/lib/masks'
import { ExamsSection } from './components/ExamsSection'
import { PasswordSection } from './components/PasswordSection'
import { PermissionsSection } from './components/PermissionsSection'
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal'
import { GENDER_OPTIONS, useUserSettings } from './hooks/useUserSettings'

const BLOOD_OPTIONS = [
  { label: 'A+', value: 'A+' },
  { label: 'A-', value: 'A-' },
  { label: 'B+', value: 'B+' },
  { label: 'B-', value: 'B-' },
  { label: 'AB+', value: 'AB+' },
  { label: 'AB-', value: 'AB-' },
  { label: 'O+', value: 'O+' },
  { label: 'O-', value: 'O-' },
]

export function UserSettings() {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const isWide = breakpoint === 'wide'
  const { user, signOut } = useAuth()
  const {
    name,
    setName,
    dob,
    setDob,
    cpf,
    setCpf,
    email,
    phone,
    setPhone,
    uf,
    setUf,
    city,
    setCity,
    profissao,
    setProfissao,
    profissaoOptions,
    setor,
    setSetor,
    setorOptions,
    funcao,
    setFuncao,
    funcaoOptions,
    gerente,
    setGerente,
    gerenteOptions,
    bloodType,
    setBloodType,
    gender,
    setGender,
    allergies,
    setAllergies,
    chronic,
    setChronic,
    currentPw,
    setCurrentPw,
    newPw,
    setNewPw,
    confirmPw,
    setConfirmPw,
    pwError,
    changingPw,
    changePassword,
    showSupportModal,
    setShowSupportModal,
    showPrivacyModal,
    setShowPrivacyModal,
    exams,
    examName,
    setExamName,
    examDate,
    setExamDate,
    examError,
    examsBusy,
    pickExamFile,
    onExamSelected,
    examsInputRef,
    avatarUrl,
    avatarBusy,
    avatarInputRef,
    onAvatarSelected,
    saving,
    saveError,
    save,
  } = useUserSettings()

  return (
    <View testID="user-settings" style={{ gap: theme.gap.l }}>
      {/* Top bar — just "Voltar" link */}
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          onPress={() => navigate(-1)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.s,
            alignSelf: 'flex-start',
          }}
        >
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="keyboard_arrow_down" size={16} color={theme.content.primaryLight} />
          </View>
          <Text
            variant="body.m"
            color={theme.content.primaryLight}
            style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
          >
            Voltar
          </Text>
        </Pressable>
      </View>

      {/* Profile header — avatar + edit + 3 actions row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.m,
          borderBottomWidth: 1,
          borderBottomColor: theme.content.dark,
          paddingBottom: theme.padding.s,
        }}
      >
        {/* Inputs de arquivo escondidos (padrão house — NewReport). O click
            vem dos Pressables "Editar foto" / "Enviar exames clínicos". */}
        <input
          ref={avatarInputRef}
          data-testid="settings-avatar-input"
          type="file"
          accept="image/jpeg,image/png"
          style={{ display: 'none' }}
          onChange={onAvatarSelected}
        />
        {/* Laudo clínico costuma vir em PDF; o accept do avatar acima segue só
            imagem, porque foto de perfil em PDF não renderiza em lugar nenhum. */}
        <input
          ref={examsInputRef}
          data-testid="settings-exams-input"
          type="file"
          accept="application/pdf,image/jpeg,image/png,text/plain"
          style={{ display: 'none' }}
          onChange={onExamSelected}
        />
        <View style={{ position: 'relative' }}>
          {/* `name` alimenta o fallback de iniciais do DS 0.1.120 — este é o
              avatar de 108px, onde o disco cinza vazio era mais gritante. */}
          <Avatar
            uri={avatarUrl ?? user?.avatarUri}
            name={name}
            customSize={108}
            bordered
            borderWidth={4}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Editar foto"
            disabled={avatarBusy}
            onPress={() => avatarInputRef.current?.click()}
            style={{
              position: 'absolute',
              right: -4,
              top: -4,
              backgroundColor: theme.content.dark,
              borderRadius: 999,
              padding: theme.padding.s,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="edit" size={20} color={theme.content.light} />
          </Pressable>
        </View>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            // Tablet: wrap the 3 action links so they drop to a new line if
            // the avatar + label widths overflow. Reduce the fixed 61 px gap
            // to a more flexible value at tablet for the same reason.
            ...(isTablet
              ? ({ flexWrap: 'wrap', gap: theme.gap.m } as const)
              : ({ gap: 61 } as const)),
          }}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Abrir política de privacidade"
            onPress={() => setShowPrivacyModal(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: theme.padding.sm,
              paddingVertical: theme.padding.s,
            }}
          >
            <Text
              variant="body.m"
              color={theme.content.primary}
              style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
            >
              Política de privacidade e termos de uso
            </Text>
          </Pressable>
          {/* O gatilho de exames saiu daqui: era um upload em lote que só
              incrementava um contador. Virou a seção "Exames clínicos" da
              coluna da direita, com nome, validade e card. */}
        </View>
        <View>
          <Button
            label="Solicitar suporte"
            variant="contained"
            backgroundColor={theme.surface.secondary}
            size="small"
            onPress={() => setShowSupportModal(true)}
          />
        </View>
      </View>

      {/* Two-column body
          - Tablet (<1024): stack to single column.
          - Desktop (1024-1499): LEFT 502 + RIGHT flex:1, exato conforme o desenho.
          - Wide (>=1500): LEFT and RIGHT both flexBasis + flexGrow:1, so they
            grow proportionally to fill the viewport (boss directive).
          position:relative + zIndex lift the body row above the Sair/Salvar
          Alterações footer row (later DOM sibling). Combobox dropdown panels
          opened from inside LEFT/RIGHT cols can now overlay the footer
          instead of being painted under it. */}
      <View
        style={{
          flexDirection: isTablet ? 'column' : 'row',
          alignItems: isTablet ? 'stretch' : 'flex-start',
          gap: theme.gap.l,
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* LEFT column — Dados do cadastro */}
        <View
          style={{
            ...(isTablet
              ? null
              : isWide
                ? ({ flexBasis: 502, flexGrow: 1, flexShrink: 0 } as const)
                : { width: 502 }),
            gap: theme.gap.m,
          }}
        >
          <Title variant="title.xs" color={theme.content.primary}>
            Dados do cadastro
          </Title>
          <Input label="Nome Completo" value={name} onChangeText={setName} testID="settings-name" />
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ width: 192 }}>
              <Input
                label="Data de Nascimento"
                placeholder="dd/mm/aaaa"
                value={dob}
                onChangeText={(v) => setDob(maskDate(v))}
                testID="settings-dob"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="CPF"
                value={cpf}
                onChangeText={(v) => setCpf(maskCpf(v))}
                testID="settings-cpf"
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ flex: 1 }}>
              {/* E-mail de login: só leitura — trocar exige reverificação. */}
              <Input label="Email" value={email} disabled testID="settings-email" />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Telefone"
                value={phone}
                onChangeText={(v) => setPhone(maskPhone(v))}
                testID="settings-phone"
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ width: 77 }}>
              <Input label="UF" value={uf} onChangeText={setUf} testID="settings-uf" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Cidade" value={city} onChangeText={setCity} testID="settings-city" />
            </View>
          </View>
          {/* Descending zIndex per combobox so each panel overlays the
              comboboxes below it when opened. Without this the absolutely-
              positioned dropdown panels paint behind subsequent sibling
              comboboxes (later DOM siblings win the default stacking order). */}
          <View style={{ position: 'relative', zIndex: 50 }}>
            <Combobox
              label="Profissão"
              placeholder="Selecione aqui"
              options={profissaoOptions}
              value={profissao}
              onChange={setProfissao}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 40 }}>
            <Combobox
              label="Setor"
              placeholder="Selecione aqui"
              options={setorOptions}
              value={setor}
              onChange={setSetor}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 30 }}>
            <Combobox
              label="Função"
              placeholder="Selecione aqui"
              options={funcaoOptions}
              value={funcao}
              onChange={setFuncao}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 20 }}>
            <Combobox
              label="Gerente responsável"
              placeholder="Selecione aqui"
              options={gerenteOptions}
              value={gerente}
              onChange={setGerente}
            />
          </View>
        </View>

        {/* RIGHT column — Saúde + Senha + Permissões.
            Desktop: flex:1 absorbs slack after LEFT 502.
            Wide: flexBasis 452 (≈ RIGHT width do frame 1366) + flexGrow:1 so it
            grows proportionally with LEFT instead of absorbing all extra. */}
        <View
          style={{
            ...(isTablet
              ? null
              : isWide
                ? ({ flexBasis: 452, flexGrow: 1, flexShrink: 0 } as const)
                : { flex: 1 }),
            gap: theme.gap.l,
          }}
        >
          {/* Health section — position:relative + zIndex 20 lifts the WHOLE
              section above the Senha+Permissões row that follows inside the
              RIGHT col, so the Tipo sanguíneo / Gênero dropdown panels open
              from within this section can overlay the Senha section. */}
          <View style={{ gap: theme.gap.m, position: 'relative', zIndex: 20 }}>
            {/* Row stacking context — lifts Tipo sanguíneo / Gênero dropdown
                panels above the alergias / doenças textareas inside this
                section. zIndex 30 within the Health section's local stacking
                context (which itself is at zIndex 20 above Senha section). */}
            <View
              style={{ flexDirection: 'row', gap: theme.gap.s, position: 'relative', zIndex: 30 }}
            >
              <View style={{ flex: 1 }}>
                <Combobox
                  label="Tipo sanguíneo"
                  placeholder="Selecione aqui"
                  options={BLOOD_OPTIONS}
                  value={bloodType}
                  onChange={setBloodType}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Combobox
                  label="Gênero"
                  placeholder="Selecione aqui"
                  options={GENDER_OPTIONS}
                  value={gender}
                  onChange={setGender}
                />
              </View>
            </View>
            <Input
              label="Possui alergias?"
              value={allergies}
              onChangeText={setAllergies}
              placeholder="(descreva aqui)"
              multiline
              numberOfLines={4}
            />
            <Input
              label="Possui doenças crônicas?"
              value={chronic}
              onChangeText={setChronic}
              placeholder="(descreva aqui)"
              multiline
              numberOfLines={4}
            />
          </View>

          <ExamsSection
            examName={examName}
            onExamNameChange={setExamName}
            examDate={examDate}
            onExamDateChange={setExamDate}
            examError={examError}
            examsBusy={examsBusy}
            onPickFile={pickExamFile}
            exams={exams}
          />

          {/* Password + Permissions row — stacks vertically at tablet so the
              Permissions toggles drop below the Password column instead of
              fighting for narrow horizontal space. */}
          <View
            style={{
              flexDirection: isTablet ? 'column' : 'row',
              gap: theme.gap.xxl,
              alignItems: isTablet ? 'stretch' : 'flex-start',
            }}
          >
            <PasswordSection
              currentPw={currentPw}
              onCurrentPwChange={setCurrentPw}
              newPw={newPw}
              onNewPwChange={setNewPw}
              confirmPw={confirmPw}
              onConfirmPwChange={setConfirmPw}
              pwError={pwError}
              changingPw={changingPw}
              onChangePassword={changePassword}
            />
            <PermissionsSection />
          </View>
        </View>
      </View>

      {/* Bottom actions */}
      <FormError message={saveError} />
      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Sair" variant="outline" onPress={() => signOut()} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={saving ? 'Salvando…' : 'Salvar Alterações'}
            variant="contained"
            fullWidth
            disabled={saving}
            onPress={save}
          />
        </View>
      </View>

      {showSupportModal ? <SupportModal onClose={() => setShowSupportModal(false)} /> : null}
      {showPrivacyModal ? <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} /> : null}
    </View>
  )
}
