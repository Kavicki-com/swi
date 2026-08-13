import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SignUp from '../../../app/(auth)/sign-up';
import type { CompanyOption } from '../../../services/api/companies';

// Cadastro (fluxo 1, reordenado em 2026-07-27): a conta nasce AQUI, com nome,
// e-mail, senha e EMPRESA. O vínculo com a empresa é o que coloca o worker na
// fila de aprovação org-scoped do painel, sem ele, ele fica invisível.
//
// Dois incidentes moldaram esta tela e estão travados aqui:
//   - duplo toque no "Criar conta": o 2º toque levou 409 de e-mail já existente
//     enquanto o 1º já tinha criado a conta e navegado. A trava vive no
//     useSubmitOnce, NÃO no `disabled` do botão, botão desabilitado nunca
//     dispara onPress e os erros dos campos nunca apareceriam.
//   - o motivo da falha vem do servidor ("E-mail já cadastrado"); engolir isso
//     deixa a pessoa relendo o formulário sem achar o erro.

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));

const mockSignUp = jest.fn();
jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ signUp: mockSignUp }),
}));

const mockListCompanies = jest.fn();
jest.mock('../../../services/api/companies', () => ({
  listCompanies: () => mockListCompanies(),
}));

// AUTH_BACKEND é lido no MÓDULO da tela (NEEDS_COMPANY), não no render: o valor
// é congelado no import e não há como trocá-lo depois dentro do mesmo arquivo.
// Aqui fica o fluxo api (o de produção); o fluxo mock, onde o seletor de
// empresa não existe, tem arquivo próprio (sign-up.mock-flow.test.tsx):
// re-importar a tela com jest.isolateModules criaria uma SEGUNDA cópia do React
// e o render morre em "Cannot read properties of null (reading 'useContext')".
jest.mock('../../../lib/featureFlags', () => ({ AUTH_BACKEND: 'api' }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const EMPRESAS: CompanyOption[] = [
  { id: 'c1', name: 'Mineradora Alfa' },
  { id: 'c2', name: 'Construtora Beta' },
];

const SENHA = 'Segura1@';

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SignUp />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const campo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const digitar = async (tree: ReturnType<typeof create>, label: string, texto: string) => {
  await act(async () => { campo(tree, label).props.onChangeText(texto); });
};

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  await act(async () => { await botao(tree, label).props.onPress(); });
};

const combo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChange === 'function',
  )[0];

const aceitarTermos = async (tree: ReturnType<typeof create>) => {
  const checkbox = tree.root.findAll(
    (n) => typeof n.props?.onChange === 'function' && typeof n.props?.checked === 'boolean',
  )[0];
  await act(async () => { checkbox.props.onChange(true); });
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

const preencher = async (tree: ReturnType<typeof create>) => {
  await digitar(tree, 'Nome completo', 'Fulano de Tal');
  await digitar(tree, 'Email', 'fulano@empresa.com');
  await digitar(tree, 'Crie uma senha', SENHA);
  await digitar(tree, 'Confirme sua senha', SENHA);
  await act(async () => { combo(tree, 'Empresa').props.onChange('c1'); });
  await aceitarTermos(tree);
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockListCompanies.mockResolvedValue(EMPRESAS);
  mockSignUp.mockResolvedValue(undefined);
});

afterEach(() => {
  alerta.mockRestore();
});

describe('Cadastro: seletor de empresa', () => {
  it('oferece as empresas do catálogo público', async () => {
    const tree = await render();

    expect(combo(tree, 'Empresa').props.options).toEqual([
      { label: 'Mineradora Alfa', value: 'c1' },
      { label: 'Construtora Beta', value: 'c2' },
    ]);
  });

  // Sem a lista o cadastro não anda mesmo; o aviso inline é melhor do que
  // deixar submeter um vínculo vazio.
  it('falha ao carregar as empresas mostra aviso inline', async () => {
    mockListCompanies.mockRejectedValue(new Error('API fora do ar'));
    const tree = await render();

    // O traço (U+2014) vem da cópia da tela (sign-up.tsx). Montado por código
    // porque o caractere não entra no fonte (regra de escrita do projeto); a
    // comparação é com o texto exato que a pessoa lê.
    const traco = String.fromCharCode(0x2014);
    expect(textos(tree)).toContain(
      `Não foi possível carregar as empresas ${traco} verifique a conexão.`,
    );
  });

  it('sem empresa escolhida não cria a conta', async () => {
    const tree = await render();
    await digitar(tree, 'Nome completo', 'Fulano de Tal');
    await digitar(tree, 'Email', 'fulano@empresa.com');
    await digitar(tree, 'Crie uma senha', SENHA);
    await digitar(tree, 'Confirme sua senha', SENHA);
    await aceitarTermos(tree);

    await tocar(tree, 'Criar conta');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

});

describe('Cadastro: validação antes de submeter', () => {
  it('formulário vazio revela os erros em vez de ficar mudo', async () => {
    const tree = await render();
    await tocar(tree, 'Criar conta');

    expect(mockSignUp).not.toHaveBeenCalled();
    expect(campo(tree, 'Nome completo').props.descriptionVariant).toBe('error');
    expect(campo(tree, 'Email').props.descriptionVariant).toBe('error');
  });

  it('campo intocado não abre a tela em vermelho', async () => {
    const tree = await render();
    expect(campo(tree, 'Email').props.descriptionVariant).toBeUndefined();
  });

  it.each([
    ['Nome completo', 'Fulano'],
    ['Email', 'fulano@empresa'],
    ['Crie uma senha', 'abcdefgh'],
  ])('%p inválido barra o cadastro', async (label, valor) => {
    const tree = await render();
    await preencher(tree);
    await digitar(tree, label, valor);
    await tocar(tree, 'Criar conta');

    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('confirmação diferente barra o cadastro e diz o motivo', async () => {
    const tree = await render();
    await preencher(tree);
    await digitar(tree, 'Confirme sua senha', 'Outra1@x');
    await act(async () => { campo(tree, 'Confirme sua senha').props.onBlur(); });
    await tocar(tree, 'Criar conta');

    expect(mockSignUp).not.toHaveBeenCalled();
    expect(campo(tree, 'Confirme sua senha').props.description).toBe(
      'As senhas não coincidem',
    );
  });

  it('senhas iguais viram confirmação visível, não silêncio', async () => {
    const tree = await render();
    await digitar(tree, 'Crie uma senha', SENHA);
    await digitar(tree, 'Confirme sua senha', SENHA);

    expect(campo(tree, 'Confirme sua senha').props).toMatchObject({
      description: 'As senhas são iguais ✓',
      descriptionVariant: 'success',
    });
  });

  // Aceitar os termos é requisito legal do cadastro.
  it('sem aceitar os termos não cria a conta', async () => {
    const tree = await render();
    await digitar(tree, 'Nome completo', 'Fulano de Tal');
    await digitar(tree, 'Email', 'fulano@empresa.com');
    await digitar(tree, 'Crie uma senha', SENHA);
    await digitar(tree, 'Confirme sua senha', SENHA);
    await act(async () => { combo(tree, 'Empresa').props.onChange('c1'); });

    await tocar(tree, 'Criar conta');
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe('Cadastro: criação da conta', () => {
  it('manda nome, e-mail, senha e empresa, e segue pra confirmação de e-mail', async () => {
    const tree = await render();
    await preencher(tree);
    await tocar(tree, 'Criar conta');

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'fulano@empresa.com',
      password: SENHA,
      name: 'Fulano de Tal',
      companyId: 'c1',
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(auth)/email-sent',
      params: { email: 'fulano@empresa.com' },
    });
  });

  it('espaço sobrando no nome não vai pro backend', async () => {
    const tree = await render();
    await preencher(tree);
    await digitar(tree, 'Nome completo', '  Fulano de Tal  ');
    await tocar(tree, 'Criar conta');

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fulano de Tal' }),
    );
  });

  // O 2º toque levava 409 de e-mail já existente sobre a conta que o 1º acabou
  // de criar. A trava é o useSubmitOnce, não o disabled do botão.
  it('duplo toque cria a conta uma única vez', async () => {
    let liberar!: () => void;
    mockSignUp.mockImplementation(() => new Promise<void>((res) => { liberar = res; }));
    const tree = await render();
    await preencher(tree);

    let primeiro!: Promise<void>;
    await act(async () => { primeiro = botao(tree, 'Criar conta').props.onPress(); });
    await act(async () => { await botao(tree, 'Criar conta').props.onPress(); });

    expect(mockSignUp).toHaveBeenCalledTimes(1);

    await act(async () => { liberar(); await primeiro; });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('o botão NÃO é desabilitado: é ele que revela os erros', async () => {
    const tree = await render();
    expect(botao(tree, 'Criar conta').props.disabled).toBeFalsy();
  });

  it('erro do servidor aparece com o motivo que ele deu', async () => {
    mockSignUp.mockRejectedValue(new Error('E-mail já cadastrado'));
    const tree = await render();
    await preencher(tree);
    await tocar(tree, 'Criar conta');

    expect(alerta).toHaveBeenCalledWith('Erro', expect.stringContaining('E-mail já cadastrado'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('falha sem mensagem cai no texto genérico', async () => {
    mockSignUp.mockRejectedValue(undefined);
    const tree = await render();
    await preencher(tree);
    await tocar(tree, 'Criar conta');

    expect(alerta).toHaveBeenCalledWith('Erro', 'Não foi possível criar a conta.');
  });
});

describe('Cadastro: navegação auxiliar', () => {
  it('abre a política de privacidade', async () => {
    const tree = await render();
    await tocar(tree, 'Política de privacidade & Termos de uso');

    expect(mockPush).toHaveBeenCalledWith('/modals/privacy-policy');
  });

  it('"Voltar" sai da tela sem criar conta', async () => {
    const tree = await render();
    await tocar(tree, 'Voltar');

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});
