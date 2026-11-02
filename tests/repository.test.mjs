import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

test('all runtime imports stay inside this repository or use Three.js',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),src=resolve(root,'src');
  const sources=(await readdir(src,{recursive:true})).filter(path=>path.endsWith('.js'));
  assert.ok(sources.length>=5);
  for(const path of sources){
    const text=await readFile(resolve(src,path),'utf8');
    for(const [,id] of text.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
      if(id==='three'||id.startsWith('three/'))continue;
      assert.ok(id.startsWith('.'),`Unexpected runtime package: ${id}`);
      const target=resolve(dirname(resolve(src,path)),id.split('?')[0]);
      assert.ok(!relative(root,target).startsWith('..'),`Import outside the repository: ${id}`);
      await access(target);
    }
  }
});
