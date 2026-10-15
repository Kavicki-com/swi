// Estado e traduções do formulário de cadastro e edição de usuário (admin e
// funcionário). Extraído de AdminsCreate.tsx: são funções puras, testadas
// sem montar a tela.
import type { EditableUser, UpdateUserInput } from '@/services/api/users'
import type { PanelLevel } from '@/services/types'
import { maskCpf, maskPhone, onlyDigits } from '@/lib/masks'

export type FormState = {
  // Dados do cadastro
  nomeCompleto: string
  email: string
  telefone: string
  dataNascimento: string
  cpf: string
  nomeUsuario: string
  senha: string
  // Nível de acesso: só no cadastro de administrador; vazio para funcionário.
  nivel: PanelLevel | ''
  // Dados de saúde
  tipoSanguineo: string
  genero: string
  alergico: 'sim' | 'nao' | ''
  alergicoDesc: string
  doencasCronicas: 'sim' | 'nao' | ''
  doencasCronicasDesc: string
}

export const TIPO_SANGUINEO_OPTIONS = [
  { value: 'a+', label: 'A+' },
  { value: 'a-', label: 'A-' },
  { value: 'b+', label: 'B+' },
  { value: 'b-', label: 'B-' },
  { value: 'ab+', label: 'AB+' },
  { value: 'ab-', label: 'AB-' },
  { value: 'o+', label: 'O+' },
  { value: 'o-', label: 'O-' },
]

export const GENERO_OPTIONS = [
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
    nivel: u.role === 'ADMIN' || u.role === 'SUPERVISOR' ? u.role : '',
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
export function patchDoFormulario(
  form: FormState,
  nivelGravado: string = form.nivel,
): UpdateUserInput {
  const birthDate = parseBR(form.dataNascimento)
  return {
    // Nível só quando mudou: o backend recusa a troca do próprio nível mesmo
    // para o mesmo valor, e quem edita a si mesmo não pode tropeçar nisso.
    ...(form.nivel && form.nivel !== nivelGravado ? { role: form.nivel } : {}),
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
export const usernameNormalizado = (raw: string): string => raw.trim().toLowerCase()

// 'DD/MM/AAAA' → ISO date-only ('AAAA-MM-DD'). Vazio/fora do formato → undefined
// (o campo é opcional; não sobe chave vazia). Retorna date-only, NÃO .toISOString():
// a meia-noite local vira UTC e a data recuaria um dia perto do fuso (off-by-one).
// O backend (@IsISO8601 + new Date(...)) aceita 'AAAA-MM-DD'. O round-trip por
// new Date rejeita datas impossíveis (31/02 rola pra 02/03 e não bate de volta).
export function parseBR(value: string): string | undefined {
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
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
