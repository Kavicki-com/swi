// src/pages/admins/AdminsCreate.tsx
// Admin registration form. Three sections (Dados do cadastro,
// Dados de saúde, Exames clínicos) followed by Voltar / Finalizar Cadastro
// footer. Rendered by AdminsList when tab='cadastrar'.
import { View } from 'react-native'
import {
  Button,
  Combobox,
  ImageViewer,
  Input,
  Modal,
  Radio,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { downloadFile } from '@/lib/attachments'
import { adminsApi, employeesApi, type CreateUserInput } from '@/services/api/users'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDemoToast } from '@/lib/demoToast'
import { maskCpf, maskDate, maskPhone, onlyDigits } from '@/lib/masks'
import { newPasswordProblem } from '@/lib/validators'
import { ExamsSection } from '@/pages/user/components/ExamsSection'
import { useExamAttachments } from './hooks/useExamAttachments'
import { LevelField } from './components/LevelField'
import {
  avisoDeCadastro,
  dadosDeSaude,
  EMAIL_RE,
  formDoUsuario,
  type FormState,
  GENERO_OPTIONS,
  parseBR,
  patchDoFormulario,
  TIPO_SANGUINEO_OPTIONS,
  usernameNormalizado,
} from './components/adminForm'

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
  // Exame aberto no visualizador (imagem) e exame gravado aguardando a
  // confirmação de exclusão (irreversível).
  const [viewing, setViewing] = useState<{ uri: string; title: string } | null>(null)
  const [confirmandoExame, setConfirmandoExame] = useState<{ id: string; name: string } | null>(
    null,
  )

  // Imagem abre no visualizador; PDF (laudo típico) abre numa aba nova.
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i
  const abrirAnexo = (uri: string, title: string, isImage: boolean) => {
    if (isImage) setViewing({ uri, title })
    else window.open(uri, '_blank', 'noopener,noreferrer')
  }
  // Exame da fila: o arquivo local vira uma object URL só pra abrir.
  const verPendente = (index: number) => {
    const file = exames.pendentes[index]?.file
    if (!file) return
    abrirAnexo(URL.createObjectURL(file), file.name, file.type.startsWith('image/'))
  }
  const verGravado = (exam: { fileUrl: string; name: string }) =>
    abrirAnexo(exam.fileUrl, exam.name, IMAGE_EXT.test(exam.fileUrl))
  // Nível com que o cadastro abriu na edição: o patch só leva o nível se mudou.
  const [nivelGravado, setNivelGravado] = useState('')
  const [form, setForm] = useState<FormState>({
    nomeCompleto: '',
    email: '',
    telefone: '',
    dataNascimento: '',
    cpf: '',
    nomeUsuario: '',
    senha: '',
    nivel: subject === 'administrador' ? 'ADMIN' : '',
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
        setNivelGravado(data.role)
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
    const senhaProblem = isEdit ? null : newPasswordProblem(form.senha)
    if (senhaProblem) {
      setError(senhaProblem)
      return
    }
    // Responder "Sim" sem descrever é uma declaração que não cabe no campo: o
    // dadosDeSaude se recusa (com razão) a inventar texto, então o cadastro
    // subiria SEM a alergia e o prontuário diria que a pessoa não tem nenhuma.
    // Este formulário existe para não perder dado declarado, então ele para
    // aqui e diz o que falta.
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
        const { error: apiError } = await api.update(
          editandoId,
          patchDoFormulario(form, nivelGravado),
        )
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
      ...(form.nivel ? { role: form.nivel } : {}),
    }
    try {
      const { data, error: apiError } = await api.create(payload)
      if (apiError) {
        setError(apiError.message)
        showToast('Erro', apiError.message)
        return
      }
      showToast('Cadastro concluído', avisoDeCadastro(nome, data?.credentialsEmailSent))
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
              // Barra o autofill do login salvo do admin (campo + senha = login).
              autoComplete="off"
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
                passwordToggle
                // "off" nos dois campos quebra o par usuário+senha do login.
                autoComplete="off"
              />
            </View>
          ) : null}
        </View>
        {form.nivel ? <LevelField value={form.nivel} onChange={(v) => update('nivel', v)} /> : null}
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
        onPendingView={verPendente}
        onPendingRemove={exames.removerPendente}
        onExamView={verGravado}
        onExamDownload={(exam) => void downloadFile(exam.fileUrl, exam.name)}
        onExamRemove={(exam) => setConfirmandoExame({ id: exam.id, name: exam.name })}
        examsRemoving={exames.removendoIds}
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
            accessibilityLabel={
              isEdit ? `Salvar alterações do ${subject}` : `Finalizar cadastro do ${subject}`
            }
          />
        </View>
      </View>

      {/* Visualizador do exame (imagem) em tamanho grande, com Baixar. */}
      <ImageViewer
        visible={viewing !== null}
        uri={viewing?.uri ?? null}
        title={viewing?.title ?? ''}
        onClose={() => setViewing(null)}
        onDownload={() => {
          if (viewing) void downloadFile(viewing.uri, viewing.title)
        }}
        testID="admins-create-exam-viewer"
      />

      {/* Exclusão de exame gravado é irreversível: confirma no Modal EXCLUIR. */}
      <Modal
        visible={confirmandoExame !== null}
        title="EXCLUIR"
        description={
          confirmandoExame
            ? `O exame "${confirmandoExame.name}" será excluído de forma permanente. Deseja continuar?`
            : ''
        }
        onConfirm={() => {
          const alvo = confirmandoExame
          setConfirmandoExame(null)
          if (alvo) void exames.removerGravado(alvo.id)
        }}
        onCancel={() => setConfirmandoExame(null)}
      />
    </View>
  )
}
