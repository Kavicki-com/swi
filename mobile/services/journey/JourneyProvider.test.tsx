import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { JourneyProvider, useJourney } from './JourneyProvider';
import { getJourneyBackend } from './getJourneyBackend';
import { getNotificationBackend } from '../notifications/getNotificationBackend';

jest.mock('./getJourneyBackend', () => ({ getJourneyBackend: jest.fn() }));
jest.mock('../notifications/getNotificationBackend', () => ({
  getNotificationBackend: jest.fn(),
}));

const mockJourneyBackend = getJourneyBackend as jest.Mock;
const mockNotificationBackend = getNotificationBackend as jest.Mock;

const IDLE_SESSION = {
  state: 'idle' as const,
  activeTaskId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};

const task = (id: string, title: string) => ({ id, title }) as any;

function Probe() {
  const { tasks, loadStatus } = useJourney();
  return <Text>{`${loadStatus}|${tasks.map((t) => t.title).join(',')}`}</Text>;
}

describe('JourneyProvider — tarefa nova sem deslogar', () => {
  let listTasks: jest.Mock;
  let notify: ((n: any) => void) | null;

  beforeEach(() => {
    notify = null;
    listTasks = jest.fn().mockResolvedValue([]);
    mockJourneyBackend.mockReturnValue({
      getJourney: jest.fn().mockResolvedValue(IDLE_SESSION),
      listTasks,
    });
    mockNotificationBackend.mockReturnValue({
      subscribe: (cb: (n: any) => void) => {
        notify = cb;
        return () => { notify = null; };
      },
    });
  });

  const render = async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <JourneyProvider>
          <Probe />
        </JourneyProvider>,
      );
    });
    return tree;
  };

  it('recarrega quando chega notificação de jornada (o admin atribuiu)', async () => {
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).toContain('empty|');

    // O backend passa a devolver a tarefa que o admin acabou de atribuir.
    listTasks.mockResolvedValue([task('t1', 'teste')]);
    await act(async () => {
      notify?.({ id: 'n1', domain: 'journey', targetId: 'order-1' });
    });

    expect(JSON.stringify(tree.toJSON())).toContain('teste');
  });

  it('ignora notificação de outro domínio (não vale um round-trip)', async () => {
    await render();
    const callsAfterMount = listTasks.mock.calls.length;
    await act(async () => {
      notify?.({ id: 'n2', domain: 'chat', targetId: 'conv-1' });
    });
    expect(listTasks).toHaveBeenCalledTimes(callsAfterMount);
  });

  it('recarga de fundo que falha mantém a lista na tela (não vira erro)', async () => {
    listTasks.mockResolvedValue([task('t1', 'teste')]);
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).toContain('ready|teste');

    listTasks.mockRejectedValue(new Error('rede caiu'));
    await act(async () => {
      notify?.({ id: 'n3', domain: 'journey', targetId: 'order-1' });
    });

    // Continua 'ready' com a tarefa — perder a lista por falha momentânea de
    // rede seria pior que mostrar dado de um segundo atrás.
    expect(JSON.stringify(tree.toJSON())).toContain('ready|teste');
  });
});
