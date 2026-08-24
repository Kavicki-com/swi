// Comportamento do formulário compartilhado de cadastro (AdminsCreate serve
// tanto /admins quanto /employees). Prova: validação de obrigatórios, forma do
// payload (identidade mais saúde declaratória, nunca o username) e o onBack no
// sucesso.
// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { employeesApi, adminsApi } from '@/services/api/users'
import { AdminsCreate, dadosDeSaude } from './AdminsCreate'

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
