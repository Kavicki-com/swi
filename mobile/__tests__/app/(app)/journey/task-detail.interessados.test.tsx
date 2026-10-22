import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import TaskDetails from '../../../../app/(app)/journey/task/[id]';
import type { Task } from '../../../../services/journey/types';

// Legenda dos Interessados no detalhe da tarefa. Ela fala de quem acompanha a
// tarefa, então só pode usar os nomes que a tarefa traz: sem nome inventado
// quando não há ninguém e sem "e mais -1 pessoas" quando há só um.

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 't1' }),
}));

jest.mock('../../../../lib/media/useMediaPicker', () => ({
  useMediaPicker: () => ({ showPicker: jest.fn(), takePhoto: jest.fn(), pickFromGallery: jest.fn() }),
}));

const mockJourney = {
  getTask: jest.fn(),
  tasks: [] as Task[],
  startTask: jest.fn(),
  completeTask: jest.fn(),
  cancelTask: jest.fn(),
  pauseJourney: jest.fn(),
  resumeJourney: jest.fn(),
  addTaskPhoto: jest.fn(),
  state: 'idle' as const,
  activeTaskId: null,
};
jest.mock('../../../../services/journey/JourneyProvider', () => ({
  useJourney: () => mockJourney,
}));
jest.mock('../../../../services/positions/trackingPermission', () => ({
  requestTrackingPermission: jest.fn(),
  requestAlwaysPermission: jest.fn(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const NOMES = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Davi Rocha'];

const comResponsaveis = (n: number): Task => ({
  id: 't1',
  title: 'Inspeção da correia',
  description: 'Setor B',
  objective: 'Verificar desgaste',
  estimatedMinutes: 120,
  status: 'pending',
  startedAt: null,
  accumulatedSeconds: 0,
  progressPct: 0,
  images: [],
  responsibleCount: n,
  responsibleNames: NOMES.slice(0, n),
  responsibleAvatars: NOMES.slice(0, n).map((_, i) => `https://example.test/a${i}.png`),
});

const legenda = async (task: Task) => {
  mockJourney.getTask.mockResolvedValue(task);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <TaskDetails />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string)
    .filter((t, i, todos) => t.includes('acompanhando') && todos.indexOf(t) === i);
};

describe('Detalhe da tarefa: legenda dos Interessados', () => {
  it('sem responsável, a linha some (nenhum nome inventado)', async () => {
    const linhas = await legenda(comResponsaveis(0));

    expect(linhas).toEqual([]);
  });

  it('com um responsável, fala só dele', async () => {
    expect(await legenda(comResponsaveis(1))).toEqual([
      'Ana Souza está acompanhando essa tarefa',
    ]);
  });

  it('com dois, "e mais 1 pessoa", no singular', async () => {
    expect(await legenda(comResponsaveis(2))).toEqual([
      'Ana Souza e mais 1 pessoa estão acompanhando essa tarefa',
    ]);
  });

  it('com três ou mais, o texto do Figma com o total menos um', async () => {
    expect(await legenda(comResponsaveis(4))).toEqual([
      'Ana Souza e mais 3 pessoas estão acompanhando essa tarefa',
    ]);
  });

  // A contagem pode passar dos nomes que a API manda (ela traz só os avatares
  // visíveis). O primeiro nome existe, então a legenda segue pelo total.
  it('o total vem da contagem, não do número de nomes recebidos', async () => {
    const task = { ...comResponsaveis(1), responsibleCount: 18 };

    expect(await legenda(task)).toEqual([
      'Ana Souza e mais 17 pessoas estão acompanhando essa tarefa',
    ]);
  });

  // Contagem sem nome nenhum: não há de quem falar, e o nome padrão antigo
  // ("Joacir Alves") era de uma pessoa que não está na tarefa.
  it('contagem sem nome não desenha a linha', async () => {
    const task = { ...comResponsaveis(0), responsibleCount: 2 };

    expect(await legenda(task)).toEqual([]);
  });
});
