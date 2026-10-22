import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SearchInput, SwiThemeProvider } from '@kavicki/swi-design-system';
import ReportDetails from '../../../../app/(app)/reports/[id]';
import type { Report, ReportComment } from '../../../../services/reports/types';

// Os dois controles do topo do detalhe que não faziam nada:
// - "Revisar relatório" abre o formulário do relatório já preenchido (a tela
//   de Novo relatório com o id), e a volta mostra o relatório relido;
// - a busca filtra os comentários pelo texto, sem acento e sem maiúsculas.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../../../lib/media/trustedMediaUrl', () => ({
  abrirAnexoOuAvisar: jest.fn(),
}));

const comentario = (id: string, body: string): ReportComment => ({
  id,
  body,
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  createdAt: '13/04/2026',
});

const relatorio = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  title: 'Inspeção das máquinas',
  summary: 'Checklist preventivo.',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ana Souza'],
  details: 'Inspeção realizada.',
  images: [],
  attachments: [],
  activities: [],
  comments: [
    comentario('c1', 'Válvula trocada na manutenção.'),
    comentario('c2', 'Conferido em campo.'),
    comentario('c3', 'Falta a VALVULA reserva.'),
  ],
  ...over,
});

// Estado do provider dublado, estável entre renders (o detalhe relê quando
// `loadOne` ou `revision` mudam).
const mockReports = {
  loadOne: jest.fn(async (): Promise<Report | null> => relatorio()),
  addComment: jest.fn(),
  commentsFor: () => ({ sent: [] as ReportComment[], pending: [] as ReportComment[] }),
  revision: 0,
};
jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: () => mockReports,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const arvore = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <SwiThemeProvider>
      <ReportDetails />
    </SwiThemeProvider>
  </SafeAreaProvider>
);

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(arvore());
  });
  return tree;
};

const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

const buscar = (tree: ReactTestRenderer, texto: string) =>
  act(() => tree.root.findByType(SearchInput).props.onChangeText(texto));

beforeEach(() => {
  mockPush.mockClear();
  mockReports.loadOne.mockClear();
  mockReports.loadOne.mockImplementation(async () => relatorio());
  mockReports.revision = 0;
});

describe('Detalhe do relatório: Revisar relatório', () => {
  it('abre o formulário do relatório pelo id', async () => {
    const tree = await montar();
    const revisar = tree.root.findAll(
      (n) => n.props?.label === 'Revisar relatório' && typeof n.props?.onPress === 'function',
    )[0];

    act(() => revisar.props.onPress());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/reports/new',
      params: { id: 'r1' },
    });
  });

  it('salva a edição, o detalhe relê o relatório e mostra o novo', async () => {
    const tree = await montar();
    expect(mockReports.loadOne).toHaveBeenCalledTimes(1);

    mockReports.loadOne.mockImplementation(async () => relatorio({ title: 'Inspeção revisada' }));
    mockReports.revision = 1;
    await act(async () => {
      tree.update(arvore());
    });

    expect(mockReports.loadOne).toHaveBeenCalledTimes(2);
    expect(textos(tree)).toContain('Inspeção revisada');
  });
});

describe('Detalhe do relatório: busca nos comentários', () => {
  it('filtra os comentários pelo texto, sem acento e sem maiúsculas', async () => {
    const tree = await montar();

    buscar(tree, 'valvula');

    const t = textos(tree);
    expect(t).toContain('Válvula trocada na manutenção.');
    expect(t).toContain('Falta a VALVULA reserva.');
    expect(t).not.toContain('Conferido em campo.');
  });

  it('busca vazia mostra todos os comentários', async () => {
    const tree = await montar();

    buscar(tree, 'valvula');
    buscar(tree, '  ');

    const t = textos(tree);
    expect(t).toContain('Válvula trocada na manutenção.');
    expect(t).toContain('Conferido em campo.');
    expect(t).toContain('Falta a VALVULA reserva.');
  });

  it('a busca alcança os meus comentários que aguardam envio', async () => {
    const pendente = { ...comentario('p1', 'Válvula de reserva pedida.'), createdAt: 'Aguardando envio' };
    const commentsFor = mockReports.commentsFor;
    mockReports.commentsFor = () => ({ sent: [], pending: [pendente] });
    try {
      const tree = await montar();

      buscar(tree, 'reserva');

      const t = textos(tree);
      expect(t).toContain('Válvula de reserva pedida.');
      expect(t).toContain('Falta a VALVULA reserva.');
      expect(t).not.toContain('Válvula trocada na manutenção.');
    } finally {
      mockReports.commentsFor = commentsFor;
    }
  });

  it('a busca não esconde o resto do relatório nem o campo de comentar', async () => {
    const tree = await montar();

    buscar(tree, 'nada disso existe');

    expect(textos(tree)).toContain('Inspeção realizada.');
    expect(
      tree.root.findAll((n) => n.props?.label === 'Adicionar comentário').length,
    ).toBeGreaterThan(0);
  });
});
