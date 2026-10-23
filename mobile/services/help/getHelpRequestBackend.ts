import { DATA_BACKEND } from '../../lib/featureFlags';
import { apiHelpRequestBackend } from './apiHelpRequestBackend';
import { mockHelpRequestBackend } from './mockHelpRequestBackend';
import type { HelpRequestBackend } from './types';

// Honra a flag DATA_BACKEND, como as outras fatias.
export function getHelpRequestBackend(): HelpRequestBackend {
  return DATA_BACKEND === 'api' ? apiHelpRequestBackend : mockHelpRequestBackend;
}
