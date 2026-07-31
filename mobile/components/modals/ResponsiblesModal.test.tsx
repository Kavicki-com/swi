import { act, create } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { ResponsiblesModal, responsiblesSelection } from './ResponsiblesModal';
import { listReportAssignees } from '../../services/reports/assignees';

jest.mock('../../services/reports/assignees', () => ({ listReportAssignees: jest.fn() }));

const mockListAssignees = listReportAssignees as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CONTATOS = [
  { workerId: 'w1', name: 'Jennifer Gomes', sector: 'Operações', role: 'Operadora', avatarUri: '', bloodType: 'O-', birthDate: '1990-12-25T00:00:00.000Z' },
  { workerId: 'w2', name: 'Carlos Santos', sector: 'Manutenção', role: 'Técnico', avatarUri: '', bloodType: 'A+', birthDate: null },
];

const render = async (onConfirm?: (picks: Array<{ id: string; name: string }>) => void) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      // SafeAreaProvider com métricas iniciais: o modal usa useSafeAreaInsets
      // e sem elas o RN não tem o que devolver fora de um device.
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ResponsiblesModal onClose={() => {}} onConfirm={onConfirm} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

describe('ResponsiblesModal', () => {
  beforeEach(() => {
    responsiblesSelection.clear();
    // mockClear: o mock agora é de MÓDULO (antes era um jest.fn() novo por
    // teste), então a contagem de chamadas vazaria entre os casos.
    mockListAssignees.mockClear();
    mockListAssignees.mockResolvedValue(CONTATOS);
  });

  // A regressão que motivou o teste: o modal usava useChat(), mas o
  // ChatProvider só envolve a subárvore de CHAT — montar isto a partir de
  // relatórios lançava "useChat must be used inside ChatProvider" e derrubava
  // a tela (review 2026-07-27). Renderizar SEM provider de chat é o guarda.
  it('monta fora da subárvore de chat, sem ChatProvider', async () => {
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).toContain('Jennifer Gomes');
  });

  // Não é o diretório de CHAT: aquele devolve a empresa inteira de propósito
  // (os admins entram pra o worker conseguir falar com o painel), e por isso o
  // seletor oferecia os 10 operadores como revisores no aparelho (QA
  // 2026-07-27). A régua de quem revisa vive no backend, em /reports/assignees.
  it('busca a lista de responsáveis, não o diretório de chat', async () => {
    await render();
    expect(mockListAssignees).toHaveBeenCalledTimes(1);
  });

  it('lista indisponível não derruba a tela — só fica sem ninguém pra atribuir', async () => {
    mockListAssignees.mockRejectedValue(new Error('rede caiu'));
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).toContain('Selecionar responsáveis');
  });
});

// QA Mobile #5: "a lista aparece cortada atrás dos botões Cancelar/Continuar
// (só 'Admin' aparece parcialmente)". Reproduzido nos dois extremos: com lista
// curta ela virava uma fatia e o card ficava atrás dos botões; com lista longa
// o sheet estourava a tela e o cabeçalho saía por cima do viewport.
//
// Estes testes guardam as REGRAS de layout, não os pixels: o jest não tem motor
// de layout, medir altura aqui é impossível. O resultado renderizado foi
// conferido no navegador com 1 e com 15 pessoas. O valor deles é impedir que
// alguém desfaça uma das três regras sem perceber.
describe('ResponsiblesModal, layout do bottom-sheet', () => {
  beforeEach(() => {
    responsiblesSelection.clear();
    mockListAssignees.mockClear();
    mockListAssignees.mockResolvedValue(CONTATOS);
  });

  const estiloDe = (tree: ReturnType<typeof create>, testID: string) => {
    const node = tree.root.findAll((n) => n.props?.testID === testID)[0];
    return StyleSheet.flatten(node.props.style) as Record<string, unknown>;
  };

  // Percentual só resolve contra pai de altura definida. O pai aqui é o
  // KeyboardStickyView, que se dimensiona pelo conteúdo, então '85%' não
  // resolvia e o sheet crescia sem teto. Em pixels o teto sempre vale.
  it('o teto de altura do sheet é numérico, não percentual', async () => {
    const tree = await render();
    expect(typeof estiloDe(tree, 'responsibles-sheet').maxHeight).toBe('number');
  });

  // A lista é a única parte elástica: é ela que cede espaço quando não cabe
  // tudo. Sem poder encolher, empurrava os botões pra fora do sheet.
  it('a lista encolhe quando falta espaço', async () => {
    const tree = await render();
    expect(estiloDe(tree, 'responsibles-list').flexShrink).toBe(1);
  });

  // O oposto do anterior: cabeçalho e botões nunca cedem espaço.
  it('cabeçalho e botões não encolhem', async () => {
    const tree = await render();
    expect(estiloDe(tree, 'responsibles-header').flexShrink).toBe(0);
    expect(estiloDe(tree, 'responsibles-actions').flexShrink).toBe(0);
  });
});

describe('responsiblesSelection', () => {
  // Guarda id E NOME: com só o id, quem exibe precisaria do diretório — que é
  // exatamente a dependência que derrubava a tela de novo relatório.
  it('carrega o nome junto do id', () => {
    responsiblesSelection.set([{ id: 'w1', name: 'Jennifer Gomes' }]);
    expect(responsiblesSelection.get()).toEqual([{ id: 'w1', name: 'Jennifer Gomes' }]);
  });

  it('devolve cópia — mutar o retorno não altera a seleção guardada', () => {
    responsiblesSelection.set([{ id: 'w1', name: 'Jennifer Gomes' }]);
    responsiblesSelection.get().push({ id: 'x', name: 'Intruso' });
    expect(responsiblesSelection.get()).toHaveLength(1);
  });

  it('clear zera (cancelar o relatório não pode vazar pro próximo)', () => {
    responsiblesSelection.set([{ id: 'w1', name: 'Jennifer Gomes' }]);
    responsiblesSelection.clear();
    expect(responsiblesSelection.get()).toEqual([]);
  });
});
