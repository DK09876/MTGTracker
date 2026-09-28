/*
 * The card scanner reads text with Tesseract in the browser. Its worker, its
 * engine (WebAssembly, in the three builds for devices with and without
 * SIMD) and the English model are served from the app itself rather than a
 * CDN, copied here from node_modules before each build. Not committed:
 * public/tesseract is in .gitignore.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'tesseract');
const from = (...p) => path.join(root, 'node_modules', ...p);

fs.mkdirSync(path.join(out, 'lang'), { recursive: true });
const copy = (src, dest) => fs.copyFileSync(src, path.join(out, dest));

copy(from('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js');
for (const core of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  copy(from('tesseract.js-core', core), core);
}
copy(from('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz'));
console.log('Copied Tesseract into public/tesseract');
