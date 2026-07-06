import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Report, ReportInput } from './types';
import { getReportsBackend } from './getReportsBackend';

const LIMIT = 4; // Relatórios por página. Demo (10 mock) → 3 páginas, bate com o Figma.

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface ReportsState {
  reports: Report[];
  page: number;
  pageCount: number;
  total: number;
  status: LoadStatus;
  load: (page?: number) => Promise<void>;
  loadOne: (id: string) => Promise<Report | null>;
  create: (input: ReportInput) => Promise<Report>;
}
const ReportsContext = createContext<ReportsState | null>(null);

export function ReportsProvider({ children }: PropsWithChildren) {
  const [reports, setReports] = useState<Report[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const backend = useMemo(() => getReportsBackend(), []);
  const reqSeq = useRef(0);

  const load = useCallback(async (p = 1) => {
    const seq = ++reqSeq.current;
    // Troca de página NÃO pisca a tela inteira: só a 1ª carga (idle) vira 'loading'.
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const { items, total } = await backend.list(p, LIMIT);
      if (seq !== reqSeq.current) return; // uma carga mais nova começou → descarta esta resposta
      setReports(items);
      setTotal(total);
      setPage(p);
      setStatus(total === 0 ? 'empty' : 'ready');
    } catch {
      if (seq !== reqSeq.current) return; // idem: não sobrescreve com erro de carga obsoleta
      setStatus('error');
    }
  }, [backend]);

  const loadOne = useCallback((id: string) => backend.get(id), [backend]);
  const create = useCallback(async (input: ReportInput) => {
    const created = await backend.create(input);
    await load(1); // novo é o mais recente (ordem desc) → volta pra página 1
    return created;
  }, [backend, load]);

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));
  const value = useMemo<ReportsState>(
    () => ({ reports, page, pageCount, total, status, load, loadOne, create }),
    [reports, page, pageCount, total, status, load, loadOne, create],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsState {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error('useReports must be used inside ReportsProvider');
  return ctx;
}
