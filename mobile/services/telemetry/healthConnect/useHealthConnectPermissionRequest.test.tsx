import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { HealthConnectPermission, HealthConnectState } from './healthConnectReader';
import type { HealthConnectAvailability } from './healthConnectSource';
import {
  healthConnectStatusOf,
  useHealthConnectPermissionRequest,
  type HealthConnectPermissionRequest,
} from './useHealthConnectPermissionRequest';

// O pedido de permissão feito numa tela (o passo do pareamento, o
// Monitoramento) e a resposta dele. A resposta vale para o Health Connect em
// que foi obtida: com a disponibilidade mudando depois (a pessoa instalou ou
// atualizou pela Play Store), ela deixa de valer. A disponibilidade aqui vem
// de uma variável, como o contexto do envio a entrega: trocar e renderizar de
// novo imita o provider relendo o estado.

type Resposta = HealthConnectPermission | 'unavailable';

let disponibilidade: HealthConnectAvailability | null = 'available';
let visto: HealthConnectPermissionRequest;
const pedirAoSistema = jest.fn(async (): Promise<Resposta> => 'denied');

function Tela() {
  visto = useHealthConnectPermissionRequest(disponibilidade, pedirAoSistema);
  return null;
}

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Tela />);
  });
  return tree;
};

const renderDeNovo = async (tree: ReactTestRenderer) => {
  await act(async () => {
    tree.update(<Tela />);
  });
};

const pedir = async () => {
  await act(async () => {
    await visto.request();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  disponibilidade = 'available';
  pedirAoSistema.mockImplementation(async () => 'denied');
});

describe('useHealthConnectPermissionRequest', () => {
  it('antes de pedir não há resposta nem pedido em curso', async () => {
    await montar();
    expect(visto.answer).toBeNull();
    expect(visto.requesting).toBe(false);
  });

  it('pedir chama o sistema, marca o pedido em curso e guarda a resposta', async () => {
    let soltar!: (resposta: Resposta) => void;
    pedirAoSistema.mockImplementationOnce(
      () =>
        new Promise<Resposta>((resolve) => {
          soltar = resolve;
        }),
    );
    await montar();
    let emCurso!: Promise<void>;
    await act(async () => {
      emCurso = visto.request();
    });
    expect(pedirAoSistema).toHaveBeenCalledTimes(1);
    expect(visto.requesting).toBe(true);
    await act(async () => {
      soltar('denied');
      await emCurso;
    });
    expect(visto.requesting).toBe(false);
    expect(visto.answer).toBe('denied');
  });

  // O provider relê o estado antes de devolver a resposta: a disponibilidade
  // nova e a resposta chegam no mesmo render. Um reset por efeito apagaria a
  // resposta que acabou de chegar; aqui ela vale para a disponibilidade em
  // que veio, e continua valendo enquanto ela não muda.
  it('resposta e disponibilidade mudando no mesmo render: a resposta fica', async () => {
    disponibilidade = null;
    pedirAoSistema.mockImplementationOnce(async () => {
      disponibilidade = 'available';
      return 'denied';
    });
    const tree = await montar();
    await pedir();
    expect(visto.answer).toBe('denied');
    await renderDeNovo(tree);
    expect(visto.answer).toBe('denied');
  });

  // O pedido falhou sem Health Connect; a pessoa instalou pela Play Store e
  // voltou. A resposta era de outro Health Connect: não vale mais, e a tela
  // volta a oferecer o pedido em vez do caminho dos ajustes.
  it('disponibilidade mudando depois da resposta: a resposta deixa de valer', async () => {
    pedirAoSistema.mockImplementationOnce(async () => {
      disponibilidade = 'unavailable';
      return 'unavailable';
    });
    const tree = await montar();
    await pedir();
    expect(visto.answer).toBe('unavailable');

    disponibilidade = 'available';
    await renderDeNovo(tree);
    expect(visto.answer).toBeNull();
  });

  // Como o reset de antes: uma mudança apaga a resposta de vez, e voltar à
  // disponibilidade de antes não a traz de volta.
  it('voltar à disponibilidade de antes não traz a resposta de volta', async () => {
    const tree = await montar();
    await pedir();
    expect(visto.answer).toBe('denied');

    disponibilidade = 'update_required';
    await renderDeNovo(tree);
    disponibilidade = 'available';
    await renderDeNovo(tree);
    expect(visto.answer).toBeNull();
  });

  it('a mesma disponibilidade entre renders mantém a resposta', async () => {
    const tree = await montar();
    await pedir();
    await renderDeNovo(tree);
    await renderDeNovo(tree);
    expect(visto.answer).toBe('denied');
  });

  it('um pedido novo troca a resposta', async () => {
    await montar();
    await pedir();
    pedirAoSistema.mockImplementationOnce(async () => 'granted');
    await pedir();
    expect(visto.answer).toBe('granted');
  });
});

describe('healthConnectStatusOf', () => {
  const estado = (parcial: Partial<HealthConnectState> = {}): HealthConnectState => ({
    availability: 'available',
    permission: 'denied',
    bandPackage: null,
    bandLabel: null,
    noBand: false,
    lastSyncAt: null,
    ...parcial,
  });

  it('sem estado, ou antes da primeira conferência, é desconhecido', () => {
    expect(healthConnectStatusOf(null, null)).toBe('unknown');
    expect(healthConnectStatusOf(estado({ availability: null }), 'denied')).toBe('unknown');
  });

  it('ausente ou desatualizado vale acima de qualquer resposta', () => {
    expect(healthConnectStatusOf(estado({ availability: 'unavailable' }), 'denied')).toBe(
      'unavailable',
    );
    expect(healthConnectStatusOf(estado({ availability: 'update_required' }), null)).toBe(
      'update_required',
    );
  });

  it('concedida vale acima de uma resposta antiga', () => {
    expect(healthConnectStatusOf(estado({ permission: 'granted' }), 'denied')).toBe('granted');
  });

  // Negada no estado também vem de quem nunca foi perguntado: só um pedido
  // desta tela leva ao caminho dos ajustes. O pedido que rejeitou com o
  // Health Connect ainda disponível pede o mesmo conselho.
  it('sem permissão, só a resposta de um pedido daqui leva aos ajustes', () => {
    expect(healthConnectStatusOf(estado(), null)).toBe('not_granted');
    expect(healthConnectStatusOf(estado({ permission: null }), null)).toBe('not_granted');
    expect(healthConnectStatusOf(estado(), 'denied')).toBe('not_granted_after_request');
    expect(healthConnectStatusOf(estado(), 'unavailable')).toBe('not_granted_after_request');
  });
});
