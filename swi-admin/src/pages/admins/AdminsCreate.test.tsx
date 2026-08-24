// Comportamento do formulário compartilhado de cadastro (AdminsCreate serve
// tanto /admins quanto /employees). Prova: validação de obrigatórios, forma do
// payload (identidade mais saúde declaratória, nunca o username) e o onBack no
// sucesso.
// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { employeesApi, adminsApi } from '@/services/api/users'
import * as uploadMod from '@/services/api/upload'
import {
  AdminsCreate,
  dadosDeSaude,
  formDoUsuario,
  patchDoFormulario,
} from './AdminsCreate'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function finalizar() {
  fireEvent.click(screen.getByRole('button', { name: /finalizar cadastro/i }))
}

describe('AdminsCreate — submit', () => {
  // Não-vacuidade do bloqueio na edição: no cadastro o e-mail É o campo que
  // cria a identidade de login, e continua editável.
  it('no cadastro o e-mail continua editável', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    expect(screen.getByTestId('admins-create-email')).not.toHaveAttribute('readonly')
  })

  it('sem obrigatórios não chama a api', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    finalizar()

    expect(create).not.toHaveBeenCalled()
  })

  it('submit válido com saúde em branco não gera chave de saúde no payload', async () => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-telefone', '11999999999')
    typeIn('admins-create-senha', 'senha123')
    // Preenche o nome de usuário (campo de UI que NÃO deve subir): prova que um
    // campo PREENCHIDO fora da identidade não vaza pro payload, não só um vazio.
    typeIn('admins-create-usuario', 'zedasilva')

    finalizar()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0]?.[0]
    expect(payload).toEqual({
      name: 'Zé da Silva',
      email: 'ze@x.com',
      password: 'senha123',
      phone: '11999999999',
    })
    // Nada de saúde/username no corpo — esses campos ficam na UI mas não sobem.
    expect(payload).not.toHaveProperty('tipoSanguineo')
    expect(payload).not.toHaveProperty('genero')
    expect(payload).not.toHaveProperty('nomeUsuario')
  })

  it('e-mail inválido não chama create e mostra erro', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'abc')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/e-mail válido/i)
  })

  it('senha com menos de 8 caracteres não chama create', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'sete123')

    finalizar()

    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/8 caracteres/i)
  })

  it('admin usa adminsApi.create', async () => {
    const create = vi
      .spyOn(adminsApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    await renderPage(<AdminsCreate onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Ana Admin')
    typeIn('admins-create-email', 'ana@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('erro do backend vira alerta na tela e não fecha o formulário', async () => {
    vi.spyOn(employeesApi, 'create').mockResolvedValue({
      data: null as never,
      error: { message: 'E-mail já cadastrado' } as never,
    })
    const onBack = vi.fn()
    await renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('E-mail já cadastrado'))
    expect(onBack).not.toHaveBeenCalled()
  })

  it('sucesso chama onBack', async () => {
    vi.spyOn(employeesApi, 'create').mockResolvedValue({
      data: { id: 'n' } as never,
      error: null,
    })
    const onBack = vi.fn()
    await renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')

    finalizar()

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  })
})

describe('AdminsCreate: data de nascimento e CPF', () => {
  // O campo de data não tem testID próprio; o placeholder é o que o usuário vê.
  const preencherObrigatorios = () => {
    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')
  }

  const digitar = (placeholder: string, value: string) => {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
  }

  const submeterCom = async (campo: string, valor: string) => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'n' } as never, error: null })
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)
    preencherObrigatorios()
    digitar(campo, valor)
    finalizar()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    return create.mock.calls[0]?.[0]
  }

  it('data válida sobe como data pura, sem hora nem fuso', async () => {
    const payload = await submeterCom('DD/MM/AAAA', '05041990')

    expect(payload).toHaveProperty('birthDate', '1990-04-05')
  })

  it('a máscara formata a data enquanto se digita', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    digitar('DD/MM/AAAA', '05041990')

    expect(screen.getByPlaceholderText('DD/MM/AAAA')).toHaveValue('05/04/1990')
  })

  it('data que não existe no calendário não sobe', async () => {
    // 31 de fevereiro: o Date normalizaria para 02/03 e o cadastro guardaria
    // uma data que ninguém digitou.
    const payload = await submeterCom('DD/MM/AAAA', '31022020')

    expect(payload).not.toHaveProperty('birthDate')
  })

  it('mês fora da faixa não sobe', async () => {
    const payload = await submeterCom('DD/MM/AAAA', '01132020')

    expect(payload).not.toHaveProperty('birthDate')
  })

  it('data incompleta não sobe', async () => {
    const payload = await submeterCom('DD/MM/AAAA', '0504')

    expect(payload).not.toHaveProperty('birthDate')
  })

  it('ano com menos de quatro dígitos não sobe', async () => {
    const payload = await submeterCom('DD/MM/AAAA', '050490')

    expect(payload).not.toHaveProperty('birthDate')
  })

  it('CPF sobe só com dígitos, sem a pontuação da máscara', async () => {
    const payload = await submeterCom('000.000.000-00', '12345678901')

    expect(payload).toHaveProperty('cpf', '12345678901')
    expect(screen.getByPlaceholderText('000.000.000-00')).toHaveValue('123.456.789-01')
  })
})

describe('AdminsCreate: campos de saúde e rodapé', () => {
  // O Input do DS bloqueia via `editable={false}`, que o react-native-web
  // traduz para `readonly` no DOM, não para o atributo `disabled`.
  const descricaoAlergias = () => screen.getAllByPlaceholderText('Descrever aqui')[0]!

  it('"Quais?" só aceita texto depois de marcar Sim', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)
    expect(descricaoAlergias()).toHaveAttribute('readonly')

    fireEvent.click(screen.getAllByText('Sim')[0]!)

    await waitFor(() => expect(descricaoAlergias()).not.toHaveAttribute('readonly'))
  })

  it('marcar Não mantém o campo de descrição bloqueado', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    fireEvent.click(screen.getAllByText('Não')[0]!)

    expect(descricaoAlergias()).toHaveAttribute('readonly')
  })

  it('"Voltar" devolve para a lista sem cadastrar', async () => {
    const create = vi.spyOn(employeesApi, 'create')
    const onBack = vi.fn()
    await renderPage(<AdminsCreate subject="funcionário" onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de funcionários' }))

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('o rodapé nomeia administradores quando o formulário é de admin', async () => {
    await renderPage(<AdminsCreate onBack={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Voltar para a lista de administradores' }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Nome completo do novo administrador')).toBeInTheDocument()
  })
})

// A tela renderizava tipo sanguíneo, gênero, alergias e doenças crônicas e o
// submit jogava tudo fora: quem preenchia via o formulário aceitar e o dado
// sumir sem um aviso sequer. O backend aceita esses campos (CreateUserDto), e
// o que faltava aqui era traduzir o vocabulário da TELA para o CÓDIGO gravado.
//
// A convenção do código está declarada no mobile (settings/health-data.tsx) e
// é comparada pelo painel inteiro: gênero em 'male'/'female'/'other', tipo
// sanguíneo na sigla maiúscula, alergias em texto livre separado por vírgula.
describe('dadosDeSaude', () => {
  const vazio = {
    tipoSanguineo: '',
    genero: '',
    alergico: '' as const,
    alergicoDesc: '',
    doencasCronicas: '' as const,
    doencasCronicasDesc: '',
  }

  it('formulário intocado não produz campo nenhum', () => {
    expect(dadosDeSaude(vazio)).toEqual({})
  })

  it('gênero vira o código que o resto do sistema compara', () => {
    expect(dadosDeSaude({ ...vazio, genero: 'masculino' }).gender).toBe('male')
    expect(dadosDeSaude({ ...vazio, genero: 'feminino' }).gender).toBe('female')
  })

  // Decisão registrada: a tela mantém as 5 respostas e duas colapsam num
  // código só. Quem marca 'não-binário' reabre como 'Outro'. É perda de
  // granularidade assumida, e ainda assim menos perda que descartar tudo.
  it('não-binário e outro colapsam no mesmo código', () => {
    expect(dadosDeSaude({ ...vazio, genero: 'nao-binario' }).gender).toBe('other')
    expect(dadosDeSaude({ ...vazio, genero: 'outro' }).gender).toBe('other')
  })

  // 'Prefiro não informar' NÃO vira código: o campo sai do corpo, e ausência é
  // exatamente o que a tela de detalhe lê como 'não informado'. Mapear pra
  // 'other' diria que a pessoa declarou algo, quando ela declarou o contrário.
  it('prefiro não informar omite o campo em vez de inventar um código', () => {
    expect(dadosDeSaude({ ...vazio, genero: 'prefiro-nao-informar' })).toEqual({})
  })

  // O Combobox guarda 'a+' e o dado gravado é 'A+' (mesmo conjunto do mobile,
  // onde value é igual ao label). Sem normalizar, a lista de funcionários
  // mostraria 'a+' ao lado de 'O+' conforme a origem de cada cadastro.
  it('tipo sanguíneo sobe na sigla maiúscula do conjunto canônico', () => {
    expect(dadosDeSaude({ ...vazio, tipoSanguineo: 'a+' }).bloodType).toBe('A+')
    expect(dadosDeSaude({ ...vazio, tipoSanguineo: 'ab-' }).bloodType).toBe('AB-')
  })

  it('alergias sobem como o texto digitado quando a resposta é sim', () => {
    const r = dadosDeSaude({ ...vazio, alergico: 'sim', alergicoDesc: ' Penicilina, Látex ' })
    expect(r.allergies).toBe('Penicilina, Látex')
  })

  // Responder 'Não' não pode virar a string 'Não': o campo é texto livre que a
  // tela quebra por vírgula em chips (parseAllergies), então gravar 'Não'
  // renderizaria uma chip escrita Não. Ausência é o estado vazio honesto.
  it('responder não deixa o campo fora do corpo', () => {
    expect(dadosDeSaude({ ...vazio, alergico: 'nao', alergicoDesc: 'ignorado' })).toEqual({})
  })

  it('sim sem descrição também não vira campo (não há o que registrar)', () => {
    expect(dadosDeSaude({ ...vazio, alergico: 'sim', alergicoDesc: '   ' })).toEqual({})
  })

  it('doenças crônicas seguem a mesma régua das alergias', () => {
    const sim = dadosDeSaude({ ...vazio, doencasCronicas: 'sim', doencasCronicasDesc: 'Asma' })
    expect(sim.chronicConditions).toBe('Asma')
    expect(dadosDeSaude({ ...vazio, doencasCronicas: 'nao', doencasCronicasDesc: 'x' })).toEqual({})
  })
})

// Edição de cadastro. O formulário é o mesmo do cadastro (mesmos campos, mesma
// rota de dados), então a tradução precisa andar nos DOIS sentidos: o cadastro
// leva o vocabulário da tela pro gravado, e a edição traz o gravado de volta.
// Sem a volta, abrir a edição de quem é 'male' mostraria o gênero em branco e
// salvar apagaria o dado de quem só queria corrigir o telefone.
const GRAVADO = {
  id: 'u1',
  name: 'Carlos Mendes',
  email: 'carlos@x.com',
  phone: '11998765432',
  cpf: '41255687890',
  birthDate: '1992-03-14',
  gender: 'male',
  bloodType: 'O+',
  allergies: 'Penicilina',
  chronicConditions: '',
  exams: [],
}

describe('formDoUsuario', () => {
  it('traz o gênero gravado de volta pro vocabulário da tela', () => {
    expect(formDoUsuario(GRAVADO).genero).toBe('masculino')
    expect(formDoUsuario({ ...GRAVADO, gender: 'female' }).genero).toBe('feminino')
    expect(formDoUsuario({ ...GRAVADO, gender: 'other' }).genero).toBe('outro')
  })

  // Perda decidida no cadastro: 'nao-binario' e 'outro' colapsam em 'other', e
  // reabrir mostra 'Outro'. O teste fixa a perda pra que ela seja uma escolha
  // registrada, e não uma surpresa achada em produção.
  it('gênero fora do vocabulário não vira rótulo inventado', () => {
    expect(formDoUsuario({ ...GRAVADO, gender: 'masculino' }).genero).toBe('')
    expect(formDoUsuario({ ...GRAVADO, gender: '' }).genero).toBe('')
  })

  it('tipo sanguíneo volta em minúsculo, que é o valor que a combo guarda', () => {
    expect(formDoUsuario(GRAVADO).tipoSanguineo).toBe('o+')
  })

  it('nascimento volta no formato que a máscara da tela edita', () => {
    expect(formDoUsuario(GRAVADO).dataNascimento).toBe('14/03/1992')
    expect(formDoUsuario({ ...GRAVADO, birthDate: '' }).dataNascimento).toBe('')
  })

  it('texto de alergia gravado reabre com a resposta Sim marcada', () => {
    const f = formDoUsuario(GRAVADO)
    expect(f.alergico).toBe('sim')
    expect(f.alergicoDesc).toBe('Penicilina')
  })

  // Ausência de texto NÃO é o mesmo que ter respondido "Não": o banco guarda só
  // o texto, então quem nunca respondeu e quem respondeu Não são indistinguíveis
  // ali. Marcar 'nao' afirmaria uma declaração que ninguém fez.
  it('ausência de texto reabre sem resposta, não como Não', () => {
    expect(formDoUsuario(GRAVADO).doencasCronicas).toBe('')
  })

  it('senha nunca volta preenchida', () => {
    expect(formDoUsuario(GRAVADO).senha).toBe('')
  })
})

describe('patchDoFormulario', () => {
  it('leva identidade e saúde no vocabulário gravado', () => {
    expect(patchDoFormulario(formDoUsuario(GRAVADO))).toEqual({
      name: 'Carlos Mendes',
      phone: '11998765432',
      cpf: '41255687890',
      birthDate: '1992-03-14',
      gender: 'male',
      bloodType: 'O+',
      allergies: 'Penicilina',
      chronicConditions: '',
    })
  })

  // Limpar um campo precisa CHEGAR como limpeza: omitir significa "não mexe" e
  // o valor antigo sobreviveria a uma remoção deliberada.
  it('campo de texto esvaziado sobe vazio, para de fato limpar', () => {
    const patch = patchDoFormulario({ ...formDoUsuario(GRAVADO), telefone: '', alergico: 'nao' })
    expect(patch.phone).toBe('')
    expect(patch.allergies).toBe('')
  })

  // Nascimento é a exceção: o IsCalendarDate do backend recusa string vazia, e
  // mandá-la trocaria um campo em branco por um 400 na cara de quem salvou.
  it('nascimento em branco é omitido em vez de subir vazio', () => {
    const patch = patchDoFormulario({ ...formDoUsuario(GRAVADO), dataNascimento: '' })
    expect(patch).not.toHaveProperty('birthDate')
  })

  it('e-mail e senha ficam fora do patch, porque o backend não os aceita ali', () => {
    const patch = patchDoFormulario(formDoUsuario(GRAVADO))
    expect(patch).not.toHaveProperty('email')
    expect(patch).not.toHaveProperty('password')
  })
})

describe('AdminsCreate em modo edição', () => {
  const renderEdicao = () =>
    renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })

  it('carrega o cadastro e preenche os campos', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    await renderEdicao()

    await waitFor(() =>
      expect(screen.getByTestId('admins-create-nome')).toHaveValue('Carlos Mendes'),
    )
    expect(screen.getByTestId('admins-create-email')).toHaveValue('carlos@x.com')
  })

  // Senha na edição não é um campo em branco inofensivo: o PATCH não aceita
  // password, então o campo aceitaria uma senha nova e a jogaria fora.
  it('não pede senha', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    await renderEdicao()
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    expect(screen.queryByTestId('admins-create-senha')).toBeNull()
  })

  // O campo estava editável e o patch nunca o mandava: dava pra digitar um
  // e-mail novo, ver "Cadastro atualizado" e nada ter mudado. É o mesmo defeito
  // que este formulário passou a existir pra não ter, e ele não pode voltar
  // pela porta da edição. O backend recusa trocar e-mail de propósito (é a
  // identidade de login), então a tela mostra o valor e bloqueia a digitação.
  it('não deixa digitar um e-mail que o backend não vai aceitar', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    await renderEdicao()
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    // O Input do DS bloqueia via editable={false}, que o react-native-web
    // traduz pra `readonly` no DOM, não pro atributo `disabled`.
    expect(screen.getByTestId('admins-create-email')).toHaveAttribute('readonly')
  })

  it('salvar manda o PATCH e não cria ninguém', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    const create = vi.spyOn(employeesApi, 'create')
    const update = vi
      .spyOn(employeesApi, 'update')
      .mockResolvedValue({ data: { id: 'u1' } as never, error: null })
    await renderEdicao()
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    typeIn('admins-create-nome', 'Carlos M. Mendes')
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[0]).toBe('u1')
    expect(update.mock.calls[0]?.[1]).toMatchObject({ name: 'Carlos M. Mendes', gender: 'male' })
    expect(create).not.toHaveBeenCalled()
  })

  it('erro do backend aparece na tela e não fecha o formulário', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    vi.spyOn(employeesApi, 'update').mockResolvedValue({
      data: null,
      error: { message: 'cpf inválido' },
    })
    await renderEdicao()
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cpf inválido/i))
  })

  // Cadastro que não carrega não pode virar formulário em branco: salvar dali
  // apagaria o cadastro inteiro de quem só queria corrigir um campo.
  it('cadastro que não carrega diz isso em vez de abrir vazio', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({
      data: null,
      error: { message: 'Falha ao carregar' },
    })
    await renderEdicao()

    await waitFor(() => expect(screen.getByTestId('admins-create-nao-encontrado')).toBeTruthy())
    expect(screen.queryByTestId('admins-create-nome')).toBeNull()
  })
})

// Exames no cadastro e na edição do painel. Duas situações diferentes:
// na EDIÇÃO o usuário existe e o exame sobe na hora; no CADASTRO ele ainda não
// tem id, então o exame fica na fila e só sobe depois do create devolver o id.
describe('AdminsCreate: exames clínicos', () => {
  const arquivo = () => new File(['x'], 'laudo.pdf', { type: 'application/pdf' })

  const preencherExame = (nome: string, validade: string) => {
    fireEvent.change(screen.getByTestId('admins-create-exam-name'), { target: { value: nome } })
    fireEvent.change(screen.getByTestId('admins-create-exam-date'), { target: { value: validade } })
  }

  const escolherArquivo = () => {
    fireEvent.click(screen.getByRole('button', { name: /enviar exame/i }))
    fireEvent.change(screen.getByTestId('admins-create-exam-input'), {
      target: { files: [arquivo()] },
    })
  }

  it('no cadastro, o exame entra na fila e só sobe depois do usuário existir', async () => {
    const create = vi
      .spyOn(employeesApi, 'create')
      .mockResolvedValue({ data: { id: 'novo-1' } as never, error: null })
    const addExam = vi
      .spyOn(employeesApi, 'addExam')
      .mockResolvedValue({ data: { id: 'e1' } as never, error: null })
    const upload = vi.spyOn(uploadMod, 'uploadImage').mockResolvedValue('exams/k.pdf')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')
    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()

    // Enquanto o cadastro não existe, nada subiu: não há a quem anexar.
    await waitFor(() => expect(screen.getByText('Hemograma')).toBeTruthy())
    expect(upload).not.toHaveBeenCalled()
    expect(addExam).not.toHaveBeenCalled()

    finalizar()

    await waitFor(() => expect(addExam).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(addExam.mock.calls[0]?.[0]).toBe('novo-1')
    expect(addExam.mock.calls[0]?.[1]).toEqual({
      name: 'Hemograma',
      date: '2027-03-14',
      fileKey: 'exams/k.pdf',
    })
  })

  // Se o cadastro falhou, não existe usuário: subir o arquivo deixaria objeto
  // órfão no bucket em nome de alguém que não foi criado.
  it('cadastro recusado não sobe exame nenhum', async () => {
    vi.spyOn(employeesApi, 'create').mockResolvedValue({
      data: null,
      error: { message: 'E-mail já cadastrado' },
    })
    const addExam = vi.spyOn(employeesApi, 'addExam')
    const upload = vi.spyOn(uploadMod, 'uploadImage')
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    typeIn('admins-create-nome', 'Zé da Silva')
    typeIn('admins-create-email', 'ze@x.com')
    typeIn('admins-create-senha', 'senha123')
    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()
    finalizar()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/já cadastrado/i))
    expect(upload).not.toHaveBeenCalled()
    expect(addExam).not.toHaveBeenCalled()
  })

  it('exame sem nome ou sem validade não entra na fila e diz o que falta', async () => {
    await renderPage(<AdminsCreate subject="funcionário" onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /enviar exame/i }))

    // Casa a MENSAGEM, não o rótulo "Nome do exame" do campo, que existe sempre.
    await waitFor(() => expect(screen.getByText(/informe o nome do exame/i)).toBeTruthy())
  })

  it('na edição o exame sobe na hora, porque o cadastro já existe', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({ data: GRAVADO, error: null })
    const addExam = vi
      .spyOn(employeesApi, 'addExam')
      .mockResolvedValue({
        data: { id: 'e9', name: 'Hemograma', date: '2027-03-14', fileUrl: 'signed:k' },
        error: null,
      })
    vi.spyOn(uploadMod, 'uploadImage').mockResolvedValue('exams/k.pdf')
    await renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })
    await waitFor(() => screen.getByDisplayValue('Carlos Mendes'))

    preencherExame('Hemograma', '14/03/2027')
    escolherArquivo()

    await waitFor(() => expect(addExam).toHaveBeenCalledWith('u1', {
      name: 'Hemograma',
      date: '2027-03-14',
      fileKey: 'exams/k.pdf',
    }))
  })

  it('a edição mostra os exames que já estavam gravados', async () => {
    vi.spyOn(employeesApi, 'getForEdit').mockResolvedValue({
      data: {
        ...GRAVADO,
        exams: [{ id: 'e1', name: 'Audiometria', date: '2027-08-01', fileUrl: 'signed:a' }],
      },
      error: null,
    })
    await renderPage(<AdminsCreate subject="funcionário" />, {
      route: '/employees/u1/edit',
      path: '/employees/:id/edit',
    })

    await waitFor(() => expect(screen.getByText('Audiometria')).toBeTruthy())
  })
})
