import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { TelemetrySink } from './types';
import { mockTelemetrySink } from './mockTelemetrySink';
import { amplifyTelemetrySink } from './amplifyTelemetrySink';

export function getTelemetrySink(): TelemetrySink {
  return AUTH_BACKEND === 'amplify' ? amplifyTelemetrySink : mockTelemetrySink;
}
