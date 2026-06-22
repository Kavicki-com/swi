// Quick GLB structure dump. Parses the .glb header + JSON chunk manually
// (no library) and prints counts + buffer references, so we can see if
// json.bufferViews points at indices outside json.buffers.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.resolve(__dirname, '..', 'assets', 'smartwatch.glb');

const buf = fs.readFileSync(ASSET);
const magic = buf.subarray(0, 4).toString('ascii');
const version = buf.readUInt32LE(4);
const totalLength = buf.readUInt32LE(8);
console.log(`magic=${magic} version=${version} totalLength=${totalLength} fileSize=${buf.length}`);

const jsonChunkLength = buf.readUInt32LE(12);
const jsonChunkType = buf.subarray(16, 20).toString('ascii');
const jsonText = buf.subarray(20, 20 + jsonChunkLength).toString('utf-8');
console.log(`chunk0: type=${jsonChunkType} length=${jsonChunkLength}`);

let binChunkLength = 0;
let binChunkType = 'NONE';
const binChunkStart = 20 + jsonChunkLength;
if (binChunkStart < buf.length) {
  binChunkLength = buf.readUInt32LE(binChunkStart);
  binChunkType = buf.subarray(binChunkStart + 4, binChunkStart + 8).toString('ascii');
  console.log(`chunk1: type=${binChunkType} length=${binChunkLength}`);
}

const json = JSON.parse(jsonText);
console.log('---');
console.log(`buffers (${(json.buffers || []).length}):`);
(json.buffers || []).forEach((b, i) => {
  console.log(`  [${i}] byteLength=${b.byteLength} uri=${b.uri ?? '(embedded)'}`);
});
console.log(`bufferViews (${(json.bufferViews || []).length}):`);
const bufferIndicesReferenced = new Set();
(json.bufferViews || []).forEach((bv, i) => {
  bufferIndicesReferenced.add(bv.buffer);
  if (i < 5 || bv.buffer !== 0) {
    console.log(`  [${i}] buffer=${bv.buffer} byteOffset=${bv.byteOffset ?? 0} byteLength=${bv.byteLength}`);
  }
});
console.log(`unique buffer indices referenced by bufferViews: ${[...bufferIndicesReferenced].join(', ')}`);
console.log(`images (${(json.images || []).length}):`);
(json.images || []).slice(0, 5).forEach((img, i) => {
  console.log(`  [${i}] uri=${img.uri ?? '(none)'} bufferView=${img.bufferView ?? '(none)'} mimeType=${img.mimeType ?? '(none)'}`);
});
console.log(`textures: ${(json.textures || []).length}`);
console.log(`materials: ${(json.materials || []).length}`);
console.log(`meshes: ${(json.meshes || []).length}`);
console.log(`nodes: ${(json.nodes || []).length}`);
