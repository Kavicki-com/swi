// src/pages/user/hooks/useUserSettings.ts
// Estado, efeitos e handlers da tela de configurações do usuário: prefill do
// perfil, catálogo da org, exames, troca de senha e upload de foto. Extraído
// de UserSettings.tsx, que passou a ser layout.
//
// Fica de fora de propósito o estado puramente local de dois blocos: as três
// visibilidades de senha e as quatro permissões nunca são lidas fora dos
// próprios controles, então moram em PasswordSection e PermissionsSection.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useDemoToast } from '@/lib/demoToast'
import { profileApi, type ProfileCatalog, type ProfilePatch } from '@/services/api/profile'
import { authApi } from '@/services/api/auth'
import { uploadImage } from '@/services/api/upload'
import { examsApi, type Exam } from '@/services/api/exams'
import { toCalendarDate } from '@/services/api/examCard'
import { maskCpf, maskPhone, onlyDigits } from '@/lib/masks'

// Exportado: a página monta o Combobox de Gênero com a MESMA lista que o
// readGender abaixo usa para traduzir o que veio do backend. Duas cópias
// divergiriam em silêncio.
export const GENDER_OPTIONS = [
  { label: 'Masculino', value: 'male' },
  { label: 'Feminino', value: 'female' },
  { label: 'Outro', value: 'other' },
]

const GERENTE_OPTIONS = [
  { label: 'João Soares Ribeiro', value: 'joao' },
  { label: 'Mathias Campos', value: 'mathias' },
]

type Option = { label: string; value: string }

// Profissão/Setor/Função vêm do catálogo REAL da org (GET /profile/catalog:
// DISTINCT de jobTitle/sector/duty). As listas fixas anteriores eram
// inventadas, divergiam do TaskForm e não continham os valores do banco
// ('Administrador'/'Gestão'): o Combobox abria em "Selecione aqui" e uma
// seleção qualquer sobrescrevia o cargo real (QA 2026-07-26). value === label
// de propósito: o backend guarda o rótulo de exibição verbatim.
const toOptions = (values: ReadonlyArray<string>): Option[] =>
  values.map((v) => ({ label: v, value: v }))

// Gerente segue lista fixa (pessoas, fonte diferente, fora do catálogo).
const valueOf = (options: Option[], label: string | null): string =>
  label ? (options.find((o) => o.label === label)?.value ?? label) : ''
const labelOf = (options: Option[], value: string): string =>
  options.find((o) => o.value === value)?.label ?? value

// O Combobox do DS resolve o texto do trigger por `options.find(o => o.value
// === value)` (Combobox.tsx:73), um value fora da lista renderiza o
// placeholder. Injeta o valor atual como opção para ele conseguir se exibir.
const withCurrent = (options: Option[], value: string): Option[] =>
  !value || options.some((o) => o.value === value) ? options : [...options, { label: value, value }]

/**
 * Gênero persiste como CÓDIGO ('male'/'female'/'other'). O form gravava o
 * rótulo ('Masculino'), então quem lê o campo comparando com 'male', detalhe
 * do funcionário, painel do chat, não achava nada e caía no default
 * (QA 2026-07-26). Tolera o rótulo legado na leitura.
 */
export const readGender = (raw: string | null): string => {
  if (!raw) return ''
  const byValue = GENDER_OPTIONS.find((o) => o.value === raw)
  if (byValue) return byValue.value
  return GENDER_OPTIONS.find((o) => o.label === raw)?.value ?? ''
}

// birthDate ISO ↔ dd/mm/aaaa da UI. Partes UTC de propósito: @db.Date chega
// como meia-noite UTC; getDate() local recuaria um dia a oeste de Greenwich.
const toDob = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}
const fromDob = (dob: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export function useUserSettings() {
  const { user } = useAuth()
  const { show: showToast } = useDemoToast()
  const [name, setName] = useState(user?.full_name ?? '')
  const [dob, setDob] = useState('')
  const [cpf, setCpf] = useState('')
  // E-mail de login não muda por aqui (exigiria reverificação), só exibe.
  const [email] = useState(user?.email ?? '')
  const [phone, setPhone] = useState('')
  const [uf, setUf] = useState('')
  const [city, setCity] = useState('')
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
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [showPrivacyModal, setShowPrivacyModal] = useState(false)

  // Vocabulário real da org. null enquanto carrega (as listas ficam só com o
  // valor atual via withCurrent: nada de opção inventada no meio-tempo).
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null)

  // Listas de exibição = catálogo + o valor atual, quando ele ainda não
  // estiver no DISTINCT (ver withCurrent, cinto contra corrida com o load).
  const profissaoOptions = useMemo(
    () => withCurrent(toOptions(catalog?.jobTitles ?? []), profissao),
    [catalog, profissao],
  )
  const setorOptions = useMemo(
    () => withCurrent(toOptions(catalog?.sectors ?? []), setor),
    [catalog, setor],
  )
  const funcaoOptions = useMemo(
    () => withCurrent(toOptions(catalog?.duties ?? []), funcao),
    [catalog, funcao],
  )
  const gerenteOptions = useMemo(() => withCurrent(GERENTE_OPTIONS, gerente), [gerente])

  // Fonte única dos exames: tabela Exam, a mesma que o app e o detalhe do
  // funcionário leem. Profile.examKeys continua existindo no backend mas não
  // alimenta mais nada aqui: era ele que fazia o arquivo enviado sumir.
  const [exams, setExams] = useState<Exam[]>([])
  const [examName, setExamName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examError, setExamError] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)
  const [changingPw, setChangingPw] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [examsBusy, setExamsBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const examsInputRef = useRef<HTMLInputElement | null>(null)

  // Catálogo em paralelo ao prefill: as opções chegam quando chegam; o valor
  // atual aparece antes disso via withCurrent.
  useEffect(() => {
    let cancelled = false
    profileApi.catalog().then(({ data }) => {
      if (!cancelled && data) setCatalog(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Prefill real: GET /profile/me (404 = perfil ainda não preenchido → form
  // vazio, sem erro). Labels do backend viram values dos comboboxes.
  useEffect(() => {
    let cancelled = false
    profileApi.me().then(({ data }) => {
      if (cancelled || !data) return
      setName(data.fullName ?? '')
      setDob(toDob(data.birthDate))
      // Mascara na leitura também: cadastros antigos guardaram dígitos crus, e
      // as máscaras são idempotentes sobre valor já formatado.
      setCpf(maskCpf(data.cpf ?? ''))
      setPhone(maskPhone(data.phone ?? ''))
      setUf(data.uf ?? '')
      setCity(data.city ?? '')
      // value === label nos campos de catálogo: o rótulo do banco É o value.
      setProfissao(data.jobTitle ?? '')
      setSetor(data.sector ?? '')
      setFuncao(data.duty ?? '')
      setGerente(valueOf(GERENTE_OPTIONS, data.managerName))
      setBloodType(data.bloodType ?? '')
      // gender é um CÓDIGO ('male'/'female'), não um rótulo: o resto do painel
      // (detalhe do funcionário, painel do chat) compara com esses valores.
      // Aceita também o rótulo legado ('Masculino') gravado antes da correção.
      setGender(readGender(data.gender))
      setAllergies(data.allergies ?? '')
      setChronic(data.chronicConditions ?? '')
      setAvatarUrl(data.avatarUrl)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Exames em chamada própria: outro endpoint e outra tabela, e um 500 aqui não
  // pode derrubar o prefill do cadastro inteiro.
  useEffect(() => {
    let cancelled = false
    examsApi.list().then(({ data }) => {
      if (!cancelled && data) setExams(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    setSaveError(null)
    const iso = fromDob(dob)
    if (dob.trim() && !iso) {
      setSaveError('Data de nascimento inválida: use dd/mm/aaaa.')
      return
    }
    setSaving(true)
    const patch: ProfilePatch = {
      fullName: name.trim(),
      // Só dígitos no banco (a máscara é apresentação), ver lib/masks.
      phone: onlyDigits(phone),
      cpf: onlyDigits(cpf),
      city: city.trim(),
      allergies,
      chronicConditions: chronic,
      // Condicionais: o backend valida uf com 2 letras e os selects vazios
      // não devem apagar o que já está salvo.
      ...(uf.trim() ? { uf: uf.trim() } : {}),
      ...(iso ? { birthDate: iso } : {}),
      // Campos de catálogo: value === label, o estado JÁ é o rótulo final.
      ...(profissao ? { jobTitle: profissao } : {}),
      ...(setor ? { sector: setor } : {}),
      ...(funcao ? { duty: funcao } : {}),
      ...(gerente ? { managerName: labelOf(GERENTE_OPTIONS, gerente) } : {}),
      // Grava o CÓDIGO, não o rótulo, ver readGender.
      ...(gender ? { gender } : {}),
      ...(bloodType ? { bloodType } : {}),
    }
    const { error } = await profileApi.update(patch)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    showToast('Alterações salvas', 'Cadastro atualizado com sucesso')
  }

  const changePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      setPwError('Preencha a senha atual, a nova e a repetição.')
      return
    }
    if (newPw.length < 6) {
      setPwError('A nova senha precisa de pelo menos 6 caracteres.')
      return
    }
    if (newPw !== confirmPw) {
      setPwError('A nova senha e a repetição não conferem.')
      return
    }
    setPwError(null)
    setChangingPw(true)
    const { error } = await authApi.changePassword({
      currentPassword: currentPw,
      newPassword: newPw,
    })
    setChangingPw(false)
    if (error) {
      setPwError(error.message)
      return
    }
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    showToast('Senha alterada', 'Sua senha foi atualizada')
  }

  const onAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      const key = await uploadImage(file, 'avatars')
      const { error } = await profileApi.update({ avatarKey: key })
      if (error) {
        showToast('Falha ao atualizar a foto', error.message)
      } else {
        // Preview imediato local; o presign de view chega no próximo load.
        if (typeof URL.createObjectURL === 'function') setAvatarUrl(URL.createObjectURL(file))
        showToast('Foto atualizada', 'Sua foto de perfil foi salva')
      }
    } catch (err) {
      showToast('Falha ao enviar a foto', err instanceof Error ? err.message : '')
    }
    setAvatarBusy(false)
  }

  // Anexar é o ÚLTIMO passo: nome e validade primeiro, como no app. O botão
  // fica habilitado e valida no clique em vez de nascer desabilitado, botão
  // morto sem explicação deixa o operador sem saber o que falta.
  const pickExamFile = () => {
    if (!examName.trim()) {
      setExamError('Informe o nome do exame.')
      return
    }
    if (!toCalendarDate(examDate)) {
      setExamError('Validade inválida: use dd/mm/aaaa.')
      return
    }
    setExamError(null)
    examsInputRef.current?.click()
  }

  const onExamSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    // Um por vez: nome e validade são de UM exame, e um chooser múltiplo os
    // aplicaria igual a todos os arquivos.
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const nome = examName.trim()
    const date = toCalendarDate(examDate)
    // Cinto: o seletor só abre pelo pickExamFile, que já validou. Se ainda
    // assim chegar inválido, não cadastra exame sem nome nem com data furada.
    if (!nome || !date) return
    setExamsBusy(true)
    try {
      const fileKey = await uploadImage(file, 'exams')
      const { data, error } = await examsApi.create({ name: nome, date, fileKey })
      if (error || !data) {
        showToast('Falha ao enviar exame', error?.message ?? '')
      } else {
        // Prepend: o mais recente primeiro, como o backend devolve na listagem.
        setExams((prev) => [data, ...prev])
        setExamName('')
        setExamDate('')
        showToast('Exame enviado', `${data.name} anexado ao seu perfil`)
      }
    } catch (err) {
      showToast('Falha ao enviar exame', err instanceof Error ? err.message : '')
    }
    setExamsBusy(false)
  }

  return {
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
  }
}
