import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root=new URL('../dist/',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
assert.match(html,/<html lang="en">/);
assert.ok(!/<header\b|id="summary"|data-view=/.test(html),'Header must be removed');
for(const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g))await readFile(new URL(match[1],root));
const meta=JSON.parse(await readFile(new URL('generated/open-dome-ring/envelope-base.json',root)));
const model=await readFile(new URL('generated/open-dome-ring/ring.glb',root));
assert.equal(createHash('sha256').update(model).digest('hex'),meta.base_sha256);
assert.equal((await readFile(new URL('lt-display-lut.bin',root))).length,8_000_000);
for(const file of await readdir(new URL('../src/',import.meta.url),{recursive:true})){
  assert.ok(!/mesher|packed-scene|marching|transvoxel|diamond-library|gpu-surface/.test(file),file);
  if(!file.endsWith('.js'))continue;
  const source=await readFile(new URL('../src/'+file.replaceAll('\\','/'),import.meta.url),'utf8');
  assert.ok(!/ring-sdf-editor|\.\.\/\.\.\/editor|createEditorRenderer|GpuMesher/.test(source),`Unexpected parent dependency: ${file}`);
}
console.log('Standalone build verified: model, English UI and self-contained renderer.');
