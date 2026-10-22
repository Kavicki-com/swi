import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast } from '@kavicki/swi-design-system';
import NovoRelatorio from '../../../../app/(app)/reports/new';
import { useMediaPicker } from '../../../../lib/media/useMediaPicker';
import { useReports } from '../../../../services/reports/ReportsProvider';
import { responsiblesSelection } from '../../../../components/modals/ResponsiblesModal';
import type { Report, ReportAttachment } from '../../../../services/reports/types';

// "Revisar relatório" abre esta mesma tela com o id do relatório: o formulário
// vem preenchido com o relatório atual (título, resumo, detalhes, responsáveis
// e anexos) e salvar edita pelo PATCH, em vez de criar outro relatório.

jest.mock('../../../../lib/media/useMediaPicker', () => ({ useMediaPicker: jest.fn() }));
jest.mock('../../../../services/reports/ReportsProvider', () => ({ useReports: jest.fn() }));
jest.mock('../../../../lib/media/localFileSize', () => ({ localFileSize: () => 3 * 1024 }));
jest.mock('../../../../lib/media/pickDocument', () => ({ pickReportDocument: jest.fn() }));
const mockBack = jest.fn();
let mockParams: { id?: string } = { id: 'r1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: jest.fn(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const anexo = (n: number, kind: ReportAttachment['kind'], ext: string): ReportAttachment => ({
  key: `reports/0000000${n}-0000-0000-0000-000000000000.${ext}`,
  url: `https://signed.example.test/${n}.${ext}`,
  contentType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
  kind,
});
const FOTO = anexo(1, 'image', 'jpg');
const LAUDO = anexo(2, 'document', 'pdf');

const relatorio = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  title: 'Inspeção das máquinas',
  summary: 'Checklist preventivo',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ana Souza', 'Bruno Lima'],
  details: 'Tudo conferido.',
  images: [FOTO.url],
  attachments: [FOTO, LAUDO],
  activities: [],
  comments: [],
  ...over,
});

let carregar: jest.Mock;
let editar: jest.Mock;
let criar: jest.Mock;
let showPicker: jest.Mock;

beforeEach(() => {
  mockParams = { id: 'r1' };
  mockBack.mockClear();
  responsiblesSelection.clear();
  carregar = jest.fn(async () => relatorio());
  editar = jest.fn(async () => relatorio());
  criar = jest.fn(async () => 'queued');
  showPicker = jest.fn(async () => null);
  (useMediaPicker as jest.Mock).mockReturnValue({ showPicker, pickFromGallery: jest.fn() });
  (useReports as jest.Mock).mockReturnValue({ create: criar, update: editar, loadOne: carregar });
});

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <NovoRelatorio />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const campo = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];
const porRotulo = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === rotulo);
// Em edição o botão é "Salvar alterações"; ao criar, "Salvar relatório".
const salvar = async (tree: ReactTestRenderer, rotulo = 'Salvar alterações') => {
  await act(async () => {
    await porRotulo(tree, rotulo)[0].props.onPress();
  });
};
const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

describe('Revisar relatório: textos da edição', () => {
  it('o título da tela é Revisar relatório e o botão é Salvar alterações', async () => {
    const tree = await montar();

    expect(textos(tree)).toContain('Revisar relatório');
    expect(textos(tree)).not.toContain('Novo relatório');
    expect(porRotulo(tree, 'Salvar alterações').length).toBeGreaterThan(0);
    expect(porRotulo(tree, 'Salvar relatório')).toHaveLength(0);
  });

  it('ao criar, seguem Novo relatório e Salvar relatório', async () => {
    mockParams = {};
    const tree = await montar();

    expect(textos(tree)).toContain('Novo relatório');
    expect(textos(tree)).not.toContain('Revisar relatório');
    expect(porRotulo(tree, 'Salvar relatório').length).toBeGreaterThan(0);
    expect(porRotulo(tree, 'Salvar alterações')).toHaveLength(0);
  });
});

describe('Revisar relatório: formulário preenchido', () => {
  it('carrega o relatório do id e preenche título, resumo e detalhes', async () => {
    const tree = await montar();

    expect(carregar).toHaveBeenCalledWith('r1');
    expect(campo(tree, 'Título do relatório').props.value).toBe('Inspeção das máquinas');
    expect(campo(tree, 'Resumo do relatório').props.value).toBe('Checklist preventivo');
    expect(campo(tree, 'Detalhes do relatório').props.value).toBe('Tudo conferido.');
  });

  it('traz os responsáveis atuais', async () => {
    const tree = await montar();

    expect(porRotulo(tree, '2 responsáveis atribuídos').length).toBeGreaterThan(0);
  });

  it('traz os anexos atuais nos quadrados, em ordem', async () => {
    const tree = await montar();

    expect(porRotulo(tree, 'Anexo 1 (toque para trocar ou remover)').length).toBeGreaterThan(0);
    expect(porRotulo(tree, 'Anexo 2 (toque para trocar ou remover)').length).toBeGreaterThan(0);
    expect(porRotulo(tree, 'Adicionar anexo 3').length).toBeGreaterThan(0);
    expect(
      tree.root.findAll((n) => n.props?.source?.uri === FOTO.url).length,
    ).toBeGreaterThan(0);
  });

  it('relatório que não existe mais não abre o formulário', async () => {
    carregar.mockResolvedValue(null);
    const tree = await montar();

    expect(campo(tree, 'Título do relatório')).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).toContain('Relatório não encontrado');
  });
});

describe('Revisar relatório: salvar', () => {
  it('salva pela edição com o que mudou e os anexos que ficaram, sem criar outro relatório', async () => {
    const tree = await montar();

    await act(async () => {
      campo(tree, 'Título do relatório').props.onChangeText('Inspeção revisada');
    });
    await salvar(tree);

    expect(criar).not.toHaveBeenCalled();
    expect(editar).toHaveBeenCalledWith('r1', {
      title: 'Inspeção revisada',
      summary: 'Checklist preventivo',
      details: 'Tudo conferido.',
      responsibles: ['Ana Souza', 'Bruno Lima'],
      attachments: [
        { key: FOTO.key, uri: FOTO.url },
        { key: LAUDO.key, uri: LAUDO.url },
      ],
      baseKeys: [FOTO.key, LAUDO.key],
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('anexo removido no quadrado sai da lista que fica, mas segue na que foi carregada', async () => {
    showPicker.mockImplementation(async (opts: { onRemove?: () => void }) => {
      opts.onRemove?.();
      return null;
    });
    const tree = await montar();

    await act(async () => {
      await porRotulo(tree, 'Anexo 2 (toque para trocar ou remover)')[0].props.onPress();
    });
    await salvar(tree);

    const [, enviado] = editar.mock.calls[0];
    expect(enviado.attachments).toEqual([{ key: FOTO.key, uri: FOTO.url }]);
    expect(enviado.baseKeys).toEqual([FOTO.key, LAUDO.key]);
  });

  it('com mais anexos que quadrados, só os mostrados entram como carregados', async () => {
    const cinco = [1, 2, 3, 4, 5].map((n) => anexo(n, 'image', 'jpg'));
    carregar.mockResolvedValue(relatorio({ attachments: cinco, images: cinco.map((a) => a.url) }));
    const tree = await montar();

    await salvar(tree);

    const [, enviado] = editar.mock.calls[0];
    // O quinto não aparece na grade: fora da lista carregada, o servidor o
    // preserva em vez de apagar.
    expect(enviado.baseKeys).toEqual(cinco.slice(0, 4).map((a) => a.key));
    expect(enviado.attachments).toHaveLength(4);
  });

  it('falha ao salvar mostra o aviso e a tela fica aberta', async () => {
    editar.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    const tree = await montar();

    await salvar(tree);

    expect(tree.root.findAllByType(Toast)).toHaveLength(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('Novo relatório sem id continua criando', () => {
  it('sem id não carrega nada e salvar cria', async () => {
    mockParams = {};
    const tree = await montar();

    expect(carregar).not.toHaveBeenCalled();
    for (const label of ['Título do relatório', 'Resumo do relatório', 'Detalhes do relatório']) {
      await act(async () => {
        campo(tree, label).props.onChangeText('x');
      });
    }
    await salvar(tree, 'Salvar relatório');

    expect(criar).toHaveBeenCalled();
    expect(editar).not.toHaveBeenCalled();
  });
});
