import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  // Relative assets work on repository Pages, account Pages and custom domains.
  base:'./',
  plugins:[{
    name:'verify-ring-assets',
    buildStart(){
      const root=new URL('./public/generated/open-dome-ring/',import.meta.url);
      const model=readFileSync(new URL('ring.glb',root));
      const meta=JSON.parse(readFileSync(new URL('envelope-base.json',root)));
      if(createHash('sha256').update(model).digest('hex')!==meta.base_sha256)
        throw Error('The envelope metadata does not match the base ring GLB.');
    },
  }],
});
