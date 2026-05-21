// React 19 moved JSX from the global namespace into `React.JSX`, which broke
// @react-three/fiber@8's `declare global { namespace JSX { interface
// IntrinsicElements extends ThreeElements } }` augmentation — tsc no longer
// sees the three intrinsics (primitive, ambientLight, directionalLight, ...).
// This shim re-augments the React 19 namespace so JSX still type-checks.
//
// Remove this file once we upgrade to @react-three/fiber@9 (which targets
// React 19 natively and uses the React.JSX namespace by default).
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
