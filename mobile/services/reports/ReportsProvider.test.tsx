import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { ReportsProvider, useReports } from './ReportsProvider';
import { getReportsBackend } from './getReportsBackend';
import { ReportPermissionError, ReportVersionConflictError } from './types';
import type { Report, ReportUpdateInput } from './types';

jest.mock('./getReportsBackend', () => ({ getReportsBackend: jest.fn() }));

const mockGetBackend = getReportsBackend as jest.Mock;

const relatorio = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  title: 'Inspeção das máquinas',
  summary: 'resumo antigo',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: [],
  details: 'detalhes antigos',
  images: [],
  activities: [],
  comments: [],
  version: 0,
  canEdit: true,
  ...over,
});

// A lista da tela sai daqui: o texto do Probe é o que o usuário veria.
let api: {
  load: () => Promise<void>;
  update: (id: string, i: ReportUpdateInput) => Promise<Report>;
  remove: (id: string) => Promise<void>;
};

function Probe() {
  const { reports, load, update, remove } = useReports();
  api = { load, update, remove };
  return <Text>{reports.map((r) => `${r.title}@${r.version}#${r.comments.length}`).join('|')}</Text>;
}

const texto = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Text)[0].props.children as string;

let list: jest.Mock;
let update: jest.Mock;
let remove: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ReportsProvider>
        <Probe />
      </ReportsProvider>,
    );
  });
  await act(async () => {
    await api.load();
  });
  return tree;
};

beforeEach(() => {
  list = jest.fn(async () => [
    relatorio({
      comments: [{ id: 'c1', body: 'oi', authorName: 'A', authorAvatarUri: '', createdAt: '' }],
    }),
  ]);
  update = jest.fn();
  remove = jest.fn();
  mockGetBackend.mockReturnValue({ list, update, remove });
});

describe('ReportsProvider.update: otimismo com rollback', () => {
  it('mostra o novo título ANTES da resposta do servidor', async () => {
    // Promessa presa: enquanto ela não resolve, a lista já tem que responder.
    let liberar!: (r: Report) => void;
    update.mockReturnValue(
      new Promise<Report>((resolve) => {
        liberar = resolve;
      }),
    );
    const tree = await render();

    let salvando!: Promise<Report>;
    await act(async () => {
      salvando = api.update('r1', { title: 'Título novo', baseVersion: 0 });
    });
    expect(texto(tree)).toContain('Título novo');

    await act(async () => {
      liberar(relatorio({ title: 'Título novo', version: 1 }));
      await salvando;
    });
    expect(texto(tree)).toContain('Título novo@1');
  });

  it('desfaz a mudança quando o servidor recusa, e propaga o erro', async () => {
    update.mockRejectedValue(new ReportVersionConflictError());
    const tree = await render();

    await act(async () => {
      await expect(
        api.update('r1', { title: 'Título novo', baseVersion: 0 }),
      ).rejects.toBeInstanceOf(ReportVersionConflictError);
    });

    expect(texto(tree)).toContain('Inspeção das máquinas@0');
    expect(texto(tree)).not.toContain('Título novo');
  });

  // A resposta do PATCH sai do mesmo mapper do list: NÃO traz comentários. Se
  // ela substituísse a entrada inteira, os comentários já carregados sumiriam
  // da tela sem que ninguém os tivesse apagado.
  it('preserva os comentários já carregados ao aplicar a resposta do servidor', async () => {
    update.mockResolvedValue(relatorio({ title: 'Título novo', version: 1, comments: [] }));
    const tree = await render();

    await act(async () => {
      await api.update('r1', { title: 'Título novo', baseVersion: 0 });
    });

    expect(texto(tree)).toBe('Título novo@1#1');
  });
});

// Ticket 15: exclusão otimista. A lista responde na hora e restaura o item,
// NA MESMA POSIÇÃO, se o servidor recusar.
describe('ReportsProvider.remove: otimismo com rollback', () => {
  const doisRelatorios = () => [
    relatorio({ id: 'r1', title: 'Primeiro' }),
    relatorio({ id: 'r2', title: 'Segundo' }),
  ];

  it('tira o relatório da lista antes da resposta do servidor', async () => {
    list.mockResolvedValue(doisRelatorios());
    let liberar!: () => void;
    remove.mockReturnValue(new Promise<void>((resolve) => { liberar = resolve; }));
    const tree = await render();

    let excluindo!: Promise<void>;
    await act(async () => {
      excluindo = api.remove('r1');
    });
    expect(texto(tree)).not.toContain('Primeiro');
    expect(texto(tree)).toContain('Segundo');

    await act(async () => {
      liberar();
      await excluindo;
    });
    expect(texto(tree)).not.toContain('Primeiro');
  });

  it('restaura o item na mesma posição quando o servidor recusa, e propaga', async () => {
    list.mockResolvedValue(doisRelatorios());
    remove.mockRejectedValue(new ReportPermissionError());
    const tree = await render();

    await act(async () => {
      await expect(api.remove('r1')).rejects.toBeInstanceOf(ReportPermissionError);
    });

    expect(texto(tree)).toBe('Primeiro@0#0|Segundo@0#0');
  });
});
