import { act, create } from 'react-test-renderer';
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
