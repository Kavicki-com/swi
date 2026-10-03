import {
  createContext, useContext, useEffect, useState,
  type PropsWithChildren,
} from 'react';
import * as Location from 'expo-location';
import type { LocationPermission, LocationState } from './types';

const LocationContext = createContext<LocationState | null>(null);

// Initial: no position, permission not yet asked.
const INITIAL: LocationState = { coords: null, permission: 'undetermined' };

export function LocationProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<LocationState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const start = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        const permission = status as LocationPermission;
        if (cancelled) return;

        // Reflect the permission immediately. Position stays null until the
        // first fix lands (and for good when the permission was not granted).
        setState({ coords: null, permission });
        if (status !== 'granted') return;

        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
          (pos) => {
            if (cancelled) return;
            setState({ coords: [pos.coords.longitude, pos.coords.latitude], permission });
          },
        );
        // The watch may have started after unmount (async gap) — clean up.
        if (cancelled) {
          subscription.remove();
          subscription = null;
        }
      } catch {
        // No geolocation (e.g. web) or any runtime error → no position, denied.
        if (cancelled) return;
        setState({ coords: null, permission: 'denied' });
      }
    };

    start();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return <LocationContext.Provider value={state}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside LocationProvider');
  return ctx;
}
