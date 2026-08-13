// O hook concentra as decisões da tela de configurações: o que o prefill
// aceita, o que o patch manda (e o que ele deliberadamente NÃO manda), quando
// a troca de senha recusa antes de chamar a API, e o que acontece quando um
// upload falha. Nenhuma dessas regras aparece no layout, então testá-las pela
// página seria testar por acidente.
import type { ChangeEvent } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { readGender, useUserSettings } from './useUserSettings'

const h = vi.hoisted(() => ({
  me: vi.fn(),
  catalog: vi.fn(),
  update: vi.fn(),
  changePassword: vi.fn(),
  uploadImage: vi.fn(),
  examsList: vi.fn(),
  examsCreate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { full_name: 'Nome da Sessão', email: 'ana@exemplo.test' } }),
}))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => ({ show: h.toast }) }))
vi.mock('@/services/api/profile', () => ({
  profileApi: { me: h.me, catalog: h.catalog, update: h.update },
}))
vi.mock('@/services/api/auth', () => ({ authApi: { changePassword: h.changePassword } }))
vi.mock('@/services/api/upload', () => ({ uploadImage: h.uploadImage }))
vi.mock('@/services/api/exams', () => ({
  examsApi: { list: h.examsList, create: h.examsCreate },
}))

const profile = (over: Record<string, unknown> = {}) => ({
  fullName: 'Ana Lima',
  birthDate: '1990-05-04',
  cpf: '52998224725',
  phone: '11999998888',
  uf: 'SP',
  city: 'São Paulo',
  jobTitle: 'Administrador',
  sector: 'Gestão',
  duty: 'Coordenação',
  managerName: 'Mathias Campos',
  bloodType: 'O+',
  gender: 'female',
  allergies: 'Nenhuma',
  chronicConditions: '',
  avatarUrl: 'https://exemplo.test/foto.jpg',
  ...over,
})

const fileEvent = (file: File | null) =>
  ({
    target: { files: file ? [file] : [], value: 'x' },
  }) as unknown as ChangeEvent<HTMLInputElement>

beforeEach(() => {
  // Limpa o HISTÓRICO, não só as implementações: sem isto, `mock.calls[0]`
  // pega a chamada de um caso anterior e a asserção mede o teste errado.
  vi.clearAllMocks()
  h.me.mockResolvedValue({ data: null })
  h.catalog.mockResolvedValue({ data: null })
  h.update.mockResolvedValue({ error: null })
  h.changePassword.mockResolvedValue({ error: null })
  h.uploadImage.mockResolvedValue('avatars/abc.jpg')
  h.examsList.mockResolvedValue({ data: [] })
  h.examsCreate.mockResolvedValue({ data: { id: 'e1', name: 'Hemograma' }, error: null })
  h.toast.mockClear()
})

const setup = async () => {
  const view = renderHook(() => useUserSettings())
  await act(async () => {})
  return view
}

describe('readGender', () => {
  it('aceita o código, o rótulo legado, e devolve vazio para o resto', () => {
    expect(readGender('female')).toBe('female')
    expect(readGender('Masculino')).toBe('male')
    expect(readGender('sei-la')).toBe('')
    expect(readGender(null)).toBe('')
  })
})

describe('useUserSettings: prefill', () => {
  it('sem perfil salvo (404), o formulário fica vazio e o nome vem da sessão', async () => {
    const { result } = await setup()
    expect(result.current.name).toBe('Nome da Sessão')
    expect(result.current.cpf).toBe('')
    expect(result.current.avatarUrl).toBeNull()
  })

  it('com perfil salvo, mascara CPF e telefone e converte a data em dd/mm/aaaa', async () => {
    h.me.mockResolvedValue({ data: profile() })
    const { result } = await setup()

    await waitFor(() => expect(result.current.name).toBe('Ana Lima'))
    expect(result.current.dob).toBe('04/05/1990')
    expect(result.current.cpf).toBe('529.982.247-25')
    expect(result.current.phone).toBe('(11) 99999-8888')
    expect(result.current.gender).toBe('female')
    expect(result.current.gerente).toBe('mathias')
  })

  it('data de nascimento inválida vinda do backend não quebra o prefill', async () => {
    h.me.mockResolvedValue({ data: profile({ birthDate: 'não-é-data' }) })
    const { result } = await setup()
    await waitFor(() => expect(result.current.name).toBe('Ana Lima'))
    expect(result.current.dob).toBe('')
  })

  it('o valor atual entra na lista mesmo antes de o catálogo chegar', async () => {
    h.me.mockResolvedValue({ data: profile() })
    const { result } = await setup()

    await waitFor(() => expect(result.current.profissao).toBe('Administrador'))
    expect(result.current.profissaoOptions).toEqual([
      { label: 'Administrador', value: 'Administrador' },
    ])
  })

  it('com catálogo carregado, as opções são as da org sem duplicar o valor atual', async () => {
    h.me.mockResolvedValue({ data: profile() })
    h.catalog.mockResolvedValue({
      data: { jobTitles: ['Administrador', 'Operador'], sectors: [], duties: [] },
    })
    const { result } = await setup()

    await waitFor(() => expect(result.current.profissaoOptions).toHaveLength(2))
    expect(result.current.profissaoOptions.map((o) => o.value)).toEqual([
      'Administrador',
      'Operador',
    ])
  })

  it('carrega os exames da tabela Exam', async () => {
    h.examsList.mockResolvedValue({ data: [{ id: 'e9', name: 'Audiometria' }] })
    const { result } = await setup()
    await waitFor(() => expect(result.current.exams).toHaveLength(1))
  })
})

describe('useUserSettings: salvar cadastro', () => {
  it('data fora do formato dd/mm/aaaa barra antes de chamar a API', async () => {
    const { result } = await setup()
    await act(async () => result.current.setDob('4 de maio'))

    await act(async () => {
      await result.current.save()
    })

    expect(result.current.saveError).toMatch(/dd\/mm\/aaaa/)
    expect(h.update).not.toHaveBeenCalled()
  })

  // Comportamento atual, registrado de propósito: a guarda olha só o FORMATO.
  // Uma data impossível com a forma certa passa e vai ao backend como
  // '2020-31-31'. Quem validar calendário no cliente muda este caso junto.
  it('data com formato certo mas impossível não é barrada aqui', async () => {
    const { result } = await setup()
    await act(async () => result.current.setDob('31/31/2020'))

    await act(async () => {
      await result.current.save()
    })

    expect(result.current.saveError).toBeNull()
    expect(h.update.mock.calls[0]?.[0]).toMatchObject({ birthDate: '2020-31-31' })
  })

  it('manda só dígitos em CPF e telefone e omite os campos vazios', async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.setName('  Ana Lima  ')
      result.current.setCpf('529.982.247-25')
      result.current.setPhone('(11) 99999-8888')
    })

    await act(async () => {
      await result.current.save()
    })

    const patch = h.update.mock.calls[0]?.[0]
    expect(patch).toMatchObject({ fullName: 'Ana Lima', cpf: '52998224725', phone: '11999998888' })
    expect(patch).not.toHaveProperty('uf')
    expect(patch).not.toHaveProperty('birthDate')
    expect(patch).not.toHaveProperty('jobTitle')
    expect(h.toast).toHaveBeenCalledWith('Alterações salvas', 'Cadastro atualizado com sucesso')
  })

  it('gerente vai como rótulo e gênero vai como código', async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.setGerente('mathias')
      result.current.setGender('male')
      result.current.setUf(' SP ')
      result.current.setDob('04/05/1990')
    })

    await act(async () => {
      await result.current.save()
    })

    expect(h.update.mock.calls[0]?.[0]).toMatchObject({
      managerName: 'Mathias Campos',
      gender: 'male',
      uf: 'SP',
      birthDate: '1990-05-04',
    })
  })

  it('erro da API vira mensagem na tela e não anuncia sucesso', async () => {
    h.update.mockResolvedValue({ error: { message: 'CPF já cadastrado' } })
    const { result } = await setup()

    await act(async () => {
      await result.current.save()
    })

    expect(result.current.saveError).toBe('CPF já cadastrado')
    expect(h.toast).not.toHaveBeenCalled()
  })
})

describe('useUserSettings: troca de senha', () => {
  it.each([
    ['campo em branco', { cur: '', novo: 'novasenha', conf: 'novasenha' }, /Preencha/],
    ['nova curta demais', { cur: 'atual1', novo: '123', conf: '123' }, /6 caracteres/],
    ['repetição diferente', { cur: 'atual1', novo: 'novasenha', conf: 'outra' }, /não conferem/],
  ])('recusa antes de chamar a API: %s', async (_caso, campos, esperado) => {
    const { result } = await setup()
    await act(async () => {
      result.current.setCurrentPw(campos.cur)
      result.current.setNewPw(campos.novo)
      result.current.setConfirmPw(campos.conf)
    })

    await act(async () => {
      await result.current.changePassword()
    })

    expect(result.current.pwError).toMatch(esperado)
    expect(h.changePassword).not.toHaveBeenCalled()
  })

  it('sucesso limpa os três campos', async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.setCurrentPw('atual123')
      result.current.setNewPw('novasenha')
      result.current.setConfirmPw('novasenha')
    })

    await act(async () => {
      await result.current.changePassword()
    })

    expect(h.changePassword).toHaveBeenCalledWith({
      currentPassword: 'atual123',
      newPassword: 'novasenha',
    })
    expect(result.current.currentPw).toBe('')
    expect(result.current.newPw).toBe('')
    expect(result.current.confirmPw).toBe('')
  })

  it('senha atual errada mantém os campos e mostra o erro', async () => {
    h.changePassword.mockResolvedValue({ error: { message: 'Senha atual incorreta' } })
    const { result } = await setup()
    await act(async () => {
      result.current.setCurrentPw('errada')
      result.current.setNewPw('novasenha')
      result.current.setConfirmPw('novasenha')
    })

    await act(async () => {
      await result.current.changePassword()
    })

    expect(result.current.pwError).toBe('Senha atual incorreta')
    expect(result.current.currentPw).toBe('errada')
  })
})

describe('useUserSettings: foto de perfil', () => {
  const file = () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' })

  it('sem arquivo escolhido, não sobe nada', async () => {
    const { result } = await setup()

    await act(async () => {
      await result.current.onAvatarSelected(fileEvent(null))
    })

    expect(h.uploadImage).not.toHaveBeenCalled()
  })

  it('sucesso salva a chave no perfil e avisa', async () => {
    const { result } = await setup()

    await act(async () => {
      await result.current.onAvatarSelected(fileEvent(file()))
    })

    expect(h.uploadImage).toHaveBeenCalledWith(expect.any(File), 'avatars')
    expect(h.update).toHaveBeenCalledWith({ avatarKey: 'avatars/abc.jpg' })
    expect(h.toast).toHaveBeenCalledWith('Foto atualizada', 'Sua foto de perfil foi salva')
    expect(result.current.avatarBusy).toBe(false)
  })

  it('falha no upload não deixa a tela travada em "enviando"', async () => {
    h.uploadImage.mockRejectedValue(new Error('rede caiu'))
    const { result } = await setup()

    await act(async () => {
      await result.current.onAvatarSelected(fileEvent(file()))
    })

    expect(h.toast).toHaveBeenCalledWith('Falha ao enviar a foto', 'rede caiu')
    expect(result.current.avatarBusy).toBe(false)
  })

  it('erro do PATCH avisa sem trocar a foto exibida', async () => {
    h.update.mockResolvedValue({ error: { message: 'Arquivo recusado' } })
    const { result } = await setup()

    await act(async () => {
      await result.current.onAvatarSelected(fileEvent(file()))
    })

    expect(h.toast).toHaveBeenCalledWith('Falha ao atualizar a foto', 'Arquivo recusado')
  })
})

describe('useUserSettings: exames', () => {
  const file = () => new File(['x'], 'exame.pdf', { type: 'application/pdf' })

  it('exige nome antes de abrir o seletor de arquivo', async () => {
    const { result } = await setup()
    await act(async () => result.current.pickExamFile())
    expect(result.current.examError).toBe('Informe o nome do exame.')
  })

  it('exige validade em dd/mm/aaaa', async () => {
    const { result } = await setup()
    await act(async () => result.current.setExamName('Hemograma'))
    await act(async () => result.current.pickExamFile())
    expect(result.current.examError).toMatch(/Validade inválida/)
  })

  it('com nome e validade válidos, limpa o erro', async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.setExamName('Hemograma')
      result.current.setExamDate('01/12/2030')
    })
    await act(async () => result.current.pickExamFile())
    expect(result.current.examError).toBeNull()
  })

  it('envio bem-sucedido põe o exame no topo e limpa o formulário', async () => {
    const { result } = await setup()
    await act(async () => {
      result.current.setExamName('Hemograma')
      result.current.setExamDate('01/12/2030')
    })

    await act(async () => {
      await result.current.onExamSelected(fileEvent(file()))
    })

    expect(h.examsCreate).toHaveBeenCalledWith({
      name: 'Hemograma',
      date: '2030-12-01',
      fileKey: 'avatars/abc.jpg',
    })
    expect(result.current.exams[0]).toMatchObject({ id: 'e1' })
    expect(result.current.examName).toBe('')
    expect(result.current.examDate).toBe('')
  })

  it('sem nome ou validade, um arquivo escolhido à força não cadastra nada', async () => {
    const { result } = await setup()

    await act(async () => {
      await result.current.onExamSelected(fileEvent(file()))
    })

    expect(h.examsCreate).not.toHaveBeenCalled()
  })

  it('erro do backend avisa e não insere na lista', async () => {
    h.examsCreate.mockResolvedValue({ data: null, error: { message: 'Formato não aceito' } })
    const { result } = await setup()
    await act(async () => {
      result.current.setExamName('Hemograma')
      result.current.setExamDate('01/12/2030')
    })

    await act(async () => {
      await result.current.onExamSelected(fileEvent(file()))
    })

    expect(h.toast).toHaveBeenCalledWith('Falha ao enviar exame', 'Formato não aceito')
    expect(result.current.exams).toHaveLength(0)
  })
})
