import { act, create } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pagination, SwiThemeProvider } from '@kavicki/swi-design-system';
import Reports from '../../../../app/(app)/reports/index';
import { useReports } from '../../../../services/reports/ReportsProvider';
import type { Report } from '../../../../services/reports/types';

// QA Mobile #8: a lista vivia numa janela de altura fixa (maxHeight 540,
// calibrada em maio pro frame de 800dp do Figma) e a Pagination morava DENTRO
// do scroll — com poucos relatórios ela afundava junto e sobrava um vão de
// ~25% da tela até os FABs. Estes testes travam a estrutura da correção:
// lista elástica, paginação como irmã do scroll e rodapé que fecha a tela
// acima dos FABs.

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

const render = async () => {
  (useReports as jest.Mock).mockReturnValue({
    reports: [relatorio('r1', 'Socorro'), relatorio('r2', 'teste novo relatorio')],
    status: 'ready',
    load: jest.fn(),
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
