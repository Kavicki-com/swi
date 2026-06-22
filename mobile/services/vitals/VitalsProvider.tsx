import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { Vitals, VitalsPhase, WorkerStatus } from './types';
import { getVitalsBackend } from './getVitalsBackend';
import { computePhase } from './phase';
import { deriveStatus } from './deriveStatus';

// How often we poll the backend for a fresh sample.
const DISPLAY_MS = 4000;
// A sample older than this (no newer one arrived) is shown as 'stale'.
const STALE_MS = 120000;
// Freshness re-check cadence — independent of the fetch so 'stale' is reachable
// even when the backend stops producing values (e.g. the 'loading' scenario
// whose promise never resolves).
const TICK_MS = 1000;
const HISTORY_CAP = 20;

interface VitalsState {
  phase: VitalsPhase;
  vitals: Vitals | null;
  status: WorkerStatus;
  lastUpdated: number | null;
  history: Vitals[];
}

const VitalsContext = createContext<VitalsState | null>(null);

export function VitalsProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getVitalsBackend(), []);

  // undefined = nothing received yet (loading); null = backend said empty.
  const [lastValue, setLastValue] = useState<Vitals | null | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);
  const [history, setHistory] = useState<Vitals[]>([]);
  // Bumped by the freshness tick so computePhase re-evaluates 'stale' without a
  // new value. Kept in state (not just a ref) so the recompute re-renders.
  const [now, setNow] = useState(() => Date.now());

  // Avoid overlapping fetches. The 'loading' scenario's promise never resolves,
  // so this guard would stay true forever — that is intentional: we never want
  // to spam getCurrent(), and the freshness tick (separate effect) keeps the UI
  // responsive without depending on this flag.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const v = await backend.getCurrent();
        if (cancelled) return;
        setErrored(false);
        setLastValue(v);
        if (v) {
          setLastUpdated(Date.now());
          setHistory((prev) => [...prev, v].slice(-HISTORY_CAP));
        } else {
          // Explicit empty: record the time so the phase is 'empty', not 'stale'.
          setLastUpdated(Date.now());
        }
      } catch {
        if (cancelled) return;
        setErrored(true);
        setLastUpdated(Date.now());
      } finally {
        if (!cancelled) inFlight.current = false;
      }
    };

    poll();
    const fetchId = setInterval(poll, DISPLAY_MS);
    const tickId = setInterval(() => { if (!cancelled) setNow(Date.now()); }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(fetchId);
      clearInterval(tickId);
    };
  }, [backend]);

  const phase = computePhase({ lastValue, lastUpdated, now, errored, staleMs: STALE_MS });
  const vitals = lastValue ?? null;
  // SAFETY: only ready/stale surface real vitals to the status logic; empty,
  // error and loading collapse to 'unknown' (never a fake 'good').
  const status = deriveStatus(phase === 'ready' || phase === 'stale' ? vitals : null);

  const value = useMemo<VitalsState>(
    () => ({ phase, vitals, status, lastUpdated, history }),
    [phase, vitals, status, lastUpdated, history],
  );
  return <VitalsContext.Provider value={value}>{children}</VitalsContext.Provider>;
}

export function useVitals(): VitalsState {
  const ctx = useContext(VitalsContext);
  if (!ctx) throw new Error('useVitals must be used inside VitalsProvider');
  return ctx;
}
