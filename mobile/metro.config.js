// Metro bundler config. Extends Expo's defaults to recognize `.glb`/`.gltf`
// as binary assets so `require('./smartwatch.glb')` resolves to a URI in both
// native Metro and the web bundler. Without this, GLTFLoader gets `undefined`.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'glb',
  'gltf',
  'bin',
  'hdr',
];

module.exports = config;
