import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Report, ReportComment, ReportInput } from './types';
import { getReportsBackend } from './getReportsBackend';
import { useAuth } from '../auth/AuthProvider';
import { useProfile } from '../profile/ProfileProvider';
import { getSendQueue } from '../outbox/getSendQueue';
import { PENDING_LABEL } from '../outbox/sendCopy';
import type { EnqueueResult } from '../outbox/sendQueue';
import { useSendQueueEvent, useSendQueueState } from '../outbox/useSendQueue';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/** Os meus comentários num relatório que a tela ainda não recebeu do servidor. */
export interface OwnComments {
  /** Confirmados nesta sessão, já com autor e data do servidor. */
  sent: ReportComment[];
  /** Aguardando envio: "Aguardando envio" no lugar da data. */
  pending: ReportComment[];
}

interface ReportsState {
  reports: Report[];
  status: LoadStatus;
  load: () => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  /**
   * Os meus relatórios aguardando envio, do mais novo ao mais velho, já na
   * forma do cartão. Ainda não existem no servidor: não têm detalhe para abrir.
   */
  pendingReports: Report[];
  /** Põe o relatório na fila de envios. `full`: a fila está no teto e ele não entrou. */
  create: (input: ReportInput) => Promise<EnqueueResult>;
  /** Põe o comentário na fila de envios. `full`: a fila está no teto e ele não entrou. */
  addComment: (reportId: string, body: string) => Promise<EnqueueResult>;
  commentsFor: (reportId: string) => OwnComments;
}

// dd/mm/aaaa, o formato que o backend devolve em `creationDate`.
function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

const NO_COMMENTS: ReportComment[] = [];
const ReportsContext = createContext<ReportsState | null>(null);

export function ReportsProvider({ children }: PropsWithChildren) {
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const backend = useMemo(() => getReportsBackend(), []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await backend.list();
      setReports(r);
      setStatus(r.length ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  }, [backend]);
  const loadOne = useCallback((id: string) => backend.get(id), [backend]);

  // Relatório e comentário saem pela fila de envios: entram nela na hora, com
  // ou sem sinal, e a confirmação do servidor chega depois, pelo evento.
  const queueState = useSendQueueState();
  const { user } = useAuth();
  const { profile } = useProfile();
  const authorName = user?.name ?? '';
  const authorAvatarUri = profile?.avatarUrl ?? '';
  const sector = profile?.sector ?? '';
  // Comentários confirmados nesta sessão, por relatório. A tela de detalhe
  // guarda o relatório que carregou; é daqui que ela recebe o comentário novo.
  const [sentComments, setSentComments] = useState<Record<string, ReportComment[]>>({});

  const create = useCallback(
    (input: ReportInput) => getSendQueue().enqueue({ kind: 'report', ...input }),
    [],
  );

  const addComment = useCallback(
    (reportId: string, body: string) =>
      getSendQueue().enqueue({ kind: 'report.comment', reportId, body }),
    [],
  );

  useSendQueueEvent((event) => {
    if (event.type !== 'sent') return;
    if (event.item.kind === 'report') {
      const created = event.result as Report;
      // A lista pode ter sido recarregada entre o envio e a confirmação e já
      // trazer o relatório: ele não entra duas vezes.
      setReports((prev) => (prev.some((r) => r.id === created.id) ? prev : [created, ...prev]));
      setStatus((prev) => (prev === 'empty' ? 'ready' : prev));
    } else if (event.item.kind === 'report.comment') {
      const { reportId } = event.item;
      const comment = event.result as ReportComment;
      setSentComments((prev) => ({ ...prev, [reportId]: [...(prev[reportId] ?? []), comment] }));
    }
  });

  const pendingReports = useMemo<Report[]>(
    () =>
      queueState.items
        .flatMap((item) =>
          item.kind === 'report'
            ? [
                {
                  id: item.id,
                  title: item.title,
                  summary: item.summary,
                  // Mesma cor de tag que o backend dá ao relatório recém-criado.
                  status: 'pending' as const,
                  statusLabel: PENDING_LABEL,
                  authorName,
                  authorAvatarUri,
                  creationDate: formatDate(item.createdAt),
                  sector,
                  responsibles: item.responsibles,
                  details: item.details,
                  images: [],
                  activities: [],
                  comments: [],
                },
              ]
            : [],
        )
        .reverse(),
    [queueState.items, authorName, authorAvatarUri, sector],
  );

  const commentsFor = useCallback(
    (reportId: string): OwnComments => ({
      sent: sentComments[reportId] ?? NO_COMMENTS,
      pending: queueState.items.flatMap((item) =>
        item.kind === 'report.comment' && item.reportId === reportId
          ? [{ id: item.id, body: item.body, authorName, authorAvatarUri, createdAt: PENDING_LABEL }]
          : [],
      ),
    }),
    [sentComments, queueState.items, authorName, authorAvatarUri],
  );

  const value = useMemo<ReportsState>(
    () => ({ reports, status, load, loadOne, pendingReports, create, addComment, commentsFor }),
    [reports, status, load, loadOne, pendingReports, create, addComment, commentsFor],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
