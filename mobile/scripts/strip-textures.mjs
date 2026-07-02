// Patch + strip the bundled smartwatch.glb so it renders on RN + Hermes.
//
// Two things wrong with the source asset:
//   1. Every `bufferViews[i]` is missing the required `buffer` field (it was
//      exported by a tool that defaulted to 0 implicitly). three's GLTFLoader
//      and @gltf-transform both crash dereferencing `json.buffers[undefined]`.
//   2. It has 1 embedded JPEG texture. Hermes has no DOM `Image` /
//      `URL.createObjectURL` / `createImageBitmap`, so any GLTFLoader fails
//      decoding embedded image bytes deep inside loadImageSource.
//
// Fix is purely a JSON-chunk rewrite — the BIN chunk stays byte-identical,
// so any bufferView offsets/lengths remain valid. The image bytes are left
// in the BIN as dead weight (~228KB on a 9.5MB file — not worth shifting
// every offset to reclaim them).
//
// Run once after any change to the source .glb:
//   node scripts/strip-textures.mjs
// Git is the safety net — `git checkout assets/smartwatch.glb` reverts.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.resolve(__dirname, '..', 'assets', 'smartwatch.glb');

// Brushed-aluminium look without textures — slightly cool gray, high
// metallic, low roughness reads as "premium smartwatch case".
const GRAY_BASE_COLOR = [0.72, 0.74, 0.78, 1.0];
const METALLIC = 0.85;
const ROUGHNESS = 0.28;

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // 'JSON' little-endian
const CHUNK_TYPE_BIN = 0x004e4942; // 'BIN\0' little-endian

function readGlb(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error('not a .glb file (bad magic)');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);

  let cursor = 12;
  let json = null;
  let bin = null;
  while (cursor < buf.length) {
    const chunkLength = buf.readUInt32LE(cursor);
    const chunkType = buf.readUInt32LE(cursor + 4);
    const chunkData = buf.subarray(cursor + 8, cursor + 8 + chunkLength);
    if (chunkType === CHUNK_TYPE_JSON) json = chunkData;
    else if (chunkType === CHUNK_TYPE_BIN) bin = chunkData;
    cursor += 8 + chunkLength;
  }
  if (!json) throw new Error('no JSON chunk found');
  return { json, bin };
}

function writeGlb(jsonObj, bin) {
  // JSON chunk must be padded with spaces (0x20) to 4-byte alignment.
  const jsonText = JSON.stringify(jsonObj);
  let jsonBytes = Buffer.from(jsonText, 'utf-8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad > 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);

  // BIN chunk must be padded with zeros to 4-byte alignment.
  let binBytes = bin;
  if (binBytes) {
    const binPad = (4 - (binBytes.length % 4)) % 4;
    if (binPad > 0) binBytes = Buffer.concat([binBytes, Buffer.alloc(binPad, 0x00)]);
  }

  const totalLength =
    12 + // header
    8 + jsonBytes.length + // json chunk header + data
    (binBytes ? 8 + binBytes.length : 0); // bin chunk

  const out = Buffer.alloc(totalLength);
  let p = 0;
  out.writeUInt32LE(GLB_MAGIC, p); p += 4;
  out.writeUInt32LE(2, p); p += 4; // version
  out.writeUInt32LE(totalLength, p); p += 4;

  out.writeUInt32LE(jsonBytes.length, p); p += 4;
  out.writeUInt32LE(CHUNK_TYPE_JSON, p); p += 4;
  jsonBytes.copy(out, p); p += jsonBytes.length;

  if (binBytes) {
    out.writeUInt32LE(binBytes.length, p); p += 4;
    out.writeUInt32LE(CHUNK_TYPE_BIN, p); p += 4;
    binBytes.copy(out, p);
  }

  return out;
}

function main() {
  const beforeBytes = fs.statSync(ASSET).size;
  console.log(`reading ${ASSET}`);
  console.log(`  size before: ${(beforeBytes / 1024 / 1024).toFixed(2)} MB`);

  const inBuf = fs.readFileSync(ASSET);
  const { json: jsonBytes, bin } = readGlb(inBuf);
  const json = JSON.parse(jsonBytes.toString('utf-8'));

  // (1) Fix every bufferView that's missing `buffer`. glTF 2.0 requires it;
  // for this single-buffer .glb the implicit value is 0.
  let patchedBufferViews = 0;
  for (const bv of json.bufferViews || []) {
    if (bv.buffer === undefined) {
      bv.buffer = 0;
      patchedBufferViews += 1;
    }
  }
  console.log(`  patched bufferViews with buffer=0: ${patchedBufferViews}`);

  // (2) Drop image + texture metadata. Bytes stay in the BIN chunk (dead
  // weight, but rewriting offsets isn't worth the complexity for ~228KB).
  const imageCount = (json.images || []).length;
  const textureCount = (json.textures || []).length;
  json.images = [];
  json.textures = [];
  console.log(`  removed images: ${imageCount}, textures: ${textureCount}`);

  // (3) Detach texture refs from every material and replace with PBR factors.
  let patchedMaterials = 0;
  for (const m of json.materials || []) {
    if (!m.pbrMetallicRoughness) m.pbrMetallicRoughness = {};
    const pbr = m.pbrMetallicRoughness;
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;

    pbr.baseColorFactor = GRAY_BASE_COLOR;
    pbr.metallicFactor = METALLIC;
    pbr.roughnessFactor = ROUGHNESS;
    m.emissiveFactor = [0, 0, 0];
    patchedMaterials += 1;
  }
  console.log(`  patched materials: ${patchedMaterials}`);

  const outBuf = writeGlb(json, bin);
  console.log(`writing ${ASSET}`);
  fs.writeFileSync(ASSET, outBuf);

  const afterBytes = fs.statSync(ASSET).size;
  console.log(`  size after:  ${(afterBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('done. reload the Metro bundle to pick up the new asset.');
}

main();
