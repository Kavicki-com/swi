import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EditarRelatorio from '../../../../app/(app)/reports/edit/[id]';
import {
  ReportPermissionError,
  ReportVersionConflictError,
  type Report,
} from '../../../../services/reports/types';

// O que esta tela tem que garantir, e por quê:
//
// O relatório é o registro de segurança do trabalho e NÃO tem histórico de
// versões: salvar por cima é tão definitivo quanto excluir. Por isso o form
// carrega a versão junto com o texto e a devolve como baseVersion. Se outra
// pessoa salvou nesse meio tempo, o servidor responde 409 e a tela avisa em vez
// de sobrescrever. Nos dois casos de recusa (403 e 409) a pessoa CONTINUA no
// formulário com o que digitou: mandá-la de volta perderia o texto.

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

const mockLoadOne = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: () => ({ loadOne: mockLoadOne, update: mockUpdate }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const relatorio = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  title: 'Inspeção das máquinas pesadas',
  summary: 'Checklist de manutenção preventiva.',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ezequiel Almeida'],
  details: 'Inspeção realizada nas máquinas pesadas.',
  images: [],
  activities: [],
  comments: [],
  version: 4,
  canEdit: true,
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <EditarRelatorio />
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
  await act(async () => {
    campo(tree, label).props.onChangeText(texto);
  });
};

const salvar = async (tree: ReturnType<typeof create>) => {
  const botao = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Salvar alterações')[0];
  await act(async () => {
    await botao.props.onPress();
  });
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  mockBack.mockClear();
  mockLoadOne.mockReset().mockResolvedValue(relatorio());
  mockUpdate.mockReset().mockResolvedValue(relatorio({ version: 5 }));
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alerta.mockRestore();
});

describe('Editar relatório', () => {
  it('pré-preenche os campos com o relatório carregado', async () => {
    const tree = await render();

    expect(campo(tree, 'Título do relatório').props.value).toBe('Inspeção das máquinas pesadas');
    expect(campo(tree, 'Resumo do relatório').props.value).toBe(
      'Checklist de manutenção preventiva.',
    );
    expect(campo(tree, 'Detalhes do relatório').props.value).toBe(
      'Inspeção realizada nas máquinas pesadas.',
    );
  });

  it('salva enviando a versão que carregou como baseVersion e volta', async () => {
    const tree = await render();
    await digitar(tree, 'Título do relatório', 'Título corrigido');
    await salvar(tree);

    expect(mockUpdate).toHaveBeenCalledWith('r1', {
      title: 'Título corrigido',
      summary: 'Checklist de manutenção preventiva.',
      details: 'Inspeção realizada nas máquinas pesadas.',
      baseVersion: 4,
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('conflito de versão: avisa com opção de recarregar e NÃO volta', async () => {
    mockUpdate.mockRejectedValue(new ReportVersionConflictError());
    const tree = await render();
    await digitar(tree, 'Título do relatório', 'Título corrigido');
    await salvar(tree);

    expect(mockBack).not.toHaveBeenCalled();
    const [titulo, , botoes] = alerta.mock.calls[0];
    expect(titulo).toMatch(/conflito/i);
    expect(botoes.map((b: { text: string }) => b.text)).toContain('Recarregar');
    // O texto digitado continua na tela: quem escreveu não perde o trabalho.
    expect(campo(tree, 'Título do relatório').props.value).toBe('Título corrigido');
  });

  it('recarregar após conflito adota a versão nova e preserva o que foi digitado', async () => {
    mockUpdate.mockRejectedValueOnce(new ReportVersionConflictError());
    const tree = await render();
    await digitar(tree, 'Título do relatório', 'Título corrigido');
    await salvar(tree);

    // A pessoa escolhe recarregar; o servidor agora está na versão 9.
    mockLoadOne.mockResolvedValue(relatorio({ version: 9, title: 'Título de outra pessoa' }));
    const recarregar = alerta.mock.calls[0][2].find(
      (b: { text: string }) => b.text === 'Recarregar',
    );
    await act(async () => {
      await recarregar.onPress();
    });

    expect(campo(tree, 'Título do relatório').props.value).toBe('Título corrigido');

    mockUpdate.mockResolvedValue(relatorio({ version: 10 }));
    await salvar(tree);
    expect(mockUpdate).toHaveBeenLastCalledWith('r1', expect.objectContaining({ baseVersion: 9 }));
  });

  it('sem permissão: avisa com a mensagem do servidor e NÃO volta', async () => {
    mockUpdate.mockRejectedValue(
      new ReportPermissionError('Apenas o autor ou um administrador pode editar o relatório'),
    );
    const tree = await render();
    await digitar(tree, 'Título do relatório', 'Título corrigido');
    await salvar(tree);

    expect(mockBack).not.toHaveBeenCalled();
    expect(alerta.mock.calls[0][1]).toMatch(/Apenas o autor/);
  });

  it('título vazio não chega a chamar o servidor', async () => {
    const tree = await render();
    await digitar(tree, 'Título do relatório', '   ');
    await salvar(tree);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
