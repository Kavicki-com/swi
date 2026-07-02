// Metro bundler config. Extends Expo defaults with:
// - Asset extensions for the interactive 3D smartwatch viewer
//   (Smartwatch3D.native.tsx) — glTF binary (glb), glTF JSON (gltf),
//   external binary buffers (bin), and HDR environment maps (hdr).
//   Web bundles a static PNG fallback and does not need these.
//
// REMOVIDO 2026-05-25: `resolver.unstable_enableSymlinks = true` era vestígio
// de quando o DS apontava pra `file:../../swi-design-system` (symlink dev).
// Agora apontamos pra `.tgz` no vendor/, então flag é desnecessária — e o
// `expo-doctor` (pré-flight do EAS build) aborta o build em produção
// reclamando do override. Sem o flag, doctor passa e build completa.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');

module.exports = config;
