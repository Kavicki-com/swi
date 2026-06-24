import { generateClient } from 'aws-amplify/data';
import type { EvacuationBackend, RouteSnapshot } from './types';
import { SITE_ROUTE } from './types';

const client = generateClient();
const NOT_READY = (op: string) => new Error(`amplifyEvacuationBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyEvacuationBackend: EvacuationBackend = {
  async getRoute(): Promise<RouteSnapshot> {
    // Deploy: const { data } = await client.queries.getEvacuationRoute({
    //   originLng: SITE_ROUTE.origin[0], originLat: SITE_ROUTE.origin[1],
    //   destLng: SITE_ROUTE.destination[0], destLat: SITE_ROUTE.destination[1],
    // }); → coage data.waypoints (json/unknown no boundary) → [number,number][].
    void client; void SITE_ROUTE;
    throw NOT_READY('getRoute');
  },
};
