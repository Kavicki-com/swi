import { AUTH_BACKEND } from '../../lib/featureFlags';

// Only configures Amplify when the flag is 'amplify' AND the generated
// outputs file exists. Until `ampx sandbox` runs, the require throws and we
// no-op — the mock path needs no Amplify init.
export function configureAmplify(): void {
  if (AUTH_BACKEND !== 'amplify') return;
  try {
    const { Amplify } = require('aws-amplify');
    const outputs = require('../../amplify_outputs.json');
    Amplify.configure(outputs);
  } catch (e) {
    console.warn('[amplify] outputs not found; staying unconfigured', e);
  }
}
