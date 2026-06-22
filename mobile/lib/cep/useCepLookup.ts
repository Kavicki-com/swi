// CEP lookup via cep-promise (4-provider fallback). Use in onBlur of the CEP
// field after the masked value reaches 8 digits.
//
// Concurrency: keeps a requestIdRef so a stale resolve from a previous CEP
// (user re-typed mid-flight) doesn't overwrite the fields a newer lookup
// already resolved with.

import { useCallback, useRef, useState } from 'react';
import { cep } from './cepPromiseClient';

export interface CepAddress {
  cep: string;
  state: string;
  city: string;
  street: string;
  neighborhood: string;
}

export interface UseCepLookupOptions {
  onSuccess?: (addr: CepAddress) => void;
  onError?: (message: string) => void;
}

export interface UseCepLookupReturn {
  loading: boolean;
  lookup: (rawCep: string) => Promise<void>;
}

const digitsOnly = (v: string): string => v.replace(/\D/g, '');

export function useCepLookup({
  onSuccess,
  onError,
}: UseCepLookupOptions = {}): UseCepLookupReturn {
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const lookup = useCallback(
    async (rawCep: string) => {
      const d = digitsOnly(rawCep);
      if (d.length !== 8) return;
      const myId = ++requestIdRef.current;
      setLoading(true);
      try {
        const result = await cep(d, { timeout: 6000 });
        if (myId !== requestIdRef.current) return;
        onSuccess?.({
          cep: result.cep,
          state: result.state,
          city: result.city,
          street: result.street,
          neighborhood: result.neighborhood,
        });
      } catch {
        if (myId !== requestIdRef.current) return;
        onError?.('CEP não encontrado');
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    },
    [onSuccess, onError],
  );

  return { loading, lookup };
}
