import { act, create } from 'react-test-renderer';
import { Alert, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsHealthData from '../../../../app/(app)/settings/health-data';
import type { Exam } from '../../../../services/api/exams';

// Dados de saúde (settings). Esta suíte trava o caminho real: prefill do
// backend, salvar de verdade,
// exame com nome e validade ANTES do arquivo (decisão do cliente, senão o card
// do histórico não tem o que mostrar), e seletor de DOCUMENTO em vez de galeria,
// porque laudo costuma ser PDF e na galeria ele não aparece.

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));

const mockLoadProfile = jest.fn();
const mockSaveProfile = jest.fn();
jest.mock('../../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ loadProfile: mockLoadProfile, saveProfile: mockSaveProfile }),
}));

const mockListExams = jest.fn();
const mockCreateExam = jest.fn();
jest.mock('../../../../services/api/exams', () => ({
  listExams: () => mockListExams(),
  createExam: (params: unknown) => mockCreateExam(params),
}));

const mockPickDocument = jest.fn();
jest.mock('../../../../lib/media/pickDocument', () => ({
  pickExamDocument: () => mockPickDocument(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const exame = (over: Partial<Exam> = {}): Exam => ({
  id: 'e1',
  name: 'Audiometria',
  date: '2027-03-05',
  fileUrl: 'https://example.test/e1.pdf',
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SettingsHealthData />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Campos e comboboxes do DS são achados pelo label visível, é assim que a
// pessoa os encontra, e sobrevive a remanejo de layout.
const campo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const digitar = async (tree: ReturnType<typeof create>, label: string, texto: string) => {
  await act(async () => { campo(tree, label).props.onChangeText(texto); });
};

const valorDe = (tree: ReturnType<typeof create>, label: string) => campo(tree, label).props.value;

const combo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChange === 'function',
  )[0];

const escolher = async (tree: ReturnType<typeof create>, label: string, valor: string) => {
  await act(async () => { combo(tree, label).props.onChange(valor); });
};

const uploader = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => typeof n.props?.onPickFile === 'function')[0];

const anexar = async (tree: ReturnType<typeof create>) => {
  await act(async () => { await uploader(tree).props.onPickFile(); });
};

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockLoadProfile.mockResolvedValue(null);
  mockSaveProfile.mockResolvedValue({});
  mockListExams.mockResolvedValue([]);
  mockCreateExam.mockResolvedValue(exame());
  mockPickDocument.mockResolvedValue('file:///tmp/laudo.pdf');
});

afterEach(() => {
  alerta.mockRestore();
});

describe('Dados de saúde: prefill do cadastro', () => {
  it('carrega tipo sanguíneo, gênero, alergias e doenças do backend', async () => {
    mockLoadProfile.mockResolvedValue({
      bloodType: 'O+',
      gender: 'male',
      allergies: 'Dipirona',
      chronicConditions: 'Asma',
    });
    const tree = await render();

    expect(combo(tree, 'Tipo sanguíneo').props.value).toBe('O+');
    expect(combo(tree, 'Gênero').props.value).toBe('male');
    expect(valorDe(tree, 'Possui alergias?')).toBe('Dipirona');
    expect(valorDe(tree, 'Possui doenças crônicas?')).toBe('Asma');
  });

  it('perfil vazio deixa os campos em branco, sem "undefined"', async () => {
    mockLoadProfile.mockResolvedValue({});
    const tree = await render();

    expect(combo(tree, 'Tipo sanguíneo').props.value).toBe('');
    expect(valorDe(tree, 'Possui alergias?')).toBe('');
  });

  it('falha ao carregar o perfil não derruba a tela', async () => {
    mockLoadProfile.mockRejectedValue(new Error('rede'));
    const tree = await render();

    expect(botao(tree, 'Salvar alterações')).toBeDefined();
  });
});

describe('Dados de saúde: salvar', () => {
  it('manda ao backend o que foi editado e volta', async () => {
    const tree = await render();
    await escolher(tree, 'Tipo sanguíneo', 'AB-');
    await escolher(tree, 'Gênero', 'female');
    await digitar(tree, 'Possui alergias?', 'Látex');
    await digitar(tree, 'Possui doenças crônicas?', 'Hipertensão');

    await act(async () => { botao(tree, 'Salvar alterações').props.onPress(); });

    expect(mockSaveProfile).toHaveBeenCalledWith({
      bloodType: 'AB-',
      gender: 'female',
      allergies: 'Látex',
      chronicConditions: 'Hipertensão',
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // Campo em branco vira undefined, não string vazia: apagar de propósito não
  // pode gravar "" como se fosse uma resposta.
  it('campo não preenchido vai como ausente, não como texto vazio', async () => {
    const tree = await render();
    await act(async () => { botao(tree, 'Salvar alterações').props.onPress(); });

    expect(mockSaveProfile).toHaveBeenCalledWith({
      bloodType: undefined,
      gender: undefined,
      allergies: undefined,
      chronicConditions: undefined,
    });
  });

  it('falha ao salvar avisa e fica na tela', async () => {
    mockSaveProfile.mockRejectedValue(new Error('token expirado'));
    const tree = await render();

    await act(async () => { botao(tree, 'Salvar alterações').props.onPress(); });

    expect(alerta).toHaveBeenCalledWith('Erro', expect.stringContaining('token expirado'));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('a barra de topo volta sem salvar', async () => {
    const tree = await render();
    const topBar = tree.root.findAll((n) => typeof n.props?.onBack === 'function')[0];

    await act(async () => { topBar.props.onBack(); });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
});

describe('Dados de saúde: histórico de exames', () => {
  it('lista os exames reais do backend', async () => {
    mockListExams.mockResolvedValue([exame({ name: 'Audiometria', date: '2027-03-05' })]);
    const tree = await render();

    const card = tree.root.findAll((n) => n.props?.examName === 'Audiometria')[0];
    expect(card.props).toMatchObject({ year: '2027', date: '05 Mar' });
  });

  it('sem exames diz isso, em vez de mostrar exames de exemplo', async () => {
    const tree = await render();
    expect(textos(tree)).toContain('Nenhum exame enviado.');
  });

  // Quem veio editar tipo sanguíneo não pode levar um alerta de rede na cara.
  it('falha ao listar exames não alerta nada', async () => {
    mockListExams.mockRejectedValue(new Error('rede'));
    const tree = await render();

    expect(alerta).not.toHaveBeenCalled();
    expect(textos(tree)).toContain('Nenhum exame enviado.');
  });

  // A URL vem do JSON da API e ia direto pro navegador do aparelho. Agora passa
  // por resolveTrustedMediaUrl, que só libera a origem da própria API ou uma de
  // EXPO_PUBLIC_MEDIA_ORIGINS. Sob a suíte a API é http://localhost:3000.
  it('baixar o exame abre a url do arquivo', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const url = 'http://localhost:3000/media/e1.pdf';
    mockListExams.mockResolvedValue([exame({ fileUrl: url })]);
    const tree = await render();

    await act(async () => {
      tree.root.findAll((n) => n.props?.examName === 'Audiometria')[0].props.onActionPress();
    });

    expect(abrir).toHaveBeenCalledWith(url);
    abrir.mockRestore();
  });

  // Um registro adulterado no banco, ou uma resposta forjada, faria o app abrir
  // o endereço de quem atacou. Recusar calado seria quase tão ruim: o usuário
  // tocaria no card e nada aconteceria, sem explicação.
  it('exame de origem não autorizada não abre, e o usuário fica sabendo', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockListExams.mockResolvedValue([exame({ fileUrl: 'https://invasor.test/e1.pdf' })]);
    const tree = await render();

    await act(async () => {
      tree.root.findAll((n) => n.props?.examName === 'Audiometria')[0].props.onActionPress();
    });

    expect(abrir).not.toHaveBeenCalled();
    expect(alerta).toHaveBeenCalled();
    abrir.mockRestore();
  });
});

describe('Dados de saúde: enviar exame', () => {
  const preencherExame = async (tree: ReturnType<typeof create>) => {
    await digitar(tree, 'Nome do exame', 'Exame de reciclagem técnica');
    await digitar(tree, 'Validade', '05032027');
  };

  it('a validade é mascarada enquanto digita', async () => {
    const tree = await render();
    await digitar(tree, 'Validade', '05032027');

    expect(valorDe(tree, 'Validade')).toBe('05/03/2027');
  });

  // Nome e validade primeiro: sem eles o card do histórico não desenha nada.
  it('sem nome e validade não abre o seletor de arquivo', async () => {
    const tree = await render();
    await anexar(tree);

    expect(mockPickDocument).not.toHaveBeenCalled();
    expect(mockCreateExam).not.toHaveBeenCalled();
  });

  it('sem nome e validade os dois campos passam a acusar o erro', async () => {
    const tree = await render();
    await anexar(tree);

    expect(campo(tree, 'Nome do exame').props.descriptionVariant).toBe('error');
    expect(campo(tree, 'Validade').props.descriptionVariant).toBe('error');
  });

  it('validade impossível também barra o envio', async () => {
    const tree = await render();
    await digitar(tree, 'Nome do exame', 'Audiometria');
    await digitar(tree, 'Validade', '31022027'); // 31 de fevereiro
    await anexar(tree);

    expect(mockPickDocument).not.toHaveBeenCalled();
  });

  it('com os campos válidos manda nome, data de calendário e arquivo', async () => {
    const tree = await render();
    await preencherExame(tree);
    await anexar(tree);

    expect(mockCreateExam).toHaveBeenCalledWith({
      name: 'Exame de reciclagem técnica',
      date: '2027-03-05', // dd/mm/aaaa da tela → AAAA-MM-DD da API
      fileUri: 'file:///tmp/laudo.pdf',
    });
  });

  it('o exame enviado entra no topo da lista e limpa os campos', async () => {
    mockListExams.mockResolvedValue([exame({ id: 'antigo', name: 'Audiometria' })]);
    mockCreateExam.mockResolvedValue(exame({ id: 'novo', name: 'Espirometria' }));
    const tree = await render();
    await preencherExame(tree);
    await anexar(tree);

    const nomes = tree.root
      .findAll((n) => typeof n.props?.examName === 'string')
      .map((n) => n.props.examName as string);
    expect(nomes.indexOf('Espirometria')).toBeLessThan(nomes.indexOf('Audiometria'));
    expect(valorDe(tree, 'Nome do exame')).toBe('');
    expect(valorDe(tree, 'Validade')).toBe('');
  });

  // Cancelar o seletor de arquivo é escolha da pessoa, não erro.
  it('cancelar o seletor não cria exame nem alerta', async () => {
    mockPickDocument.mockResolvedValue(null);
    const tree = await render();
    await preencherExame(tree);
    await anexar(tree);

    expect(mockCreateExam).not.toHaveBeenCalled();
    expect(alerta).not.toHaveBeenCalled();
  });

  it('falha no envio avisa e mantém o que foi digitado', async () => {
    mockCreateExam.mockRejectedValue(new Error('arquivo muito grande'));
    const tree = await render();
    await preencherExame(tree);
    await anexar(tree);

    expect(alerta).toHaveBeenCalledWith('Erro', expect.stringContaining('arquivo muito grande'));
    expect(valorDe(tree, 'Nome do exame')).toBe('Exame de reciclagem técnica');
  });

  it('durante o envio o botão avisa que está enviando', async () => {
    let liberar!: (e: Exam) => void;
    mockCreateExam.mockImplementation(() => new Promise<Exam>((res) => { liberar = res; }));
    const tree = await render();
    await preencherExame(tree);

    // Não aguarda: o envio fica em voo de propósito.
    let emVoo!: Promise<void>;
    await act(async () => { emVoo = uploader(tree).props.onPickFile(); });
    expect(uploader(tree).props.pickFileLabel).toBe('Enviando…');

    await act(async () => { liberar(exame()); await emVoo; });
    expect(uploader(tree).props.pickFileLabel).toBe('Enviar novo exame');
  });
});
