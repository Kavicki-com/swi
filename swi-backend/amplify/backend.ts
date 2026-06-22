import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({ auth, data });

// DynamoDB TTL on raw telemetry (cost mitigation). Amplify Gen 2 has no
// schema-level TTL, so set it on the underlying CFN table.
const tables = backend.data.resources.cfnResources.amplifyDynamoDbTables;
for (const name of ['VitalsSample', 'LocationSample']) {
  const t = tables[name];
  if (t) t.timeToLiveAttribute = { attributeName: 'expiresAt', enabled: true };
}
