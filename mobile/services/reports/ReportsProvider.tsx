import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Report, ReportComment, ReportInput, ReportUpdateInput } from './types';
import { getReportsBackend } from './getReportsBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface ReportsState {
  reports: Report[];
  status: LoadStatus;
  load: () => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  create: (input: ReportInput) => Promise<Report>;
  update: (id: string, input: ReportUpdateInput) => Promise<Report>;
  remove: (id: string) => Promise<void>;
  addComment: (reportId: string, body: string) => Promise<ReportComment>;
}
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
  const create = useCallback(async (input: ReportInput) => {
    const created = await backend.create(input);
    setReports((prev) => [created, ...prev]);
    return created;
  }, [backend]);

  // Edição OTIMISTA: a lista mostra o texto novo antes da resposta e volta ao
  // que era se o servidor recusar (403 de quem não é autor, 409 de quem editou
  // por último). Sem o rollback, uma recusa deixaria na tela um valor que não
  // existe no banco, que é justamente o que a versão OCC veio impedir.
  const update = useCallback(
    async (id: string, input: ReportUpdateInput) => {
      const anterior = reports.find((r) => r.id === id);
      const campos = {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.details !== undefined && { details: input.details }),
        ...(input.responsibles !== undefined && { responsibles: input.responsibles }),
      };
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...campos } : r)));
      try {
        const salvo = await backend.update(id, input);
        // A resposta do PATCH sai do mapper da LISTA: não traz comentários nem
        // os avatares resolvidos das atividades. Substituir a entrada inteira
        // por ela apagaria da tela comentários que ninguém apagou.
        setReports((prev) =>
          prev.map((r) =>
            r.id === id ? { ...salvo, comments: r.comments, activities: r.activities } : r,
          ),
        );
        return salvo;
      } catch (e) {
        if (anterior) setReports((prev) => prev.map((r) => (r.id === id ? anterior : r)));
        throw e;
      }
    },
    [backend, reports],
  );

  // Exclusão OTIMISTA: o item some da lista na hora e volta, NA MESMA POSIÇÃO,
  // se o servidor recusar. A lista inteira anterior é o snapshot de rollback:
  // filtrar de volta não devolveria o lugar original do item.
  const remove = useCallback(
    async (id: string) => {
      const anterior = reports;
      setReports((prev) => prev.filter((r) => r.id !== id));
      try {
        await backend.remove(id);
      } catch (e) {
        setReports(anterior);
        throw e;
      }
    },
    [backend, reports],
  );

  const addComment = useCallback(
    (reportId: string, body: string) => backend.addComment(reportId, body),
    [backend],
  );

  const value = useMemo<ReportsState>(
    () => ({ reports, status, load, loadOne, create, update, remove, addComment }),
    [reports, status, load, loadOne, create, update, remove, addComment],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
