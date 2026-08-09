import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ReportDetails from '../../../../app/(app)/reports/[id]';
import type { Report, ReportComment } from '../../../../services/reports/types';

// Companheiro de detail.integration.test.tsx. La a tela roda com o provider e o
// adaptador REAIS e so o HTTP e dublado, para reproduzir o QA Mobile #9; e um
// caminho feliz. Aqui o provider e dublado e o assunto e o resto: rota sem id,
// resposta vazia, falha e retry, resposta que chega atrasada, e o envio de
// comentario inteiro.
//
// O envio de comentario e o que mais merece trava. Ate 2026-07-27 o botao era
// `onPress={() => setComment('')}`: limpava o campo e DESCARTAVA o texto, entao
// o comentario do worker nunca saia do aparelho. O teste afirma as duas metades
// do conserto: o texto sai (addComment recebe o conteudo aparado) e o campo so
// e limpo DEPOIS do sucesso, nunca antes e nunca no erro.

// --- Fronteiras dubladas -----------------------------------------------------

const mockBack = jest.fn();
const mockRouter = { back: mockBack, push: jest.fn() };
let mockId: string | undefined = 'r1';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  useRouter: () => mockRouter,
}));

const mockLoadOne = jest.fn();
const mockAddComment = jest.fn();
jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: () => ({ loadOne: mockLoadOne, addComment: mockAddComment }),
}));

// --- Dados sinteticos --------------------------------------------------------

const comentario = (over: Partial<ReportComment> = {}): ReportComment => ({
  id: 'c1',
  body: 'Confirmado em campo.',
  authorName: 'Josue Oliveira',
  authorAvatarUri: '',
  createdAt: '13/04/2026',
  ...over,
});

const relatorio = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  title: 'Inspecao das maquinas pesadas',
  summary: 'Checklist de manutencao preventiva.',
  status: 'pending',
  statusLabel: 'Em Revisao',
  authorName: 'Josue Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ezequiel Almeida'],
  details: 'Inspecao realizada nas maquinas pesadas.',
  images: [],
  activities: [],
  comments: [],
  ...over,
});

// Promessa que o teste resolve na hora que quiser: e como se observa a ordem de
// chegada das respostas.
const adiar = <T,>() => {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
};

// --- Helpers -----------------------------------------------------------------

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

const textoDa = (tree: ReactTestRenderer) => {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string' || typeof c === 'number') {
      pedacos.push(String(c));
    } else if (Array.isArray(c) && c.every((p) => typeof p === 'string' || typeof p === 'number')) {
      pedacos.push(c.join(''));
    }
  });
  return pedacos.join('\n');
};

const porLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

// O rotulo "Fazer comentario" existe DUAS vezes na tela: no botao outline da
// linha de acoes e no CTA do rodape, que ainda troca de texto para "Enviando…".
// A variante e o unico jeito estavel de apontar para o CTA.
const cta = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) => n.props?.variant === 'contained' && typeof n.props?.onPress === 'function',
  )[0];

const campoComentario = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) => n.props?.label === 'Adicionar comentário' && typeof n.props?.onChangeText === 'function',
  )[0];

const digitar = async (tree: ReactTestRenderer, texto: string) => {
  await act(async () => {
    campoComentario(tree).props.onChangeText(texto);
  });
};

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockId = 'r1';
  mockLoadOne.mockResolvedValue(relatorio());
  mockAddComment.mockResolvedValue(comentario());
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alerta.mockRestore();
});

// --- Carga -------------------------------------------------------------------

describe('Detalhe do relatorio: carga', () => {
  it('rota sem id nao chega a consultar o backend', async () => {
    mockId = undefined;

    const tree = await montar();

    expect(mockLoadOne).not.toHaveBeenCalled();
    expect(textoDa(tree)).toContain('Relatório não encontrado');
  });

  it('relatorio inexistente vira nao encontrado, nao erro', async () => {
    mockLoadOne.mockResolvedValue(null);

    const tree = await montar();

    expect(textoDa(tree)).toContain('Relatório não encontrado');
    expect(textoDa(tree)).not.toContain('Não foi possível carregar');
  });

  it('falha na consulta oferece tentar de novo', async () => {
    mockLoadOne.mockRejectedValue(new Error('rede caiu'));

    const tree = await montar();

    expect(textoDa(tree)).toContain('Não foi possível carregar');
    expect(porLabel(tree, 'Tentar novamente')).toBeDefined();
  });

  it('tentar de novo refaz a consulta e a tela se recupera', async () => {
    mockLoadOne.mockRejectedValueOnce(new Error('rede caiu'));
    const tree = await montar();

    mockLoadOne.mockResolvedValue(relatorio({ title: 'Voltou do servidor' }));
    await tocar(porLabel(tree, 'Tentar novamente'));

    expect(mockLoadOne).toHaveBeenCalledTimes(2);
    expect(textoDa(tree)).toContain('Voltou do servidor');
  });

  it('cair numa rota sem id e depois numa com id carrega normalmente', async () => {
    mockId = undefined;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });
    expect(textoDa(tree)).toContain('Relatório não encontrado');

    mockId = 'r1';
    await act(async () => {
      tree.update(arvore());
    });

    expect(mockLoadOne).toHaveBeenCalledWith('r1');
    expect(textoDa(tree)).toContain('Inspecao das maquinas pesadas');
  });

  it('falha atrasada do relatorio anterior nao apaga o que ja esta na tela', async () => {
    const primeiro = adiar<Report>();
    mockLoadOne
      .mockReturnValueOnce(primeiro.promessa)
      .mockResolvedValueOnce(relatorio({ id: 'r2', title: 'Relatorio novo' }));

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });

    mockId = 'r2';
    await act(async () => {
      tree.update(arvore());
    });

    await act(async () => {
      primeiro.rejeitar(new Error('timeout do pedido antigo'));
    });

    expect(textoDa(tree)).toContain('Relatorio novo');
    expect(textoDa(tree)).not.toContain('Não foi possível carregar');
  });

  it('resposta atrasada do relatorio anterior nao sobrescreve o atual', async () => {
    const primeiro = adiar<Report>();
    const segundo = adiar<Report>();
    mockLoadOne.mockReturnValueOnce(primeiro.promessa).mockReturnValueOnce(segundo.promessa);

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });

    // Usuario abre outro relatorio antes do primeiro responder.
    mockId = 'r2';
    await act(async () => {
      tree.update(arvore());
    });

    await act(async () => {
      segundo.resolver(relatorio({ id: 'r2', title: 'Relatorio novo' }));
    });
    await act(async () => {
      primeiro.resolver(relatorio({ id: 'r1', title: 'Relatorio velho' }));
    });

    expect(textoDa(tree)).toContain('Relatorio novo');
    expect(textoDa(tree)).not.toContain('Relatorio velho');
  });
});

// --- Secoes condicionais -----------------------------------------------------

describe('Detalhe do relatorio: secoes condicionais', () => {
  it('esconde a secao de imagens quando o relatorio nao tem nenhuma', async () => {
    const tree = await montar();

    expect(textoDa(tree)).not.toContain('Imagens');
  });

  it('desenha uma imagem por uri quando existem', async () => {
    mockLoadOne.mockResolvedValue(relatorio({ images: ['https://ex/1.jpg', 'https://ex/2.jpg'] }));

    const tree = await montar();
    const uris = Array.from(
      new Set(
        tree.root
          .findAll((n) => typeof n.props?.source?.uri === 'string')
          .map((n) => n.props.source.uri as string),
      ),
    );

    expect(textoDa(tree)).toContain('Imagens');
    expect(uris).toEqual(['https://ex/1.jpg', 'https://ex/2.jpg']);
  });

  it('o tom da atividade escolhe a cor da barra, e cada tom tem a sua', async () => {
    mockLoadOne.mockResolvedValue(
      relatorio({
        activities: [
          { id: 'a1', title: 'No prazo', sector: 'S1', progress: 80, tone: 'success', avatars: [] },
          { id: 'a2', title: 'Atrasada', sector: 'S2', progress: 40, tone: 'warning', avatars: [] },
          { id: 'a3', title: 'Parada', sector: 'S3', progress: 10, tone: 'error', avatars: [] },
        ],
      }),
    );

    const tree = await montar();
    const cores = tree.root
      .findAll((n) => typeof n.props?.value === 'number' && typeof n.props?.color === 'string')
      .map((n) => n.props.color as string);

    expect(cores).toHaveLength(3);
    expect(new Set(cores).size).toBe(3); // tres tons, tres cores distintas
  });

  it('esconde a secao de comentarios quando ainda nao ha nenhum', async () => {
    const tree = await montar();

    expect(textoDa(tree)).not.toContain('Comentários');
  });

  it('lista autor, data e corpo de cada comentario existente', async () => {
    mockLoadOne.mockResolvedValue(
      relatorio({
        comments: [
          comentario({ id: 'c1', authorName: 'Josue Oliveira', body: 'Confirmado em campo.' }),
          comentario({
            id: 'c2',
            authorName: 'Maria Souza',
            body: 'Refazer a medicao.',
            createdAt: '14/04/2026',
          }),
        ],
      }),
    );

    const texto = textoDa(await montar());

    expect(texto).toContain('Comentários');
    expect(texto).toContain('Josue Oliveira');
    expect(texto).toContain('Confirmado em campo.');
    expect(texto).toContain('Maria Souza');
    expect(texto).toContain('Refazer a medicao.');
    expect(texto).toContain('14/04/2026');
  });
});

// --- Envio de comentario -----------------------------------------------------

describe('Detalhe do relatorio: envio de comentario', () => {
  it('nao envia campo vazio nem campo so com espacos', async () => {
    const tree = await montar();

    await tocar(cta(tree));
    await digitar(tree, '   ');
    await tocar(cta(tree));

    expect(mockAddComment).not.toHaveBeenCalled();
    expect(cta(tree).props.disabled).toBe(true);
  });

  it('envia o texto aparado, junta o comentario na lista e so entao limpa o campo', async () => {
    const tree = await montar();
    mockAddComment.mockResolvedValue(
      comentario({ id: 'novo', body: 'Refazer a medicao.', authorName: 'Maria Souza' }),
    );

    await digitar(tree, '  Refazer a medicao.  ');
    await tocar(cta(tree));

    expect(mockAddComment).toHaveBeenCalledWith('r1', 'Refazer a medicao.');
    expect(textoDa(tree)).toContain('Refazer a medicao.');
    expect(textoDa(tree)).toContain('Maria Souza');
    expect(campoComentario(tree).props.value).toBe('');
  });

  it('falha no envio avisa o motivo e PRESERVA o texto digitado', async () => {
    mockAddComment.mockRejectedValue(new Error('Comentário muito longo'));
    const tree = await montar();

    await digitar(tree, 'Texto que nao pode sumir');
    await tocar(cta(tree));

    expect(alerta).toHaveBeenCalledWith('Erro', 'Comentário muito longo');
    // O conserto de 2026-07-27: limpar antes fazia a pessoa perder o que escreveu.
    expect(campoComentario(tree).props.value).toBe('Texto que nao pode sumir');
  });

  it('enquanto o envio esta no ar o botao avisa e nao aceita segundo toque', async () => {
    const envio = adiar<ReportComment>();
    mockAddComment.mockReturnValue(envio.promessa);
    const tree = await montar();

    await digitar(tree, 'Primeiro toque');
    let emVoo!: Promise<void>;
    await act(async () => {
      emVoo = cta(tree).props.onPress();
    });

    expect(cta(tree).props.label).toBe('Enviando…');
    expect(cta(tree).props.disabled).toBe(true);

    await tocar(cta(tree)); // segundo toque, ignorado pelo useSubmitOnce
    expect(mockAddComment).toHaveBeenCalledTimes(1);

    await act(async () => {
      envio.resolver(comentario({ id: 'novo', body: 'Primeiro toque' }));
      await emVoo;
    });

    expect(cta(tree).props.label).toBe('Fazer comentário');
    expect(cta(tree).props.disabled).toBe(true); // campo limpo, CTA volta a travar
  });
});

// --- Navegacao ---------------------------------------------------------------

describe('Detalhe do relatorio: navegacao', () => {
  it('voltar devolve a tela anterior', async () => {
    const tree = await montar();

    await tocar(porLabel(tree, 'Voltar'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // Os dois botoes da linha de acoes existem no Figma e estao ligados a
  // `onPress={() => {}}`. O teste NOMEIA isso: sao decorativos hoje. Se algum
  // dia ganharem destino, este teste cai e alguem escreve o de verdade.
  it('os dois botoes da linha de acoes ainda nao levam a lugar nenhum', async () => {
    const tree = await montar();

    await tocar(
      tree.root.findAll(
        (n) => n.props?.variant === 'outline' && n.props?.label === 'Fazer comentário',
      )[0],
    );
    await tocar(porLabel(tree, 'Revisar relatório'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockAddComment).not.toHaveBeenCalled();
  });
});
