import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { Report, ReportComment, ReportInput } from './types';
import { getReportsBackend } from './getReportsBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface ReportsState {
  reports: Report[];
  status: LoadStatus;
  load: () => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  create: (input: ReportInput) => Promise<Report>;
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

  const addComment = useCallback(
    (reportId: string, body: string) => backend.addComment(reportId, body),
    [backend],
  );

  const value = useMemo<ReportsState>(
    () => ({ reports, status, load, loadOne, create, addComment }),
    [reports, status, load, loadOne, create, addComment],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
