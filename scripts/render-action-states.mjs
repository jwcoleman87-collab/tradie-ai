import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, 'work/d10');
await fs.mkdir(work, { recursive: true });
const source = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionStatusChip, ActionOutcome } from './components/action-status';
import { MessageCopy } from './components/message-copy';
import { actionState } from './lib/action-state';
import { financeDisclosure } from './lib/server/record-context';
const base = { id:'sample', workspace_id:'sample', conversation_id:'sample', connection_id:null, agent:'social', action_type:'facebook.publish', summary:'Sample Facebook post', payload:{}, expires_at:'2099-09-06T00:00:00Z', error_code:null, execution_result:null, created_at:'2026-09-05T00:00:00Z' };
const samples = [
  {...base,status:'waiting_approval'},
  {...base,status:'approved',approved_at:'2026-09-05T00:01:00Z'},
  {...base,status:'executing',approved_at:'2026-09-05T00:01:00Z',lease_until:'2099-09-06T00:00:00Z'},
  {...base,status:'completed',approved_at:'2026-09-05T00:01:00Z',executed_at:'2026-09-05T00:01:05Z',execution_result:{url:'https://www.facebook.com/123_456',published:true}},
  {...base,status:'failed',error_code:'FACEBOOK_REJECTED'},
  {...base,status:'failed',error_code:'PUBLICATION_UNCERTAIN'},
  {...base,status:'failed',error_code:'CONNECTION_CHANGED',publication_status:'confirmed',publication_receipt:{url:'https://www.facebook.com/123_456'},publication_confirmed_at:'2026-09-05T00:01:05Z'},
  {...base,summary:'Sample Calendar booking',action_type:'calendar.create',status:'failed',error_code:'RECONNECT_REQUIRED'},
];
const disclosure = financeDisclosure({records:[],coverage:{returnedCount:15,totalMatchingCount:63,truncatedBodyCount:2,selection:'newest_active_matching_kinds',periodCoverage:'not_established'}});
const body = <main className="app-shell d10-preview"><header><p className="eyebrow">WORKBENCH · SET-OUT SHEET</p><h1>D10 — Action states</h1><p>Sample records drawn with the application's actual state components. Preview controls do not execute work.</p></header><section className="state-grid">{samples.map((action,i)=><article className="action-card" key={i}><ActionStatusChip action={action}/><h2>{action.summary}</h2><ActionOutcome action={action} timeZone="Australia/Sydney"/><div className="sample-controls">{action.status==='waiting_approval'?<><button disabled>Not yet</button><button disabled>Approve &amp; publish</button></>:actionState(action).retry?<button disabled>{actionState(action).retry}</button>:null}</div></article>)}</section><section><h2>Finance — coverage belongs with the answer</h2><MessageCopy text={disclosure + '\\n\\nThe supplied diesel receipts add to AUD 200. This subtotal does not include records outside the supplied sample.'}/></section><footer>Website card: <strong>Draft changes for your website</strong></footer></main>;
process.stdout.write(renderToStaticMarkup(body));
`;
const bundle = path.join(work, 'render.cjs');
await build({
  absWorkingDir: root,
  stdin: { contents: source, loader: 'tsx', resolveDir: root },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { '@': root },
});
const body = execFileSync(process.execPath, [bundle], {
  cwd: root,
  encoding: 'utf8',
});
const globals = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
const tokens = globals.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] || '';
const styles = await fs.readFile(path.join(root, 'app/setout.css'), 'utf8');
const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workbench D10 — Action states</title><style>${tokens}\n${styles}\n*{box-sizing:border-box}body{margin:0;background:#ebebeb;color:#030d18;font:16px/1.5 Arial,sans-serif}.d10-preview{display:block;max-width:1100px;margin:auto;padding:32px}.d10-preview header{margin-bottom:24px}.d10-preview h1{font-size:32px;line-height:1.2}.d10-preview h2{font-size:18px;margin:16px 0 8px}.eyebrow{font-size:14px;letter-spacing:.08em}.state-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.d10-preview .action-card{background:white;border:1px solid #d9dcde;border-radius:8px;padding:20px}.d10-preview .action-status-chip{display:inline-flex}.sample-controls{display:flex;gap:8px;margin-top:16px}.sample-controls button{padding:12px 16px;border:1px solid #8e9195;border-radius:6px;color:#030d18;background:#f1b505;font-size:14px;opacity:1}.d10-preview>section+section,.d10-preview footer{margin-top:28px}.d10-preview .message-copy{background:white;padding:20px;border-radius:8px}.d10-preview a{pointer-events:none}.message-body{white-space:pre-wrap}@media(max-width:640px){.d10-preview{padding:16px}.state-grid{grid-template-columns:1fr}.d10-preview h1{font-size:26px}}@media(prefers-contrast:more){.action-status-chip{border-width:2px}}
</style></head><body>${body}</body></html>`;
const destination = path.join(root, 'docs/d10-action-states.html');
await fs.writeFile(destination, html);
process.stdout.write(`D10 preview written: ${destination}\n`);
