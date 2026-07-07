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
  update: (id: string, input: ReportUpdateInput) => Promise<Report | null>;
  addComment: (id: string, text: string) => Promise<ReportComment | null>;
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
  // Espelha o update na lista em cache (inbox) pra edição refletir sem reload.
  const update = useCallback(async (id: string, input: ReportUpdateInput) => {
    const updated = await backend.update(id, input);
    if (updated) setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    return updated;
  }, [backend]);
  const addComment = useCallback((id: string, text: string) => backend.addComment(id, text), [backend]);

  const value = useMemo<ReportsState>(
    () => ({ reports, status, load, loadOne, create, update, addComment }),
    [reports, status, load, loadOne, create, update, addComment],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
