// src/pages/admins/AdminsCreate.tsx
// Admin registration form. Three sections (Dados do cadastro,
// Dados de saúde, Exames clínicos) followed by Voltar / Finalizar Cadastro
// footer. Rendered by AdminsList when tab='cadastrar'.
import { View } from 'react-native'
import {
  Button,
  Combobox,
  Icon,
  Input,
  Radio,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import {
  adminsApi,
  employeesApi,
  type CreateUserInput,
  type EditableUser,
  type UpdateUserInput,
} from '@/services/api/users'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDemoToast } from '@/lib/demoToast'
import { maskCpf, maskDate, maskPhone, onlyDigits } from '@/lib/masks'
import { ExamsSection } from '@/pages/user/components/ExamsSection'
import { useExamAttachments } from './hooks/useExamAttachments'

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

// A tela oferece 5 respostas de gênero, mas o dado GRAVADO tem 3 códigos. A
// convenção está declarada no mobile (settings/health-data.tsx) e é comparada
// pelo painel inteiro (detalhe do funcionário, painel do chat). Sem traduzir,
// gravar 'masculino' faria toda tela de leitura exibir 'não informado'.
//
// 'prefiro-nao-informar' de propósito NÃO tem código: o campo sai do corpo, e
// ausência é o que a tela lê como 'não informado', que é literalmente o que a
// pessoa escolheu. Mapear pra 'other' afirmaria que ela declarou algo.
const CODIGO_DE_GENERO: Record<string, string | undefined> = {
  masculino: 'male',
  feminino: 'female',
  'nao-binario': 'other',
  outro: 'other',
}

type CamposDeSaude = Pick<
  FormState,
  | 'tipoSanguineo'
  | 'genero'
  | 'alergico'
  | 'alergicoDesc'
  | 'doencasCronicas'
  | 'doencasCronicasDesc'
>

// Texto livre só vira campo quando há o que registrar. Responder 'Não' não
// pode gravar a string 'Não': a tela de detalhe quebra esse campo por vírgula
// em chips (parseAllergies), e sairia uma chip escrita Não.
const textoLivre = (resposta: string, descricao: string): string | undefined =>
  resposta === 'sim' && descricao.trim() ? descricao.trim() : undefined

/**
 * Saúde DECLARATÓRIA do cadastro (digitada, não medida: a telemetria da
 * smartband não passa por aqui). Estes campos ficavam renderizados e o submit
 * os descartava, então quem preenchia via o formulário aceitar e o dado sumir
 * sem aviso. Traduz o vocabulário da TELA para o vocabulário GRAVADO.
 */
export function dadosDeSaude(form: CamposDeSaude): {
  gender?: string
  bloodType?: string
  allergies?: string
  chronicConditions?: string
} {
  const gender = CODIGO_DE_GENERO[form.genero]
  // O Combobox guarda 'a+' e o conjunto gravado é 'A+' (o mesmo do mobile,
  // onde value é igual ao label). Sem normalizar, a lista de funcionários
  // mostraria 'a+' ao lado de 'O+' conforme a origem de cada cadastro.
  const bloodType = form.tipoSanguineo.trim().toUpperCase() || undefined
  const allergies = textoLivre(form.alergico, form.alergicoDesc)
  const chronicConditions = textoLivre(form.doencasCronicas, form.doencasCronicasDesc)
  return {
    ...(gender ? { gender } : {}),
    ...(bloodType ? { bloodType } : {}),
    ...(allergies ? { allergies } : {}),
    ...(chronicConditions ? { chronicConditions } : {}),
  }
}

// Tradução INVERSA do gênero: o vocabulário gravado de volta pro da tela. O
// cadastro só precisava do sentido de ida; a edição precisa dos dois, porque
// abrir o formulário com o gênero em branco e salvar apagaria a declaração de
// quem só queria corrigir o telefone.
//
// Só os três códigos gravados voltam. 'nao-binario' NÃO tem volta: ele foi
// gravado como 'other' e reabre como 'Outro'. É a perda que o cadastro já
// aceitou de propósito, e inventar a volta aqui seria adivinhar qual das duas
// respostas a pessoa deu.
const GENERO_DA_TELA: Record<string, string | undefined> = {
  male: 'masculino',
  female: 'feminino',
  other: 'outro',
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA'. Fatia texto em vez de passar por Date, pela
// mesma razão do caminho de ida: meia-noite UTC recua um dia no fuso do
// cliente, e o nascimento andaria pra trás a cada abertura do formulário.
const dataBR = (iso: string): string => {
  const [aaaa, mm, dd] = iso.split('-')
  return aaaa && mm && dd ? `${dd}/${mm}/${aaaa}` : ''
}

/**
 * Cadastro gravado → estado do formulário. Espelho do dadosDeSaude, no sentido
 * contrário.
 *
 * Texto vazio reabre SEM resposta, e não como "Não": o banco guarda apenas o
 * texto livre, então quem nunca respondeu e quem respondeu "Não" chegam aqui
 * idênticos. Marcar "Não" afirmaria uma declaração que ninguém fez, e é a mesma
 * régua que faz a ausência de gênero virar "não informado" nas telas de leitura.
 */
export function formDoUsuario(u: EditableUser): FormState {
  const temAlergia = u.allergies.trim().length > 0
  const temCronica = u.chronicConditions.trim().length > 0
  return {
    nomeCompleto: u.name,
    email: u.email,
    telefone: maskPhone(u.phone),
    dataNascimento: dataBR(u.birthDate),
    cpf: maskCpf(u.cpf),
    nomeUsuario: u.username,
    // O PATCH não aceita senha e a tela de edição não a renderiza. Vazio aqui
    // é o estado honesto: não há senha pra reexibir, e não haveria pra onde
    // mandá-la.
    senha: '',
    tipoSanguineo: u.bloodType.toLowerCase(),
    genero: GENERO_DA_TELA[u.gender] ?? '',
    alergico: temAlergia ? 'sim' : '',
    alergicoDesc: u.allergies,
    doencasCronicas: temCronica ? 'sim' : '',
    doencasCronicasDesc: u.chronicConditions,
  }
}

/**
 * Estado do formulário → corpo do PATCH. Difere do dadosDeSaude num ponto que
 * importa: campo esvaziado sobe VAZIO em vez de ser omitido. No cadastro
 * omitir significa "não tinha"; num patch significa "não mexe", e aí limpar um
 * telefone deliberadamente deixaria o antigo no lugar.
 *
 * O nascimento é a única exceção, porque não é texto livre: o IsCalendarDate do
 * backend recusa string vazia, então mandá-la trocaria um campo em branco por
 * um 400 na cara de quem salvou. Em branco ele é omitido, o que significa que
 * esta tela consegue CORRIGIR um nascimento mas não apagá-lo.
 */
export function patchDoFormulario(form: FormState): UpdateUserInput {
  const birthDate = parseBR(form.dataNascimento)
  return {
    name: form.nomeCompleto.trim(),
    phone: onlyDigits(form.telefone),
    cpf: onlyDigits(form.cpf),
    ...(birthDate ? { birthDate } : {}),
    // Vazio é omitido, como o nascimento: o backend recusa null e a string
    // vazia reprova no formato. Esta tela define e corrige um handle; apagar
    // fica pra quando existir UI disso.
    ...(usernameNormalizado(form.nomeUsuario)
      ? { username: usernameNormalizado(form.nomeUsuario) }
      : {}),
    gender: CODIGO_DE_GENERO[form.genero] ?? '',
    bloodType: form.tipoSanguineo.trim().toUpperCase(),
    allergies: textoLivre(form.alergico, form.alergicoDesc) ?? '',
    chronicConditions: textoLivre(form.doencasCronicas, form.doencasCronicasDesc) ?? '',
  }
}

// Handle no vocabulário do banco: minúsculo e sem espaço nas pontas. A régua
// completa (formato, unicidade) é do backend; normalizar aqui só evita que
// "Ze.Silva" digitado com shift vire um 400 pedagógico.
const usernameNormalizado = (raw: string): string => raw.trim().toLowerCase()

// 'DD/MM/AAAA' → ISO date-only ('AAAA-MM-DD'). Vazio/fora do formato → undefined
// (o campo é opcional; não sobe chave vazia). Retorna date-only, NÃO .toISOString():
// a meia-noite local vira UTC e a data recuaria um dia perto do fuso (off-by-one).
// O backend (@IsISO8601 + new Date(...)) aceita 'AAAA-MM-DD'. O round-trip por
// new Date rejeita datas impossíveis (31/02 rola pra 02/03 e não bate de volta).
function parseBR(value: string): string | undefined {
  const parts = value.trim().split('/')
  if (parts.length !== 3) return undefined
  const [dd, mm, aaaa] = parts
  if (!dd || !mm || !aaaa) return undefined
  if ([dd, mm, aaaa].some((p) => !/^\d+$/.test(p))) return undefined
  if (aaaa.length !== 4) return undefined
  const d = Number(dd)
  const m = Number(mm)
  const y = Number(aaaa)
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  // Round-trip: se o Date normalizou (ex.: 31/02 → 02/03), os componentes não
  // batem com o input e a data é impossível → undefined.
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return undefined
  }
  return `${aaaa}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// e-mail "de forma" (não RFC): barra o esquecimento óbvio antes de gastar uma
// ida ao backend só pra receber um 400.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
      {/* Matches the body/m bold spec used by the DS Input.Label
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
  // registration use the same template.
  subject?: 'administrador' | 'funcionário'
}) {
  const theme = useTheme()
  const { show: showToast } = useDemoToast()
  const navigate = useNavigate()
  // Mesma peça servindo criação e edição, como o NewReport já faz pros
  // relatórios: a rota /:id/edit monta este componente e o `id` do useParams é
  // o que separa os dois modos. Dentro da lista (tab de cadastro) não há `:id`
  // na rota, então o modo é criação sem precisar de prop.
  const { id: editandoId } = useParams()
  const isEdit = Boolean(editandoId)
  // Só na edição: enquanto o cadastro não chega, e quando ele não chega.
  const [carregando, setCarregando] = useState(isEdit)
  const [naoEncontrado, setNaoEncontrado] = useState(false)
  // Anexo de exame. Mora num hook porque são duas máquinas de estado (fila do
  // cadastro e envio imediato da edição) que não têm nada a ver com o resto do
  // formulário, e porque a tela já estava perto do teto de tamanho do gate.
  const exames = useExamAttachments({ isEdit, editandoId, subject, showToast })
  // Desestruturado porque o objeto do hook é novo a cada render e a carga
  // depende só deste setter, que o useState mantém estável.
  const { definirGravados } = exames
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  // Carga do cadastro na edição. `api` sai do subject, que é o mesmo que decide
  // pra onde o submit vai: as duas rotas de usuário são a mesma no backend.
  useEffect(() => {
    if (!editandoId) return
    let cancelado = false
    const api = subject === 'funcionário' ? employeesApi : adminsApi
    void api.getForEdit(editandoId).then(({ data }) => {
      if (cancelado) return
      // Sem cadastro não há formulário: um form em branco aqui salvaria por
      // cima do cadastro inteiro de quem só queria corrigir um campo.
      if (!data) setNaoEncontrado(true)
      else {
        setForm(formDoUsuario(data))
        definirGravados(data.exams)
      }
      setCarregando(false)
    })
    return () => {
      cancelado = true
    }
  }, [editandoId, subject, definirGravados])

  // Saída da tela. Dentro da lista quem sabe voltar é o host (troca de aba, sem
  // navegação); como rota de edição não há host, e o destino honesto é o
  // detalhe de quem acabou de ser editado.
  const voltar = () => {
    if (onBack) return onBack()
    const base = subject === 'funcionário' ? '/employees' : '/admins'
    navigate(editandoId ? `${base}/${editandoId}` : base)
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Sobem a identidade (name/email/senha, mais phone/cpf/nascimento opcionais)
  // e a saúde DECLARATÓRIA traduzida pelo dadosDeSaude. Fora do corpo sobra só
  // o nome de usuário, que não tem campo correspondente no backend.
  async function handleSubmit() {
    if (submitting) return
    const nome = form.nomeCompleto.trim()
    const email = form.email.trim()
    // Na edição a senha não é pedida (o PATCH não a aceita) e o e-mail não é
    // editável, então cobrá-los aqui recusaria um salvamento legítimo.
    if (!nome || (!isEdit && (!email || !form.senha))) {
      setError(isEdit ? 'Preencha o nome.' : 'Preencha nome, e-mail e senha.')
      return
    }
    if (!isEdit && !EMAIL_RE.test(email)) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!isEdit && form.senha.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.')
      return
    }
    // Responder "Sim" sem descrever é uma declaração que não cabe no campo: o
    // dadosDeSaude se recusa (com razão) a inventar texto, então o cadastro
    // subiria SEM a alergia e o prontuário diria que a pessoa não tem nenhuma.
    // Perder assim o dado é justamente o defeito que este formulário passou a
    // existir pra não ter, então ele para aqui e diz o que falta.
    if (form.alergico === 'sim' && !form.alergicoDesc.trim()) {
      setError('Descreva a alergia ou responda "Não".')
      return
    }
    if (form.doencasCronicas === 'sim' && !form.doencasCronicasDesc.trim()) {
      setError('Descreva a doença crônica ou responda "Não".')
      return
    }
    setError(null)
    setSubmitting(true)
    const api = subject === 'funcionário' ? employeesApi : adminsApi
    if (isEdit && editandoId) {
      try {
        const { error: apiError } = await api.update(editandoId, patchDoFormulario(form))
        if (apiError) {
          setError(apiError.message)
          showToast('Erro', apiError.message)
          return
        }
        showToast('Cadastro atualizado', `${nome} foi salvo`)
        voltar()
      } finally {
        setSubmitting(false)
      }
      return
    }
    const birthDate = parseBR(form.dataNascimento)
    const payload: CreateUserInput = {
      name: nome,
      email,
      password: form.senha,
      // Persiste só dígitos: a máscara é apresentação, e cadastros com
      // pontuação diferente virariam o mesmo CPF em formatos distintos no banco.
      ...(onlyDigits(form.telefone) ? { phone: onlyDigits(form.telefone) } : {}),
      ...(onlyDigits(form.cpf) ? { cpf: onlyDigits(form.cpf) } : {}),
      ...(birthDate ? { birthDate } : {}),
      ...(usernameNormalizado(form.nomeUsuario)
        ? { username: usernameNormalizado(form.nomeUsuario) }
        : {}),
      ...dadosDeSaude(form),
    }
    try {
      const { data, error: apiError } = await api.create(payload)
      if (apiError) {
        setError(apiError.message)
        showToast('Erro', apiError.message)
        return
      }
      showToast('Cadastro concluído', `${nome} foi cadastrado com sucesso`)
      // Só agora existe id pra anexar. Antes disto não havia a quem.
      if (data?.id) await exames.enviarPendentes(data.id)
      voltar()
    } finally {
      setSubmitting(false)
    }
  }

  // Estados exclusivos da edição. O formulário só é montado quando há cadastro
  // pra editar: em branco ele salvaria por cima do que não conseguiu ler.
  if (naoEncontrado) {
    return (
      <View testID="admins-create-nao-encontrado" style={{ gap: theme.gap.m }}>
        <Text variant="body.m" color={theme.content.dark}>
          Não foi possível carregar este cadastro.
        </Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label="Voltar"
            variant="outline"
            onPress={voltar}
            accessibilityLabel={`Voltar para a lista de ${subject === 'funcionário' ? 'funcionários' : 'administradores'}`}
          />
        </View>
      </View>
    )
  }
  if (carregando) {
    return (
      <View testID="admins-create-carregando" style={{ padding: theme.padding.m }}>
        <Text variant="body.m" color={theme.content.dark}>
          Carregando…
        </Text>
      </View>
    )
  }

  return (
    <View testID="admins-create" style={{ gap: theme.gap.l }}>
      <Section title="Dados de cadastro">
        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          <View style={{ flex: 1 }}>
            <Input
              testID="admins-create-nome"
              label="Nome Completo"
              placeholder={`Nome completo do novo ${subject}`}
              value={form.nomeCompleto}
              onChangeText={(v) => update('nomeCompleto', v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            {/* Na edição o e-mail é exibido mas não é editável: o
                UpdateUserDto o deixa de fora de propósito (é a identidade de
                login, e trocá-la exige reconfirmação). Aceitar a digitação e
                descartá-la no patch faria a tela dizer "atualizado" sobre algo
                que não mudou. */}
            <Input
              testID="admins-create-email"
              label="Email"
              placeholder="seu@email.com"
              value={form.email}
              onChangeText={(v) => update('email', v)}
              disabled={isEdit}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              testID="admins-create-telefone"
              label="Telefone"
              placeholder="(00) 00000-0000"
              value={form.telefone}
              onChangeText={(v) => update('telefone', maskPhone(v))}
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
              onChangeText={(v) => update('dataNascimento', maskDate(v))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="CPF"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChangeText={(v) => update('cpf', maskCpf(v))}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              testID="admins-create-usuario"
              label="Nome do usuário"
              placeholder="usuario"
              value={form.nomeUsuario}
              onChangeText={(v) => update('nomeUsuario', v)}
              autoCapitalize="none"
            />
          </View>
          {/* Senha só existe no cadastro. O PATCH /users/:id não aceita
              password, então renderizar o campo na edição seria oferecer uma
              troca de senha que a whitelist do backend descartaria calada. */}
          {!isEdit ? (
            <View style={{ flex: 1 }}>
              <Input
                testID="admins-create-senha"
                label="Senha"
                placeholder="digite aqui"
                value={form.senha}
                onChangeText={(v) => update('senha', v)}
                secureTextEntry
                iconRight={<Icon name="visibility" size={20} color={theme.content.dark} />}
              />
            </View>
          ) : null}
        </View>
      </Section>

      {/* Wrapper lifts the entire "Dados de saúde" Section above subsequent
          sibling sections ("Exames clínicos" + footer) so Combobox dropdown
          panels (Tipo sanguíneo / Gênero) opened from inside this section can
          overlay them. The inner combobox row's own zIndex positions it
          relative to the YesNo questions WITHIN this section. */}
      <View style={{ position: 'relative', zIndex: 10 }}>
        <Section title="Dados de saúde">
          {/* position:relative + zIndex lifts the Combobox row above the YesNo
            questions inside this Section. */}
          <View
            style={{ flexDirection: 'row', gap: theme.gap.s, position: 'relative', zIndex: 10 }}
          >
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
            to each is disabled until the user picks "Sim"; the spec shows
            the "Quais?" field in the DS
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
      </View>

      {/* A mesma seção do settings, que é a única UX de exame que o painel tem:
          nome, validade e o card do laudo. O uploader decorativo que vivia aqui
          aceitava o arquivo e não o mandava a lugar nenhum, porque não existia
          rota pra anexar exame de OUTRA pessoa. */}
      <ExamsSection
        testIDPrefix="admins-create"
        examName={exames.examName}
        onExamNameChange={exames.setExamName}
        examDate={exames.examDate}
        onExamDateChange={exames.setExamDate}
        examError={exames.examError}
        // `submitting` também trava o botão: um exame enfileirado ENQUANTO o
        // create está em voo ficaria fora da descarga (ela fotografa a fila no
        // início do submit) e morreria calado quando a tela navegasse.
        examsBusy={exames.examsBusy || submitting}
        onPickFile={exames.pedirArquivo}
        exams={exames.gravados}
        pending={exames.pendentes}
      />
      {/* O DS não tem (nem deve ter) seletor de arquivo: o host abre o diálogo
          nativo. Mesmo padrão do NewReport e do settings. */}
      <input
        ref={exames.inputRef}
        data-testid="admins-create-exam-input"
        type="file"
        accept="image/jpeg,image/png,application/pdf,text/plain"
        style={{ display: 'none' }}
        onChange={exames.onArquivoEscolhido}
      />

      {/* Erro de validação/backend em vermelho acima do rodapé (role=alert via
          accessibilityRole). Só aparece quando setError foi disparado. */}
      {error ? (
        <Text variant="body.m" color={theme.content.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {/* Footer: two buttons sharing the section width 50/50 (full-width
          split) per the spec. Voltar uses outline; Finalizar Cadastro
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
            disabled={submitting}
            onPress={voltar}
            accessibilityLabel={`Voltar para a lista de ${subject === 'funcionário' ? 'funcionários' : 'administradores'}`}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={isEdit ? 'Salvar alterações' : 'Finalizar Cadastro'}
            variant="contained"
            size="large"
            fullWidth
            disabled={submitting}
            backgroundColor={theme.surface.primary}
            onPress={handleSubmit}
            accessibilityLabel={isEdit ? `Salvar alterações do ${subject}` : `Finalizar cadastro do ${subject}`}
          />
        </View>
      </View>
    </View>
  )
}
