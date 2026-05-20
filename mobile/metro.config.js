// Metro bundler config. Extends Expo defaults with:
// - Asset extensions for the interactive 3D smartwatch viewer
//   (Smartwatch3D.native.tsx) — glTF binary (glb), glTF JSON (gltf),
//   external binary buffers (bin), and HDR environment maps (hdr).
//   Web bundles a static PNG fallback and does not need these.
// - Symlink resolution enabled so `file:` deps (currently `@kavicki/swi-design-system`
//   pointing to `../../swi-design-system`) work. npm uses symlinks for file:
//   deps on Windows by default; Metro ignores them without this flag.
//   2026-05-18 — added when bumping DS to add labelWeight / labelFamily props.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
