import {
  createContext, useContext, useEffect, useState,
  type PropsWithChildren,
} from 'react';
import * as Location from 'expo-location';
import { resolveCoords } from './resolveCoords';
import type { LocationPermission, LocationState } from './types';

const LocationContext = createContext<LocationState | null>(null);

// Initial: fallback coords, permission not yet asked.
const INITIAL: LocationState = { ...resolveCoords(null), permission: 'undetermined' };

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

        if (status !== 'granted') {
          // Denied/undetermined → stay on the mock fallback, record the status.
          setState({ ...resolveCoords(null), permission });
          return;
        }

        // Reflect the granted permission immediately (fallback coords until the
        // first fix lands), then stream real positions.
        setState({ ...resolveCoords(null), permission });
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
          (pos) => {
            if (cancelled) return;
            setState({
              ...resolveCoords([pos.coords.longitude, pos.coords.latitude]),
              permission,
            });
          },
        );
        // The watch may have started after unmount (async gap) — clean up.
        if (cancelled) {
          subscription.remove();
          subscription = null;
        }
      } catch {
        // No geolocation (e.g. web) or any runtime error → fallback, denied.
        if (cancelled) return;
        setState({ ...resolveCoords(null), permission: 'denied' });
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
