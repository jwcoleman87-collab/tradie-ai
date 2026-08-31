import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

it('executes the real model transport inside Workers, preserving redirect protection', async () => {
  const result = await build({
    stdin: {
      contents: `
      import {modelFetch} from './lib/server/model-fetch';
      export default {async fetch() {
        let legacyRejected = false;
        try {new Request('https://api.openai.com/v1/responses', {redirect:'error'});} catch {legacyRejected=true;}
        const original = globalThis.fetch;
        let redirect; let calls=0;
        globalThis.fetch=async(url,init)=>{
          calls++;
          // This is the actual workerd Request constructor, not Node's permissive one.
          redirect=new Request(url,init).redirect;
          return new Response(null,{status:302,headers:{location:'https://untrusted.invalid'}});
        };
        try { const trace=[]; const response=await modelFetch('https://api.openai.com/v1/responses',{},trace);
          return Response.json({legacyRejected,redirect,calls,status:response.status,trace});
        } finally {globalThis.fetch=original;}
      }};`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: '2026-08-08',
      script: result.outputFiles[0].text,
    }),
  );
  try {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(await response.json()).toMatchObject({
      legacyRejected: true,
      redirect: 'manual',
      calls: 1,
      status: 302,
    });
  } finally {
    await mf.dispose();
  }
});
