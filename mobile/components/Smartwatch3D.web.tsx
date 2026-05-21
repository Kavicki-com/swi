import { Image } from 'react-native';
import type { Smartwatch3DProps } from './Smartwatch3D.types';

/**
 * Web fallback for the interactive 3D smartwatch viewer.
 *
 * The native implementation (.native.tsx) requires expo-gl, which has no
 * web counterpart. Web bundles render the static PNG at the same dimensions
 * so the onboarding flow remains visually consistent.
 */
export function Smartwatch3D({ width, height, testID }: Smartwatch3DProps) {
  return (
    <Image
      source={require('../assets/smartwatch.png')}
      resizeMode="contain"
      style={{ width, height }}
      testID={testID}
    />
  );
}
