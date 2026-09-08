import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
function git(args) {
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${repository.replaceAll('\\', '/').replace(/\/$/, '')}`,
      ...args,
    ],
    { cwd: repository, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(
    result.status,
    0,
    'Unable to establish the tested source identity',
  );
  return result.stdout;
}
export function sourceManifest() {
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((file) =>
      /^(app|components|lib|public|scripts|skills|supabase|tests)\//.test(file),
    );
  const files = [...new Set([...tracked, ...untracked])]
    .sort((left, right) => left.localeCompare(right))
    .filter(
      (file) =>
        !/^(docs|evidence|tmp|node_modules|\.github|\.next|\.review-npm-cache)\//.test(
          file,
        ) && !/(^|\/)node_modules\//.test(file),
    )
    .filter((file) => existsSync(path.join(repository, file)))
    .map((file) => ({
      path: file,
      sha256: createHash('sha256')
        .update(readFileSync(path.join(repository, file)))
        .digest('hex'),
    }));
  return {
    capturedAt: new Date().toISOString(),
    checkoutHead: git(['rev-parse', 'HEAD']).trim(),
    scope:
      'Tracked source plus relevant untracked app/components/lib/public/scripts/skills/migrations/tests. Excludes docs, CI wiring, evidence, runtime and dependencies. Hash covers raw file bytes.',
    sourceSha256: createHash('sha256')
      .update(JSON.stringify(files))
      .digest('hex'),
    files,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = sourceManifest();
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      checkoutHead: result.checkoutHead,
      sourceSha256: result.sourceSha256,
      files: result.files.length,
    }),
  );
}
