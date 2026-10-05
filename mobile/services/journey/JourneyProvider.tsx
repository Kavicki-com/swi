import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import type { JourneyState, JourneySession, Task } from './types';
import { getJourneyBackend } from './getJourneyBackend';
import {
  replayJourneyActions,
  type JourneyAction,
  type JourneySnapshot,
} from './journeyTransitions';
import { getNotificationBackend } from '../notifications/getNotificationBackend';
import { getSendQueue } from '../outbox/getSendQueue';
import { isJourneyItem, type JourneyItem } from '../outbox/sendOutbox';
import type { EnqueueResult, SendDraft } from '../outbox/sendQueue';
import { useSendQueueEvent, useSendQueueState } from '../outbox/useSendQueue';

// Shared journey state, agora backed pelo backend (services/journey). Consumido
// por:
//   - journey/index.tsx → idle vs ongoing/paused layout switch + donut real
//   - journey/task/[id].tsx → state machine das CTAs + progress real
//   - app/(app)/_layout.tsx → o GPS em segundo plano segue a jornada
//
// O provider fica montado em app/(app)/_layout.tsx — a sessão vive durante o
// login e remonta no logout.
//
// As ações (iniciar, concluir e cancelar tarefa; pausar, retomar e encerrar o
// turno; foto da tarefa) passam pela fila de envios e valem na tela na hora do
// toque, com ou sem sinal. O que a tela mostra é:
//
//   último estado lido do servidor
//   + ações já confirmadas que a releitura ainda não trouxe
//   + ações que esperam na fila,
//
// reaplicadas na ordem com a hora do toque (journeyTransitions.ts). A resposta
// de uma ação não vira estado: quando a fila fica sem ação da jornada, o
// provider relê o servidor. Reaplicar é seguro porque a fila manda um item por
// vez e na ordem, e toda transição pode ser aplicada duas vezes sem mudar nada:
// a leitura traz no máximo uma ação que ainda está na fila, a da frente.
//
// A jornada só conta como carregada depois de a fila abrir, e quem abre a
// fila é o SendQueueRoot, montado ao lado deste provider em app/(app)/_layout.tsx.

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/** O que a fila precisa da tarefa: o id vai ao servidor, o título ao aviso de recusa. */
export type TaskRef = Pick<Task, 'id' | 'title'>;

interface JourneyContextValue {
  loadStatus: LoadStatus;
  tasks: Task[];
  state: JourneyState;
  activeTaskId: string | null;
  /** Âncoras da sessão (ISO string + segundos bancados) pro donut do index. */
  startedAt: string | null;
  accumulatedSeconds: number;
  load: (opts?: { silent?: boolean }) => Promise<void>;
  /** Recarga de fundo: sem piscar loading e sem perder a lista se falhar. */
  refresh: () => Promise<void>;
  getTask: (id: string) => Promise<Task | null>;
  /** `full`: a fila está no teto, a ação não entrou e a tela não mudou. */
  startTask: (task: TaskRef) => Promise<EnqueueResult>;
  completeTask: (task: TaskRef) => Promise<EnqueueResult>;
  cancelTask: (task: TaskRef) => Promise<EnqueueResult>;
  pauseJourney: () => Promise<EnqueueResult>;
  resumeJourney: () => Promise<EnqueueResult>;
  endJourney: () => Promise<EnqueueResult>;
  /** Rejeita quando a foto é recusada na entrada (sumiu, ou passa de 15 MB). */
  addTaskPhoto: (task: TaskRef, uri: string) => Promise<EnqueueResult>;
  /** Há ação da jornada esperando o sinal, e a pessoa não fechou o aviso. */
  waitingForSignal: boolean;
  /** Fecha o aviso de sem conexão até a fila esvaziar. */
  dismissWaiting: () => void;
}

const JourneyContext = createContext<JourneyContextValue | null>(null);

const IDLE_SESSION: JourneySession = {
  state: 'idle',
  activeTaskId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};

/** O item da fila como ação da jornada, na hora do toque. */
function toAction(item: JourneyItem): JourneyAction | null {
  const at = Date.parse(item.createdAt);
  switch (item.kind) {
    case 'journey.task.start':
    case 'journey.task.complete':
    case 'journey.task.cancel': {
      const type = item.kind === 'journey.task.start' ? 'task.start'
        : item.kind === 'journey.task.complete' ? 'task.complete'
        : 'task.cancel';
      // Hora ilegível: a fila descarta o item por validade, a tela o ignora.
      return Number.isNaN(at) ? null : { type, taskId: item.taskId, at };
    }
    case 'journey.pause':
    case 'journey.resume':
    case 'journey.end': {
      const type = item.kind === 'journey.pause' ? 'pause'
        : item.kind === 'journey.resume' ? 'resume'
        : 'end';
      return Number.isNaN(at) ? null : { type, at };
    }
    case 'journey.task.photo':
      return { type: 'task.photo', taskId: item.taskId, uri: item.images[0].localUri };
  }
}

/** Ação confirmada pelo servidor, com a ordem em que foi confirmada. */
interface SettledAction {
  seq: number;
  item: JourneyItem;
}

/** As fotos da tarefa na resposta do envio da foto, que é a própria tarefa. */
function imagesOf(result: unknown, taskId: string): string[] | null {
  const task = result as { id?: unknown; images?: unknown } | null | undefined;
  if (task?.id !== taskId || !Array.isArray(task.images)) return null;
  return task.images.every((uri) => typeof uri === 'string') ? (task.images as string[]) : null;
}

export function JourneyProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getJourneyBackend(), []);
  const [fetchStatus, setFetchStatus] = useState<LoadStatus>('idle');
  const [snapshot, setSnapshot] = useState<JourneySnapshot>({ journey: IDLE_SESSION, tasks: [] });
  const [settled, setSettled] = useState<SettledAction[]>([]);
  const [waitingDismissed, setWaitingDismissed] = useState(false);
  const queue = useSendQueueState();

  // `settleSeq` numera as confirmações; `loadSeq` numera as leituras, e
  // `appliedLoad` guarda a última leitura que valeu. A leitura sabe quais
  // confirmações já traz (as de antes de ela sair), e uma leitura que chega
  // depois de outra mais nova é descartada: ela traria o estado de antes.
  const settleSeq = useRef(0);
  const loadSeq = useRef(0);
  const appliedLoad = useRef(0);

  // `silent`: recarga de fundo (push/foreground/foco) não pode piscar o
  // esqueleto de loading nem apagar a lista que já está na tela — só troca o
  // conteúdo quando a resposta chega. Falha silenciosa mantém o que havia:
  // perder a lista por uma falha de rede momentânea é pior que dado velho.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = (loadSeq.current += 1);
    if (!opts?.silent) setFetchStatus('loading');
    try {
      // Uma ação confirmada enquanto a leitura ia e voltava deixa a leitura
      // com até duas ações que a tela ainda reaplica: a confirmada e a
      // seguinte, já aplicada no servidor e ainda na fila. Reaplicar as duas
      // contaria o tempo em dobro, então a leitura é refeita. Sem confirmação
      // no meio, ela traz no máximo a da frente da fila, o que é seguro.
      let settledBefore: number;
      let read: [JourneySession, Task[]];
      do {
        settledBefore = settleSeq.current;
        read = await Promise.all([backend.getJourney(), backend.listTasks()]);
      } while (settleSeq.current !== settledBefore);
      if (seq < appliedLoad.current) return;
      appliedLoad.current = seq;
      const [j, t] = read;
      setSnapshot({ journey: j, tasks: t });
      setSettled((prev) => prev.filter((s) => s.seq > settledBefore));
      setFetchStatus(t.length ? 'ready' : 'empty');
    } catch {
      // Uma leitura mais nova já valeu: a falha desta não apaga a tela.
      if (seq < appliedLoad.current) return;
      if (!opts?.silent) setFetchStatus('error');
    }
  }, [backend]);

  const refresh = useCallback(() => load({ silent: true }), [load]);

  useEffect(() => {
    load();
  }, [load]);

  // Tarefa nova tem que aparecer sozinha. Buscar a lista uma única vez, no
  // mount, faria o worker só ver a atribuição depois de deslogar e logar, que é
  // o que remonta o provider. Daí três gatilhos, do mais imediato ao mais
  // tolerante a falha:
  //
  // 1) push: o backend cria uma notificação de domínio 'journey' pra cada
  //    responsável e a empurra pelo socket. Escutar aqui, e não na tela de
  //    notificações, é o que faz o aviso chegar esteja o worker onde estiver,
  //    porque o provider envolve o app inteiro.
  useEffect(() => {
    const backendN = getNotificationBackend();
    const unsub = backendN.subscribe((n) => {
      if (n.domain === 'journey') void refresh();
    });
    return unsub;
  }, [refresh]);

  // 2) volta do segundo plano: cobre o tempo em que o app esteve fechado (e
  //    qualquer socket que tenha morrido junto).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Confirmada, a ação sai da fila, mas a leitura que está na tela ainda não a
  // traz: ela continua valendo até a próxima leitura. Sem isso a tela voltaria
  // ao estado de antes por um instante, e o GPS desligaria e religaria.
  // Recusada, ela simplesmente sai: o servidor disse que não vale.
  //
  // A foto é diferente: a cópia local é apagada quando ela sai da fila. A
  // resposta é a tarefa com as fotos do servidor, e só as fotos dela entram
  // no estado lido. Elas não mexem no turno nem no GPS.
  useSendQueueEvent((event) => {
    if (event.type !== 'sent' || !isJourneyItem(event.item)) return;
    const seq = (settleSeq.current += 1);
    const item = event.item;
    if (item.kind === 'journey.task.photo') {
      const images = imagesOf(event.result, item.taskId);
      if (!images) {
        void refresh();
        return;
      }
      setSnapshot((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === item.taskId ? { ...t, images } : t)),
      }));
      return;
    }
    setSettled((prev) => [...prev, { seq, item }]);
  });

  const pending = useMemo(() => queue.items.filter(isJourneyItem), [queue.items]);
  const hasPending = pending.length > 0;

  // 3) a fila ficou sem ação da jornada: relê o estado de verdade.
  const hadPending = useRef(false);
  useEffect(() => {
    if (hadPending.current && !hasPending) void refresh();
    hadPending.current = hasPending;
    if (!hasPending) setWaitingDismissed(false);
  }, [hasPending, refresh]);

  const view = useMemo(() => {
    const actions = [...settled.map((s) => s.item), ...pending]
      .map(toAction)
      .filter((a): a is JourneyAction => a !== null);
    return replayJourneyActions(snapshot, actions);
  }, [snapshot, settled, pending]);

  // A jornada só conta como carregada depois de a fila ler o que estava
  // guardado: antes disso uma ação pendente (um "encerrar" feito sem sinal)
  // ainda não foi reaplicada, e quem segue a jornada agiria sobre o estado
  // velho (o GPS ligaria por um instante).
  const loadStatus: LoadStatus =
    !queue.open && (fetchStatus === 'ready' || fetchStatus === 'empty') ? 'loading' : fetchStatus;

  const getTask = useCallback((id: string) => backend.getTask(id), [backend]);

  const enqueue = useCallback((draft: SendDraft) => getSendQueue().enqueue(draft), []);
  const startTask = useCallback(
    (task: TaskRef) => enqueue({ kind: 'journey.task.start', taskId: task.id, taskTitle: task.title }),
    [enqueue],
  );
  const completeTask = useCallback(
    (task: TaskRef) => enqueue({ kind: 'journey.task.complete', taskId: task.id, taskTitle: task.title }),
    [enqueue],
  );
  const cancelTask = useCallback(
    (task: TaskRef) => enqueue({ kind: 'journey.task.cancel', taskId: task.id, taskTitle: task.title }),
    [enqueue],
  );
  const pauseJourney = useCallback(() => enqueue({ kind: 'journey.pause' }), [enqueue]);
  const resumeJourney = useCallback(() => enqueue({ kind: 'journey.resume' }), [enqueue]);
  const endJourney = useCallback(() => enqueue({ kind: 'journey.end' }), [enqueue]);
  const addTaskPhoto = useCallback(
    (task: TaskRef, uri: string) =>
      enqueue({ kind: 'journey.task.photo', taskId: task.id, taskTitle: task.title, imageUri: uri }),
    [enqueue],
  );

  // O aviso só sai depois de uma tentativa falhar: com sinal a ação também
  // passa pela fila, e o aviso piscaria a cada toque.
  const waitingForSignal = hasPending && queue.stalled && !waitingDismissed;
  const dismissWaiting = useCallback(() => setWaitingDismissed(true), []);

  const value = useMemo<JourneyContextValue>(
    () => ({
      loadStatus,
      tasks: view.tasks,
      state: view.journey.state,
      activeTaskId: view.journey.activeTaskId,
      startedAt: view.journey.startedAt,
      accumulatedSeconds: view.journey.accumulatedSeconds,
      load,
      refresh,
      getTask,
      startTask,
      completeTask,
      cancelTask,
      pauseJourney,
      resumeJourney,
      endJourney,
      addTaskPhoto,
      waitingForSignal,
      dismissWaiting,
    }),
    [
      loadStatus,
      view,
      load,
      refresh,
      getTask,
      startTask,
      completeTask,
      cancelTask,
      pauseJourney,
      resumeJourney,
      endJourney,
      addTaskPhoto,
      waitingForSignal,
      dismissWaiting,
    ],
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyContextValue {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error('useJourney must be used inside JourneyProvider');
  return ctx;
}
