// Stub for react-native/Libraries/Utilities/codegenNativeComponent on web.
// react-native-svg's Fabric components import this deep RN path to register
// native views. On web, no native registration is possible or needed; return
// a no-op component that renders nothing. The DS components that use SVG
// filters won't render correctly with this stub, but for the S0 walking
// skeleton (no DS components rendered yet), this avoids the dev-server crash.
import type { ComponentType } from 'react'

export default function codegenNativeComponent<P>(_name: string): ComponentType<P> {
  const Stub: ComponentType<P> = () => null
  return Stub
}
