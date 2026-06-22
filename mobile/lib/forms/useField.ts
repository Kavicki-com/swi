// Small form-field hook. Wraps value + touched state + a validator and
// exposes `bind()` ready to spread into the DS `<Input>`. Error text only
// renders after the user has blurred the field once — pristine fields stay
// quiet even if invalid.

import { useCallback, useMemo, useState } from 'react';
import type { ValidationResult } from '../validation/validators';

export interface FieldBindProps {
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  description?: string;
  descriptionVariant?: 'default' | 'success' | 'error' | 'warning';
}

export interface UseFieldOptions {
  initial?: string;
  validator: (v: string) => ValidationResult;
  mask?: (v: string) => string;
}

export interface Field {
  value: string;
  touched: boolean;
  isValid: boolean;
  error: string | undefined;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  setValue: (v: string) => void;
  setTouched: (t: boolean) => void;
  reset: () => void;
  bind: () => FieldBindProps;
}

export function useField({ initial = '', validator, mask }: UseFieldOptions): Field {
  const [value, setValueState] = useState(initial);
  const [touched, setTouchedState] = useState(false);

  const result = useMemo(() => validator(value), [validator, value]);
  const isValid = result.valid;
  const error = touched && !isValid ? result.error : undefined;

  const onChangeText = useCallback(
    (v: string) => setValueState(mask ? mask(v) : v),
    [mask],
  );
  const onBlur = useCallback(() => setTouchedState(true), []);
  const setValue = useCallback(
    (v: string) => setValueState(mask ? mask(v) : v),
    [mask],
  );
  const setTouched = useCallback((t: boolean) => setTouchedState(t), []);
  const reset = useCallback(() => {
    setValueState(initial);
    setTouchedState(false);
  }, [initial]);

  const bind = useCallback(
    (): FieldBindProps => ({
      value,
      onChangeText,
      onBlur,
      ...(error
        ? { description: error, descriptionVariant: 'error' as const }
        : {}),
    }),
    [value, onChangeText, onBlur, error],
  );

  return {
    value,
    touched,
    isValid,
    error,
    onChangeText,
    onBlur,
    setValue,
    setTouched,
    reset,
    bind,
  };
}
