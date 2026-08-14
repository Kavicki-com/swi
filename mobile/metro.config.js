// Metro bundler config. Extends Expo defaults with:
// - Asset extensions for the interactive 3D smartwatch viewer
//   (Smartwatch3D.native.tsx) — glTF binary (glb), glTF JSON (gltf),
//   external binary buffers (bin), and HDR environment maps (hdr).
//   Web bundles a static PNG fallback and does not need these.
//
// Sem `resolver.unstable_enableSymlinks`. O design system vem de um `.tgz` em
// vendor/, não de symlink de desenvolvimento, então o flag não tem função. Pior
// que isso: o `expo-doctor`, que roda como pré-flight do build no EAS, aborta o
// build de produção reclamando do override.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');

module.exports = config;
