export type LocationSource = 'gps' | 'fallback';
export type LocationPermission = 'granted' | 'denied' | 'undetermined';
export interface LocationState {
  coords: [number, number]; // [lng, lat]
  source: LocationSource;
  permission: LocationPermission;
}
