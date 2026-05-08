// Stub for react-native-svg's extractTransform on web.
// The original imports `parse` from `./transform` (a PEG.js CJS module),
// which Vite dev's native ESM cannot interop. SVG transforms are not
// used by SWI Design System components, so a no-op default export is safe.
export default function extractTransform(_props: unknown): null {
  return null
}
