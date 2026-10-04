import { act, create } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pagination, ReportCard, SwiThemeProvider } from '@kavicki/swi-design-system';
import Reports from '../../../../app/(app)/reports/index';
import { useReports } from '../../../../services/reports/ReportsProvider';
import type { Report } from '../../../../services/reports/types';

// Estes testes travam a estrutura da lista: elástica, paginação como irmã do
// scroll e rodapé que fecha a tela acima dos FABs. Uma janela de altura fixa
// somada à paginação DENTRO do scroll faz a paginação afundar junto quando há
// poucos relatórios, e sobra um vão de cerca de 25% da tela até os FABs.

jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const relatorio = (id: string, title: string): Report => ({
  id,
  title,
  summary: 'resumo sintético',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Autora Teste',
  authorAvatarUri: 'https://example.test/avatar.png',
  creationDate: '04/08/2026',
  sector: 'Gestão',
  responsibles: ['Resp 1'],
  details: 'detalhes',
  images: [],
  activities: [],
  comments: [],
});

const render = async (over: Record<string, unknown> = {}) => {
  (useReports as jest.Mock).mockReturnValue({
    reports: [relatorio('r1', 'Socorro'), relatorio('r2', 'teste novo relatorio')],
    pendingReports: [],
    status: 'ready',
    load: jest.fn(),
    ...over,
  });
  let tree!: ReturnType<typeof create>;
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

// O FAB do chat é o obstáculo mais alto do rodapé: bottom = insets.bottom + 71,
// altura 56 → o topo dele fica a insets.bottom + 127 da base. É o mínimo que o
// rodapé da lista precisa reservar pra paginação nunca ficar atrás dos FABs.
const TOPO_DOS_FABS = 127;

// O relatório escrito sem sinal entra na fila de envios e aparece na lista na
// hora. O Figma não desenha esse estado: o cartão é o ReportCard do DS, com o
// texto aprovado no rótulo da tag.
describe('Reports (lista): relatórios na fila de envios', () => {
  const pendente = (): Report => ({
    ...relatorio('chave-1', 'Novo sem sinal'),
    statusLabel: 'Aguardando envio',
  });

  it('o pendente aparece antes dos relatórios do servidor, com a tag de aguardando envio', async () => {
    const tree = await render({ pendingReports: [pendente()] });
    const cards = tree.root.findAllByType(ReportCard);

    expect(cards.map((c) => c.props.title)).toEqual(['Novo sem sinal', 'Socorro', 'teste novo relatorio']);
    expect(cards[0].props.status).toBe('pending');
    expect(cards[0].props.statusLabel).toBe('Aguardando envio');
  });

  // O relatório ainda não existe no servidor: não há detalhe para abrir.
  it('o cartão pendente não abre detalhe; os do servidor continuam abrindo', async () => {
    const tree = await render({ pendingReports: [pendente()] });
    const cards = tree.root.findAllByType(ReportCard);

    expect(cards[0].props.onPress).toBeUndefined();
    expect(typeof cards[1].props.onPress).toBe('function');
  });

  it('servidor sem relatório nenhum, mas com um pendente: mostra o cartão, não o vazio', async () => {
    const tree = await render({ reports: [], status: 'empty', pendingReports: [pendente()] });
    const cards = tree.root.findAllByType(ReportCard);

    expect(cards.map((c) => c.props.title)).toEqual(['Novo sem sinal']);
  });

  it('sem pendentes, a lista vazia continua mostrando o estado vazio', async () => {
    const tree = await render({ reports: [], status: 'empty' });

    expect(tree.root.findAllByType(ReportCard)).toHaveLength(0);
  });
});

describe('Reports (lista), vão do QA Mobile #8', () => {
  it('a área de cards é elástica: cresce com a tela em vez de parar num teto fixo', async () => {
    const tree = await render();

    const scroll = tree.root.findByType(ScrollView);
    const style = StyleSheet.flatten(scroll.props.style);

    expect(style.maxHeight).toBeUndefined();
    expect(style.flex).toBe(1);
  });

  it('a paginação não vive dentro do scroll: card nenhum passa por baixo dela', async () => {
    const tree = await render();

    const pagination = tree.root.findByType(Pagination);
    for (let node = pagination.parent; node; node = node.parent) {
      expect(node.type).not.toBe(ScrollView);
    }
  });

  it('o rodapé reserva o espaço dos FABs: a paginação fecha a tela sem ficar atrás deles', async () => {
    const tree = await render();

    const pagination = tree.root.findByType(Pagination);
    // O respiro é responsabilidade dos ancestrais diretos da paginação (o
    // wrapper do rodapé), não de um padding perdido em outra subárvore.
    let clearance = 0;
    for (let node = pagination.parent; node; node = node.parent) {
      const style = StyleSheet.flatten(node.props?.style) ?? {};
      clearance += Number(style.paddingBottom ?? 0) + Number(style.marginBottom ?? 0);
    }

    expect(clearance).toBeGreaterThanOrEqual(METRICS.insets.bottom + TOPO_DOS_FABS);
  });
});
