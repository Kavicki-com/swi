// src/pages/user/UserSettings.tsx
// User settings screen — Figma 101:8704 ("user-settings"). Two-column form:
// LEFT  → Dados da cadastro (name, dob, cpf, email, phone, UF, city,
//         profissão, setor, função, gerente responsável)
// RIGHT → Tipo sanguíneo + Gênero comboboxes, alergias + doenças crônicas
//         textareas, Senha de acesso (current/new/confirm + alterar senha),
//         Permissões toggles (notificações, localização, arquivos, ligações).
// Footer → Sair + Salvar Alterações buttons.
import { useState } from 'react'
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
  Toggle,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useDemoToast } from '@/lib/demoToast'
import { SupportModal } from '@/components/SupportModal'

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

const GENDER_OPTIONS = [
  { label: 'Masculino', value: 'male' },
  { label: 'Feminino', value: 'female' },
  { label: 'Outro', value: 'other' },
]

const PROFISSAO_OPTIONS = [
  { label: 'Operador de escavadeira', value: 'op-escavadeira' },
  { label: 'Operador de caminhão', value: 'op-caminhao' },
  { label: 'Técnico de segurança', value: 'tec-seguranca' },
  { label: 'Engenheiro de mineração', value: 'eng-mineracao' },
]

const SETOR_OPTIONS = [
  { label: 'Mineração K22', value: 'k22' },
  { label: 'Setor Leste', value: 'leste' },
  { label: 'Setor Norte', value: 'norte' },
]

const FUNCAO_OPTIONS = [
  { label: 'Operação', value: 'operacao' },
  { label: 'Manutenção', value: 'manutencao' },
  { label: 'Supervisão', value: 'supervisao' },
]

const GERENTE_OPTIONS = [
  { label: 'João Soares Ribeiro', value: 'joao' },
  { label: 'Mathias Campos', value: 'mathias' },
]

const PRIVACY_POLICY_TEXT = `Este contrato detalha os termos e condições que regem o uso do software de gestão de recursos humanos para o setor de mineração, integrando funcionalidades de smartband, desenvolvido pela renomada Mineração Excelsior. Ao acessar e utilizar este software, o usuário manifesta sua concordância integral e irrestrita com todos os termos e condições estipulados neste documento. Este acordo estabelece as bases para a utilização do software, delineando os direitos e responsabilidades tanto do usuário quanto da Mineração Excelsior. É imprescindível que o usuário leia atentamente e compreenda integralmente cada cláusula antes de prosseguir com a utilização do software. A Mineração Excelsior reserva-se o direito de modificar, complementar ou atualizar estes termos a qualquer momento, mediante notificação prévia aos usuários. O uso contínuo do software após a publicação de quaisquer alterações constituirá aceitação tácita das mesmas. O software de gestão de recursos humanos da Mineração Excelsior, em conjunto com a tecnologia smartband, oferece uma solução abrangente para o monitoramento e gestão eficiente dos funcionários no ambiente de mineração. As funcionalidades incluem, mas não se limitam a, rastreamento em tempo real da localização dos funcionários, monitoramento de sinais vitais, comunicação bidirecional, alertas de segurança e gestão de jornadas de trabalho. A Mineração Excelsior emprega medidas de segurança rigorosas para proteger os dados dos usuários e garantir a confidencialidade das informações. No entanto, o usuário reconhece que nenhum sistema de segurança é infalível e que a Mineração Excelsior não pode garantir a segurança absoluta dos dados. O usuário é responsável por manter a confidencialidade de suas credenciais de acesso e por notificar imediatamente a Mineração Excelsior em caso de qualquer uso não autorizado de sua conta. O software é fornecido 'no estado em que se encontra' e a Mineração Excelsior não oferece garantias de qualquer tipo, expressas ou implícitas, incluindo, mas não se limitando a, garantias de comercialização, adequação a um propósito específico e não violação. Em nenhuma circunstância a Mineração Excelsior será responsável por quaisquer danos diretos, indiretos, incidentais, especiais ou consequenciais decorrentes do uso ou da impossibilidade de uso do software, mesmo que tenha sido avisada da possibilidade de tais danos. Este contrato será regido e interpretado de acordo com as leis do Brasil, e qualquer disputa decorrente deste contrato será resolvida nos tribunais competentes da cidade de Belo Horizonte, Minas Gerais. Ao utilizar o software, o usuário concorda em cumprir todas as leis e regulamentos aplicáveis, incluindo, mas não se limitando a, leis de proteção de dados e privacidade. A Mineração Excelsior reserva-se o direito de suspender ou encerrar o acesso do usuário ao software em caso de violação destes termos e condições. Este contrato constitui o acordo integral entre o usuário e a Mineração Excelsior em relação ao uso do software e substitui todos os acordos anteriores ou contemporâneos, escritos ou orais. Caso alguma disposição deste contrato seja considerada inválida ou inexequível, as demais disposições permanecerão em pleno vigor e efeito. O usuário declara ter lido, compreendido e concordado com todos os termos e condições deste contrato antes de utilizar o software da Mineração Excelsior.`

// Privacy policy modal — Figma 105:11650. Title in primary green + close X,
// long scrollable body text, footer title "Acordo de termos de uso e
// privacidade". Trigger: "Política de privacidade e termos de uso" link.
function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar modal"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          width: 596,
          maxHeight: 600,
          backgroundColor: theme.background,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.m,
          gap: theme.gap.m,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
          <View style={{ flex: 1 }}>
            <Title variant="title.xs" color={theme.content.primary}>
              Política de privacidade
            </Title>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{ padding: 4 }}
          >
            <Icon name="close" size={20} color={theme.content.dark} />
          </Pressable>
        </View>
        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
          }}
        >
          <Text variant="body.m" color={theme.content.dark}>
            {PRIVACY_POLICY_TEXT}
          </Text>
        </div>
        <Title variant="title.xs" color={theme.content.dark}>
          Acordo de termos de uso e privacidade
        </Title>
      </View>
    </View>
  )
}

// Password field with absolutely-positioned visibility toggle.
// Workaround for a DS Input bug where iconRight overflows the text-area
// horizontally when the input is narrow. We render the DS Input on its own
// (no iconRight) and overlay a Pressable with the eye icon, anchored to the
// right edge of the input box. Stays inside the column at any width.
function PasswordInput({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisible,
}: {
  label: string
  value: string
  onChangeText: (next: string) => void
  visible: boolean
  onToggleVisible: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ position: 'relative' }}>
      <Input label={label} value={value} onChangeText={onChangeText} secureTextEntry={!visible} />
      {/* Anchored to the right edge of the visible text-area. Wrapper's
          bottom matches the text-area bottom (DS Input renders label above
          + text-area below, no description). The text-area is 41px tall and
          the eye is 24px tall, so to vertically center the eye inside the
          text-area we offset (41-24)/2 ≈ 8px from the wrapper bottom. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
        onPress={onToggleVisible}
        style={{
          position: 'absolute',
          right: theme.padding.sm,
          bottom: theme.padding.s,
          width: 24,
          height: 24,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={visible ? 'visibility_off' : 'visibility'}
          size={20}
          color={theme.content.dark}
        />
      </Pressable>
    </View>
  )
}

export function UserSettings() {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const isWide = breakpoint === 'wide'
  const { user, signOut } = useAuth()
  const { show: showToast } = useDemoToast()

  const [name, setName] = useState(user?.full_name ?? 'Carlos Sampaio')
  const [dob, setDob] = useState('00/00/0000')
  const [cpf, setCpf] = useState('000.000.000-00')
  const [email, setEmail] = useState(user?.email ?? 'seu@email.com')
  const [phone, setPhone] = useState('(00) 00000 0000')
  const [uf, setUf] = useState('MG')
  const [city, setCity] = useState('Quitandinha')
  const [profissao, setProfissao] = useState<string>('')
  const [setor, setSetor] = useState<string>('')
  const [funcao, setFuncao] = useState<string>('')
  const [gerente, setGerente] = useState<string>('')
  const [bloodType, setBloodType] = useState<string>('')
  const [gender, setGender] = useState<string>('')
  const [allergies, setAllergies] = useState('')
  const [chronic, setChronic] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [permNotifications, setPermNotifications] = useState(true)
  const [permLocation, setPermLocation] = useState(false)
  const [permFiles, setPermFiles] = useState(true)
  const [permCalls, setPermCalls] = useState(true)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)

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
        <View style={{ position: 'relative' }}>
          <Avatar uri={user?.avatarUri} size="l" bordered />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Editar foto"
            onPress={() => showToast('Editar foto', 'Seletor de imagem em breve')}
            style={{
              position: 'absolute',
              right: -4,
              top: -4,
              backgroundColor: theme.content.dark,
              borderRadius: 999,
              padding: theme.padding.xs,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="edit" size={16} color={theme.content.light} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar exames clínicos"
            onPress={() => showToast('Exames enviados', 'Upload simulado concluído')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: theme.padding.sm,
              paddingVertical: theme.padding.s,
            }}
          >
            <Icon name="cloud_upload" size={20} color={theme.content.primary} />
            <Text
              variant="body.m"
              color={theme.content.primary}
              style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
            >
              Enviar exames clínicos
            </Text>
          </Pressable>
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
          - Desktop (1024-1499): LEFT 502 + RIGHT flex:1 — Figma exact.
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
        {/* LEFT column — Dados da cadastro */}
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
            Dados da cadastro
          </Title>
          <Input label="Nome Completo" value={name} onChangeText={setName} />
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ width: 192 }}>
              <Input label="Data de Nascimento" value={dob} onChangeText={setDob} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="CPF" value={cpf} onChangeText={setCpf} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ flex: 1 }}>
              <Input label="Email" value={email} onChangeText={setEmail} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Telefone" value={phone} onChangeText={setPhone} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
            <View style={{ width: 77 }}>
              <Input label="UF" value={uf} onChangeText={setUf} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Cidade" value={city} onChangeText={setCity} />
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
              options={PROFISSAO_OPTIONS}
              value={profissao}
              onChange={setProfissao}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 40 }}>
            <Combobox
              label="Setor"
              placeholder="Selecione aqui"
              options={SETOR_OPTIONS}
              value={setor}
              onChange={setSetor}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 30 }}>
            <Combobox
              label="Função"
              placeholder="Selecione aqui"
              options={FUNCAO_OPTIONS}
              value={funcao}
              onChange={setFuncao}
            />
          </View>
          <View style={{ position: 'relative', zIndex: 20 }}>
            <Combobox
              label="Gerente responsável"
              placeholder="Selecione aqui"
              options={GERENTE_OPTIONS}
              value={gerente}
              onChange={setGerente}
            />
          </View>
        </View>

        {/* RIGHT column — Saúde + Senha + Permissões.
            Desktop: flex:1 absorbs slack after LEFT 502.
            Wide: flexBasis 452 (≈ Figma 1366 RIGHT width) + flexGrow:1 so it
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
            {/* Password column.
                NOTE: DS Input's iconRight overflows the text-area horizontally
                when the input is narrow (≤245px) — flex:1 on the inner
                TextInput pushes the iconRight out by ~32px.  Workaround:
                pass `secureTextEntry` to the Input *without* iconRight, then
                overlay the visibility Pressable absolutely so it stays inside
                the input box no matter how narrow the column is. Bump DS
                later to clip iconRight properly. */}
            <View style={{ flex: 1, gap: theme.gap.s }}>
              <Title variant="title.xs" color={theme.content.primary}>
                Senha de acesso
              </Title>
              <PasswordInput
                label="Senha atual"
                value={currentPw}
                onChangeText={setCurrentPw}
                visible={showCurrent}
                onToggleVisible={() => setShowCurrent((v) => !v)}
              />
              <PasswordInput
                label="Nova senha"
                value={newPw}
                onChangeText={setNewPw}
                visible={showNew}
                onToggleVisible={() => setShowNew((v) => !v)}
              />
              <PasswordInput
                label="Repetir nova senha"
                value={confirmPw}
                onChangeText={setConfirmPw}
                visible={showConfirm}
                onToggleVisible={() => setShowConfirm((v) => !v)}
              />
              <Button
                label="Alterar senha"
                variant="contained"
                backgroundColor={theme.surface.secondary}
                size="small"
                onPress={() => showToast('Senha alterada', 'Atualização simulada com sucesso')}
              />
            </View>

            {/* Permissions column */}
            <View style={{ width: 224, gap: theme.gap.m }}>
              <Title variant="title.xs" color={theme.content.primary}>
                Permissões
              </Title>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Toggle value={permNotifications} onChange={setPermNotifications} />
                <Text variant="body.m" color={theme.content.dark}>
                  Notificações
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Toggle value={permLocation} onChange={setPermLocation} />
                <Text variant="body.m" color={theme.content.dark}>
                  Localização
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Toggle value={permFiles} onChange={setPermFiles} />
                <Text variant="body.m" color={theme.content.dark}>
                  Acessar pastas e arquivos
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Toggle value={permCalls} onChange={setPermCalls} />
                <Text variant="body.m" color={theme.content.dark}>
                  Ligações telefônicas
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Bottom actions */}
      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Sair" variant="outline" onPress={() => signOut()} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Salvar Alterações"
            variant="contained"
            fullWidth
            onPress={() => showToast('Alterações salvas', 'Cadastro atualizado com sucesso')}
          />
        </View>
      </View>

      {showSupportModal ? <SupportModal onClose={() => setShowSupportModal(false)} /> : null}
      {showPrivacyModal ? <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} /> : null}
    </View>
  )
}
