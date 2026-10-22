import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pagination, ReportCard, SearchInput, SwiThemeProvider } from '@kavicki/swi-design-system';
import Reports from '../../../../app/(app)/reports/index';
import { useReports } from '../../../../services/reports/ReportsProvider';
import type { Report } from '../../../../services/reports/types';

// A busca e a paginação da lista eram controles mortos: o texto digitado não
// filtrava nada e a paginação desenhava 4 páginas fixas que não trocavam os
// cartões. O backend não busca por texto, e a lista já vem inteira numa
// leitura só; as duas coisas acontecem sobre o que a tela já carregou, como no
// painel (busca pelo título).

jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const relatorio = (id: string, title: string, over: Partial<Report> = {}): Report => ({
  id,
  title,
  summary: 'resumo sintético',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Autora Teste',
  authorAvatarUri: '',
  creationDate: '04/08/2026',
  sector: 'Gestão',
  responsibles: ['Resp 1'],
  details: 'detalhes',
  images: [],
  attachments: [],
  activities: [],
  comments: [],
  ...over,
});

const muitos = (n: number) =>
  Array.from({ length: n }, (_, i) => relatorio(`r${i + 1}`, `Relatório ${i + 1}`));

const render = async (over: Record<string, unknown> = {}) => {
  (useReports as jest.Mock).mockReturnValue({
    reports: [],
    pendingReports: [],
    status: 'ready',
    load: jest.fn(),
    ...over,
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Reports />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const titulos = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ReportCard).map((c) => c.props.title);

const buscar = (tree: ReactTestRenderer, texto: string) =>
  act(() => tree.root.findByType(SearchInput).props.onChangeText(texto));

const irParaPagina = (tree: ReactTestRenderer, n: number) =>
  act(() => tree.root.findByType(Pagination).props.onPageChange(n));

beforeEach(() => mockPush.mockClear());

describe('Reports (lista): busca', () => {
  it('filtra os cartões pelo título, sem diferença de maiúsculas', async () => {
    const tree = await render({
      reports: [
        relatorio('r1', 'Inspeção das Máquinas'),
        relatorio('r2', 'Eficiência energética'),
        relatorio('r3', 'Nova inspeção de solda'),
      ],
    });

    buscar(tree, 'INSPEÇÃO');

    expect(titulos(tree)).toEqual(['Inspeção das Máquinas', 'Nova inspeção de solda']);
  });

  it('ignora os espaços nas pontas do texto buscado', async () => {
    const tree = await render({
      reports: [relatorio('r1', 'Socorro'), relatorio('r2', 'Vazamento')],
    });

    buscar(tree, '  socorro ');

    expect(titulos(tree)).toEqual(['Socorro']);
  });

  it('a busca também alcança os relatórios que aguardam envio', async () => {
    const tree = await render({
      reports: [relatorio('r1', 'Socorro')],
      pendingReports: [
        relatorio('p1', 'Vazamento sem sinal', { statusLabel: 'Aguardando envio' }),
      ],
    });

    buscar(tree, 'vazamento');

    expect(titulos(tree)).toEqual(['Vazamento sem sinal']);
  });

  it('apagar a busca devolve a lista inteira', async () => {
    const tree = await render({
      reports: [relatorio('r1', 'Socorro'), relatorio('r2', 'Vazamento')],
    });

    buscar(tree, 'socorro');
    buscar(tree, '');

    expect(titulos(tree)).toEqual(['Socorro', 'Vazamento']);
  });
});

describe('Reports (lista): paginação', () => {
  it('mostra 10 cartões por página e conta as páginas pelo total', async () => {
    const tree = await render({ reports: muitos(25) });

    expect(titulos(tree)).toHaveLength(10);
    expect(titulos(tree)[0]).toBe('Relatório 1');
    expect(tree.root.findByType(Pagination).props.pageCount).toBe(3);
    expect(tree.root.findByType(Pagination).props.currentPage).toBe(1);
  });

  it('trocar de página troca os cartões', async () => {
    const tree = await render({ reports: muitos(25) });

    irParaPagina(tree, 3);

    expect(titulos(tree)).toEqual([
      'Relatório 21',
      'Relatório 22',
      'Relatório 23',
      'Relatório 24',
      'Relatório 25',
    ]);
    expect(tree.root.findByType(Pagination).props.currentPage).toBe(3);
  });

  it('os que aguardam envio entram na conta das páginas, à frente dos do servidor', async () => {
    const tree = await render({
      reports: muitos(10),
      pendingReports: [relatorio('p1', 'Pendente', { statusLabel: 'Aguardando envio' })],
    });

    expect(titulos(tree)[0]).toBe('Pendente');
    expect(titulos(tree)).toHaveLength(10);
    expect(tree.root.findByType(Pagination).props.pageCount).toBe(2);

    irParaPagina(tree, 2);

    expect(titulos(tree)).toEqual(['Relatório 10']);
  });

  it('buscar volta para a primeira página e recalcula o total', async () => {
    const tree = await render({ reports: muitos(25) });

    irParaPagina(tree, 3);
    buscar(tree, 'Relatório 2');

    // "Relatório 2" e "Relatório 20" a "Relatório 25": 7 resultados, 1 página.
    expect(tree.root.findByType(Pagination).props.currentPage).toBe(1);
    expect(tree.root.findByType(Pagination).props.pageCount).toBe(1);
    expect(titulos(tree)).toHaveLength(7);
  });
});

describe('Reports (lista): estado vazio', () => {
  const comRotulo = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function');

  it('sem relatório nenhum, oferece o Novo relatório', async () => {
    const tree = await render({ reports: [], status: 'empty' });

    const botao = comRotulo(tree, 'Novo relatório')[0];
    expect(botao).toBeDefined();

    act(() => botao.props.onPress());

    expect(mockPush).toHaveBeenCalledWith('/(app)/reports/new');
  });
});
