export interface Smartwatch3DProps {
  /** Static fallback width (web) and 3D canvas width (native). */
  width: number;
  /** Static fallback height (web) and 3D canvas height (native). */
  height: number;
  /** Auto-rotate when idle; user drag overrides. Defaults to true. */
  autoRotate?: boolean;
  /** Drag-to-rotate around Y axis. Defaults to true. */
  interactive?: boolean;
  /** Model scale multiplier. Defaults to 1. */
  scale?: number;
  testID?: string;
}
