import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsPersonalData from '../../../../app/(app)/settings/personal-data';
import { useProfile } from '../../../../services/profile/ProfileProvider';
import { fetchProfileCatalog } from '../../../../services/api/catalog';
import { useMediaPicker } from '../../../../lib/media/useMediaPicker';
import { uploadImage } from '../../../../services/api/uploadMedia';

jest.mock('../../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('../../../../services/api/catalog', () => ({ fetchProfileCatalog: jest.fn() }));
// A tela passou a ler o e-mail da CONTA (User), nao do Profile, o campo Email
// antes nao carregava nem salvava nada.
jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'fulano@empresa.com', name: 'Fulano' } }),
}));
// Spies estaveis: `jest.fn()` criado dentro do factory devolveria uma funcao
// nova por render, e nenhuma navegacao seria verificavel.
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));
jest.mock('../../../../lib/media/useMediaPicker', () => ({ useMediaPicker: jest.fn() }));
jest.mock('../../../../services/api/uploadMedia', () => ({ uploadImage: jest.fn() }));

const mockUseProfile = useProfile as jest.Mock;
const mockCatalog = fetchProfileCatalog as jest.Mock;
const mockUseMediaPicker = useMediaPicker as jest.Mock;
const mockUploadImage = uploadImage as jest.Mock;

const FOTO_LOCAL = 'file:///tmp/selfie.jpg';
const AVATAR_KEY = 'avatars/00000000-0000-4000-8000-000000000000.jpg';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// CPF sintético com dígitos verificadores válidos (não pertence a ninguém).
const CPF_VALIDO = '52998224725';

let saveProfile: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SettingsPersonalData />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// A tela é montada de verdade; o alvo é o <Input> do DS identificado pelo
// label visível, é assim que o usuário o encontra, e sobrevive a remanejo
// de layout.
const field = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const type = async (tree: ReturnType<typeof create>, label: string, text: string) => {
  await act(async () => { field(tree, label).props.onChangeText(text); });
};

const valueOf = (tree: ReturnType<typeof create>, label: string) => field(tree, label).props.value;

const press = async (tree: ReturnType<typeof create>, label: string) => {
  const btn = tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => { btn.props.onPress(); });
};

beforeEach(() => {
  jest.clearAllMocks();
  saveProfile = jest.fn(async () => ({}));
  mockUseProfile.mockReturnValue({ loadProfile: jest.fn(async () => null), saveProfile });
  mockCatalog.mockResolvedValue({ jobTitles: [], sectors: [], duties: [], managers: [] });
  mockUseMediaPicker.mockReturnValue({
    pickFromGallery: jest.fn(async () => FOTO_LOCAL),
    takePhoto: jest.fn(async () => FOTO_LOCAL),
    showPicker: jest.fn(async () => FOTO_LOCAL),
  });
  mockUploadImage.mockResolvedValue(AVATAR_KEY);
});

describe('Dados pessoais: máscara de entrada', () => {
  // A data de nascimento precisa das barras enquanto se digita, senão o campo
  // aceita 02011999. As máscaras vivem em lib/validation/masks.ts, e esta tela
  // tem que usá-las em vez de useState cru.
  it('formata a data de nascimento enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'Data de Nascimento', '02011999');
    expect(valueOf(tree, 'Data de Nascimento')).toBe('02/01/1999');
  });

  it('formata o CPF enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'CPF', CPF_VALIDO);
    expect(valueOf(tree, 'CPF')).toBe('529.982.247-25');
  });

  it('formata o telefone enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'Telefone', '41999990000');
    expect(valueOf(tree, 'Telefone')).toBe('(41) 99999-0000');
  });

  it('UF aceita só letras e sobe pra maiúscula', async () => {
    const tree = await render();
    await type(tree, 'UF', 'pr1');
    expect(valueOf(tree, 'UF')).toBe('PR');
  });
});

describe('Dados pessoais: validação', () => {
  const preencherTudoValido = async (tree: ReturnType<typeof create>) => {
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');
    await type(tree, 'UF', 'PR');
    await type(tree, 'Cidade', 'Curitiba');
  };

  it('não salva com CPF inválido', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await type(tree, 'CPF', '11111111111'); // 11 dígitos iguais, inválido
    await press(tree, 'Salvar alterações');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('não salva com data de nascimento impossível', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await type(tree, 'Data de Nascimento', '31022020'); // 31 de fevereiro
    await press(tree, 'Salvar alterações');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('salva quando tudo é válido', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await press(tree, 'Salvar alterações');
    expect(saveProfile).toHaveBeenCalledTimes(1);
  });

  // Campo intocado fica quieto: o useField só acusa erro depois do blur, e
  // abrir a tela com tudo vermelho é hostil com quem só veio conferir o
  // cadastro.
  it('campo intocado não mostra erro', async () => {
    const tree = await render();
    expect(field(tree, 'CPF').props.descriptionVariant).not.toBe('error');
  });
});

// Esta é a tela que define a foto de perfil. O seletor do passo 1 do cadastro
// guarda a uri num useState e a descarta, então não serve como caminho. O
// backend já aceita as duas pontas: /media/presign com prefix 'avatars' e
// PUT /profile/me validando avatarKey.
//
// Sem foto, o Avatar cai nas iniciais em todas as telas: jornada, dashboard,
// chat, mapa e no seletor de responsáveis.
describe('Dados pessoais: foto de perfil', () => {
  const uploader = (tree: ReturnType<typeof create>) =>
    tree.root.findAll((n) => typeof n.props?.onPickFile === 'function')[0];

  const preencherObrigatorios = async (tree: ReturnType<typeof create>) => {
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');
  };

  it('a tela oferece um seletor de foto', async () => {
    const tree = await render();
    expect(uploader(tree)).toBeDefined();
  });

  it('a foto escolhida aparece como preview antes de salvar', async () => {
    const tree = await render();
    await act(async () => { await uploader(tree).props.onPickFile(); });
    expect(uploader(tree).props.value).toEqual({ uri: FOTO_LOCAL });
  });

  it('salvar sobe o arquivo pro namespace avatars e grava a key', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await act(async () => { await uploader(tree).props.onPickFile(); });
    await press(tree, 'Salvar alterações');

    expect(mockUploadImage).toHaveBeenCalledWith(FOTO_LOCAL, 'avatars');
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ avatarKey: AVATAR_KEY }),
    );
  });

  // Sem isto, abrir a tela e salvar qualquer outro campo re-subiria a mesma
  // foto e criaria um objeto novo no bucket a cada vez.
  it('sem foto nova, não sobe nada', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await press(tree, 'Salvar alterações');

    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ avatarKey: expect.anything() }),
    );
  });

  // O upload é o passo que depende de rede; falhar nele não pode levar junto
  // o resto do cadastro que a pessoa acabou de digitar.
  it('falha no upload não descarta o que foi digitado', async () => {
    mockUploadImage.mockRejectedValue(new Error('rede caiu'));
    const tree = await render();
    await preencherObrigatorios(tree);
    await act(async () => { await uploader(tree).props.onPickFile(); });
    await press(tree, 'Salvar alterações');

    expect(valueOf(tree, 'Nome Completo')).toBe('Fulano de Tal');
    expect(uploader(tree).props.value).toEqual({ uri: FOTO_LOCAL });
  });

  // O backend guarda a KEY, não o arquivo. Falhar no upload aborta o
  // salvamento inteiro: gravar o perfil sem a foto que a pessoa acabou de
  // escolher seria pior do que não gravar nada.
  it('falha no upload aborta o salvamento inteiro', async () => {
    mockUploadImage.mockRejectedValue(new Error('rede caiu'));
    const tree = await render();
    await preencherObrigatorios(tree);
    await act(async () => { await uploader(tree).props.onPickFile(); });
    await press(tree, 'Salvar alterações');

    expect(saveProfile).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('tirar foto na hora também vira preview e upload', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await act(async () => { await uploader(tree).props.onTakePhoto(); });
    await press(tree, 'Salvar alterações');

    expect(mockUploadImage).toHaveBeenCalledWith(FOTO_LOCAL, 'avatars');
  });

  it('remover a foto limpa o preview e não sobe nada', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await act(async () => { await uploader(tree).props.onPickFile(); });
    await act(async () => { uploader(tree).props.onRemove(); });

    expect(uploader(tree).props.value).toBeNull();
    await press(tree, 'Salvar alterações');
    expect(mockUploadImage).not.toHaveBeenCalled();
  });

  // A foto que vem do backend é URL assinada, não arquivo local: ela aparece
  // como preview mas não pode ser re-enviada ao bucket.
  it('foto que veio do backend aparece sem ser re-enviada', async () => {
    mockUseProfile.mockReturnValue({
      loadProfile: jest.fn(async () => ({ avatarUrl: 'https://example.test/avatar.png' })),
      saveProfile,
    });
    const tree = await render();
    expect(uploader(tree).props.value).toEqual({ uri: 'https://example.test/avatar.png' });

    await preencherObrigatorios(tree);
    await press(tree, 'Salvar alterações');
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

// A tela nasceu com os valores de exemplo do Figma ('Carlos Sampaio',
// '00/00/0000') cravados: o cliente editava, "salvava" (era router.back()) e
// perdia tudo. O prefill e o save reais são o que estes casos travam.
describe('Dados pessoais: prefill do cadastro', () => {
  const PERFIL = {
    fullName: 'Fulano de Tal',
    birthDate: '02011999',
    cpf: CPF_VALIDO,
    phone: '41999990000',
    uf: 'pr',
    city: 'Curitiba',
    jobTitle: 'Operador de escavadeira',
    sector: 'Mina',
    duty: 'Operação',
    managerName: 'Gerente Teste',
  };

  // setValue aplica a máscara: perfil antigo salvo cru entra formatado na tela
  // em vez de perpetuar o dado sem barras.
  it('formata na entrada o que estava salvo sem máscara', async () => {
    mockUseProfile.mockReturnValue({ loadProfile: jest.fn(async () => PERFIL), saveProfile });
    const tree = await render();

    expect(valueOf(tree, 'Data de Nascimento')).toBe('02/01/1999');
    expect(valueOf(tree, 'CPF')).toBe('529.982.247-25');
    expect(valueOf(tree, 'Telefone')).toBe('(41) 99999-0000');
    expect(valueOf(tree, 'UF')).toBe('PR');
    expect(valueOf(tree, 'Cidade')).toBe('Curitiba');
  });

  it('perfil vazio deixa os campos em branco, sem "undefined"', async () => {
    mockUseProfile.mockReturnValue({ loadProfile: jest.fn(async () => ({})), saveProfile });
    const tree = await render();

    expect(valueOf(tree, 'Nome Completo')).toBe('');
    expect(valueOf(tree, 'CPF')).toBe('');
  });

  it('falha ao carregar o perfil não derruba a tela', async () => {
    mockUseProfile.mockReturnValue({
      loadProfile: jest.fn(async () => { throw new Error('rede'); }),
      saveProfile,
    });
    const tree = await render();

    expect(field(tree, 'Nome Completo')).toBeDefined();
  });
});

describe('Dados pessoais: e-mail da conta', () => {
  // O e-mail fica em leitura. Trocar e-mail é operação de autenticação e não
  // cabe nesta tela, então um campo editável aqui não seria preenchido no load
  // nem enviado no save, e digitar nele não faria nada.
  it('mostra o e-mail da conta em leitura, com o caminho do suporte', async () => {
    const tree = await render();
    const email = tree.root.findAll((n) => n.props?.label === 'Email')[0];

    expect(email.props.value).toBe('fulano@empresa.com');
    expect(email.props.disabled).toBe(true);
    expect(email.props.description).toContain('suporte');
  });

  it('o e-mail não vai no que é salvo', async () => {
    const tree = await render();
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');
    await press(tree, 'Salvar alterações');

    expect(saveProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ email: expect.anything() }),
    );
  });
});

describe('Dados pessoais: campos opcionais', () => {
  const preencherObrigatorios = async (tree: ReturnType<typeof create>) => {
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');
  };

  // Edição, não cadastro: quem nunca informou a UF não pode ficar impedido de
  // corrigir o telefone por causa disso.
  it('salva com UF e cidade em branco', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await press(tree, 'Salvar alterações');

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ uf: undefined, city: undefined }),
    );
  });

  it('mas UF preenchida errada continua barrando', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await type(tree, 'UF', 'XX'); // sigla que não existe
    await press(tree, 'Salvar alterações');

    expect(saveProfile).not.toHaveBeenCalled();
  });
});

describe('Dados pessoais: catálogo da org', () => {
  it('oferece o vocabulário real vindo do backend', async () => {
    mockCatalog.mockResolvedValue({
      jobTitles: ['Operador de escavadeira'],
      sectors: ['Mina'],
      duties: ['Operação'],
      managers: ['Gerente Teste'],
    });
    const tree = await render();
    const combo = (label: string) =>
      tree.root.findAll(
        (n) => n.props?.label === label && typeof n.props?.onChange === 'function',
      )[0];

    expect(combo('Profissão').props.options).toEqual([
      { label: 'Operador de escavadeira', value: 'Operador de escavadeira' },
    ]);
    expect(combo('Gerente responsável').props.options).toEqual([
      { label: 'Gerente Teste', value: 'Gerente Teste' },
    ]);
  });

  // Sem isto o Combobox mostraria o placeholder em cima de um cadastro
  // preenchido, como se o campo estivesse vazio.
  it('injeta o valor salvo quando o catálogo não o contém', async () => {
    mockUseProfile.mockReturnValue({
      loadProfile: jest.fn(async () => ({ jobTitle: 'Cargo antigo' })),
      saveProfile,
    });
    mockCatalog.mockResolvedValue({
      jobTitles: ['Operador de escavadeira'],
      sectors: [],
      duties: [],
      managers: [],
    });
    const tree = await render();
    const profissao = tree.root.findAll(
      (n) => n.props?.label === 'Profissão' && typeof n.props?.onChange === 'function',
    )[0];

    expect(profissao.props.value).toBe('Cargo antigo');
    expect(profissao.props.options[0]).toEqual({ label: 'Cargo antigo', value: 'Cargo antigo' });
  });

  it('falha no catálogo deixa os comboboxes vazios em vez de derrubar a tela', async () => {
    mockCatalog.mockRejectedValue(new Error('rede'));
    const tree = await render();
    const setor = tree.root.findAll(
      (n) => n.props?.label === 'Setor' && typeof n.props?.onChange === 'function',
    )[0];

    expect(setor.props.options).toEqual([]);
  });

  it('a escolha no combobox é o que vai pro backend', async () => {
    mockCatalog.mockResolvedValue({
      jobTitles: ['Operador de escavadeira'],
      sectors: ['Mina'],
      duties: ['Operação'],
      managers: ['Gerente Teste'],
    });
    const tree = await render();
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');

    const escolher = async (label: string, valor: string) => {
      const c = tree.root.findAll(
        (n) => n.props?.label === label && typeof n.props?.onChange === 'function',
      )[0];
      await act(async () => { c.props.onChange(valor); });
    };
    await escolher('Profissão', 'Operador de escavadeira');
    await escolher('Setor', 'Mina');
    await escolher('Função', 'Operação');
    await escolher('Gerente responsável', 'Gerente Teste');

    await press(tree, 'Salvar alterações');

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        jobTitle: 'Operador de escavadeira',
        sector: 'Mina',
        duty: 'Operação',
        managerName: 'Gerente Teste',
      }),
    );
  });
});

describe('Dados pessoais: saída da tela', () => {
  const preencherObrigatorios = async (tree: ReturnType<typeof create>) => {
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Telefone', '41999990000');
  };

  it('salvar com sucesso volta para o settings', async () => {
    const tree = await render();
    await preencherObrigatorios(tree);
    await press(tree, 'Salvar alterações');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('falha ao salvar fica na tela', async () => {
    saveProfile.mockRejectedValue(new Error('token expirado'));
    const tree = await render();
    await preencherObrigatorios(tree);
    await press(tree, 'Salvar alterações');

    expect(mockBack).not.toHaveBeenCalled();
  });

  it('a barra de topo volta sem salvar', async () => {
    const tree = await render();
    const topBar = tree.root.findAll((n) => typeof n.props?.onBack === 'function')[0];
    await act(async () => { topBar.props.onBack(); });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(saveProfile).not.toHaveBeenCalled();
  });
});
