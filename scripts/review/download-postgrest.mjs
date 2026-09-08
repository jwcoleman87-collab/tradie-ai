import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repository } from './review-env.mjs';

// Digests verified against the official v16.2 release metadata on 2026-09-08.
const releases = {
  'linux-x64': [
    'postgrest-v16.2-linux-static-x86-64.tar.xz',
    '4712595baae0f5d84a527d55a11166d6bf4d9b0f1d102505c5e9d59219787f08',
  ],
  'win32-x64': [
    'postgrest-v16.2-windows-x86-64.zip',
    'f27c3fd12bb6f3a2ff6f7b3283d4fe63ef2a74f718c030cdd387f768ceb15ab9',
  ],
};
const selected = releases[`${process.platform}-${process.arch}`];
assert.ok(
  selected,
  'No pinned PostgREST archive for this platform; provide E2E_POSTGREST_BINARY explicitly',
);
const [archiveName, expected] = selected;
const destination = path.resolve(
  process.env.E2E_BINARY_DIRECTORY ||
    path.join(repository, 'tmp/review-ci/bin'),
);
mkdirSync(destination, { recursive: true });
const response = await fetch(
  `https://github.com/PostgREST/postgrest/releases/download/v16.2/${archiveName}`,
  { signal: AbortSignal.timeout(120000) },
);
assert.ok(
  response.ok,
  `PostgREST download failed with HTTP ${response.status}`,
);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  expected,
  'PostgREST archive checksum mismatch',
);
const archive = path.join(destination, archiveName);
writeFileSync(archive, bytes);
// Both supported platforms provide bsdtar/GNU tar; no shell interpolation.
const extract = spawnSync('tar', ['-xf', archive, '-C', destination], {
  stdio: 'inherit',
  windowsHide: true,
});
assert.equal(
  extract.status,
  0,
  'Unable to extract the checksum-verified PostgREST archive',
);
const executable = path.join(
  destination,
  process.platform === 'win32' ? 'postgrest.exe' : 'postgrest',
);
assert.ok(
  existsSync(executable),
  'PostgREST archive did not contain its expected executable',
);
if (process.platform !== 'win32') chmodSync(executable, 0o755);
console.log(
  JSON.stringify({ version: '16.2', executable, archiveSha256: expected }),
);
