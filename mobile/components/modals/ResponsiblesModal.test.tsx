import { act, create, type ReactTestInstance } from 'react-test-renderer';
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

const render = async (
  onConfirm?: (picks: { id: string; name: string }[]) => void,
  // Fechar é metade do contrato do sheet (Cancelar fecha; Continuar devolve E
  // fecha), então quem testa isso precisa enxergar a chamada.
  onClose: () => void = () => {},
) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      // SafeAreaProvider com métricas iniciais: o modal usa useSafeAreaInsets
      // e sem elas o RN não tem o que devolver fora de um device.
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ResponsiblesModal onClose={onClose} onConfirm={onConfirm} />
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
  // ChatProvider só envolve a subárvore de CHAT, montar isto a partir de
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

  it('lista indisponível não derruba a tela, só fica sem ninguém pra atribuir', async () => {
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
  // Guarda id E NOME: com só o id, quem exibe precisaria do diretório, que é
  // exatamente a dependência que derrubava a tela de novo relatório.
  it('carrega o nome junto do id', () => {
    responsiblesSelection.set([{ id: 'w1', name: 'Jennifer Gomes' }]);
    expect(responsiblesSelection.get()).toEqual([{ id: 'w1', name: 'Jennifer Gomes' }]);
  });

  it('devolve cópia, mutar o retorno não altera a seleção guardada', () => {
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

// ---------------------------------------------------------------------------
// Até aqui a suíte montava o sheet e conferia regras de layout. Ninguém tocava
// num card, digitava na busca ou apertava Continuar, que é o trabalho inteiro
// do componente: escolher quem revisa e devolver a escolha pro caller.
// ---------------------------------------------------------------------------

const preparar = () => {
  responsiblesSelection.clear();
  mockListAssignees.mockClear();
  mockListAssignees.mockResolvedValue(CONTATOS);
};

// O card de cada pessoa é um Pressable com role de checkbox, e o Checkbox da
// direita usa o mesmo role. O que separa os dois é o rótulo: o do Checkbox
// começa com "Selecionar ".
const listados = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll(
      (n) => n.props?.accessibilityRole === 'checkbox' && typeof n.props?.onPress === 'function',
    )
    .map((n) => String(n.props.accessibilityLabel))
    .filter((rotulo) => !rotulo.startsWith('Selecionar '));

const cardDe = (tree: ReturnType<typeof create>, nome: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === nome && typeof n.props?.onPress === 'function',
  )[0];

const marcado = (tree: ReturnType<typeof create>, nome: string) =>
  cardDe(tree, nome).props.accessibilityState.checked as boolean;

const botao = (tree: ReturnType<typeof create>, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (no: ReactTestInstance) => {
  await act(async () => {
    no.props.onPress();
  });
};

const buscar = async (tree: ReturnType<typeof create>, texto: string) => {
  const campo = tree.root.findAll((n) => typeof n.props?.onChangeText === 'function')[0];
  await act(async () => {
    campo.props.onChangeText(texto);
  });
};

describe('ResponsiblesModal, escolher quem revisa', () => {
  beforeEach(preparar);

  it('tocar no card marca a pessoa', async () => {
    const tree = await render();
    expect(marcado(tree, 'Jennifer Gomes')).toBe(false);

    await tocar(cardDe(tree, 'Jennifer Gomes'));

    expect(marcado(tree, 'Jennifer Gomes')).toBe(true);
  });

  it('tocar de novo no mesmo card desmarca', async () => {
    const tree = await render();
    await tocar(cardDe(tree, 'Jennifer Gomes'));
    await tocar(cardDe(tree, 'Jennifer Gomes'));

    expect(marcado(tree, 'Jennifer Gomes')).toBe(false);
  });

  // Discriminante: se a seleção fosse um booleano em vez de um conjunto de
  // ids, marcar a segunda pessoa desmarcaria a primeira.
  it('mais de uma pessoa pode ficar marcada ao mesmo tempo', async () => {
    const tree = await render();
    await tocar(cardDe(tree, 'Jennifer Gomes'));
    await tocar(cardDe(tree, 'Carlos Santos'));

    expect(marcado(tree, 'Jennifer Gomes')).toBe(true);
    expect(marcado(tree, 'Carlos Santos')).toBe(true);
  });

  // O quadradinho tem handler próprio: quem mira nele não pode ficar sem
  // resposta só porque não acertou o card inteiro.
  it('o checkbox marca sem precisar acertar o card inteiro', async () => {
    const tree = await render();
    const check = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === 'Selecionar Carlos Santos' &&
        typeof n.props?.onChange === 'function',
    )[0];

    await act(async () => {
      check.props.onChange();
    });

    expect(marcado(tree, 'Carlos Santos')).toBe(true);
  });
});

describe('ResponsiblesModal, busca', () => {
  beforeEach(preparar);

  // O SearchInput existia mas não filtrava nada: digitar não mudava a lista.
  it('digitar filtra a lista pelo nome', async () => {
    const tree = await render();
    expect(listados(tree)).toEqual(['Jennifer Gomes', 'Carlos Santos']);

    await buscar(tree, 'Carlos');

    expect(listados(tree)).toEqual(['Carlos Santos']);
  });

  it('a busca não liga pra caixa alta', async () => {
    const tree = await render();
    await buscar(tree, 'jEnNiFeR');

    expect(listados(tree)).toEqual(['Jennifer Gomes']);
  });

  // Discriminante do trim: encostar na barra de espaço não pode esvaziar a
  // lista, e sem o trim o termo " " não casaria com nome nenhum.
  it('só espaços não filtram nada', async () => {
    const tree = await render();
    await buscar(tree, '   ');

    expect(listados(tree)).toHaveLength(2);
  });

  it('busca sem resultado esvazia a lista sem derrubar o sheet', async () => {
    const tree = await render();
    await buscar(tree, 'zzz');

    expect(listados(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Selecionar responsáveis');
  });
});

describe('ResponsiblesModal, confirmar', () => {
  beforeEach(preparar);

  // Devolve id E nome: o backend de relatórios guarda NOMES, e devolver só o
  // id obrigaria a tela de novo relatório a consultar o diretório, que é
  // exatamente a dependência que a derrubava na montagem.
  it('Continuar devolve id e nome de quem foi marcado', async () => {
    const onConfirm = jest.fn();
    const tree = await render(onConfirm);

    await tocar(cardDe(tree, 'Carlos Santos'));
    await tocar(botao(tree, 'Continuar'));

    expect(onConfirm).toHaveBeenCalledWith([{ id: 'w2', name: 'Carlos Santos' }]);
  });

  it('Continuar sem ninguém marcado devolve lista vazia', async () => {
    const onConfirm = jest.fn();
    const tree = await render(onConfirm);

    await tocar(botao(tree, 'Continuar'));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('Continuar fecha o sheet depois de devolver', async () => {
    const onClose = jest.fn();
    const tree = await render(jest.fn(), onClose);

    await tocar(botao(tree, 'Continuar'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // onConfirm é opcional na interface: sem o `?.` o Continuar explodiria em
  // qualquer caller que só queira fechar.
  it('Continuar sem onConfirm fecha assim mesmo, sem explodir', async () => {
    const onClose = jest.fn();
    const tree = await render(undefined, onClose);

    await tocar(botao(tree, 'Continuar'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar fecha sem devolver seleção nenhuma', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const tree = await render(onConfirm, onClose);

    await tocar(cardDe(tree, 'Jennifer Gomes'));
    await tocar(botao(tree, 'Cancelar'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ResponsiblesModal, ficha de cada card', () => {
  beforeEach(preparar);

  // O componente usa o travessão (U+2014) como "não informado". Ele é montado
  // por código por causa da regra de escrita do projeto: o caractere não entra
  // no fonte, mas a asserção compara com ele de verdade.
  const TRACO = String.fromCharCode(0x2014);

  it('sem tipo sanguíneo cadastrado, o card mostra o traço em vez de inventar um', async () => {
    const comTipo = await render();
    expect(JSON.stringify(comTipo.toJSON())).not.toContain(TRACO);

    mockListAssignees.mockResolvedValue([{ ...CONTATOS[0], bloodType: null }]);
    const semTipo = await render();
    expect(JSON.stringify(semTipo.toJSON())).toContain(TRACO);
  });

  // A idade sai do birthDate: o card exibia "26 anos" cravado pra qualquer
  // pessoa que o usuário abrisse (QA 2026-07-26). A data de teste é derivada
  // de hoje pra asserção não envelhecer, sem repetir a conta do ageFrom.
  it('a idade vem da data de nascimento; sem data, o card diz que não sabe', async () => {
    const hoje = new Date();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    mockListAssignees.mockResolvedValue([
      { ...CONTATOS[0], birthDate: `${hoje.getFullYear() - 30}-${mes}-${dia}T00:00:00.000Z` },
      CONTATOS[1],
    ]);

    const tree = await render();

    const texto = JSON.stringify(tree.toJSON());
    expect(texto).toContain('30 anos');
    expect(texto).toContain('Idade não informada');
  });
});

describe('ResponsiblesModal, ciclo de vida', () => {
  beforeEach(preparar);

  // O efeito guarda um `cancelled` e o cleanup o liga. Vale registrar o limite
  // deste teste: o React 18 não avisa mais sobre setState depois do desmonte,
  // então o que dá pra afirmar aqui é que a lista chegando tarde é inofensiva,
  // não que o guarda foi consultado.
  it('a lista chegando depois do sheet fechado não quebra nada', async () => {
    let entregar!: (lista: typeof CONTATOS) => void;
    mockListAssignees.mockReturnValue(
      new Promise((resolve) => {
        entregar = resolve;
      }),
    );

    const tree = await render();
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      entregar(CONTATOS);
    });

    expect(tree.toJSON()).toBeNull();
  });
});
