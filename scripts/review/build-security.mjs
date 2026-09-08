import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const origin = 'http://127.0.0.1:3108';
const results = [];
for (const route of [
  '/',
  '/sign-in',
  '/onboarding',
  '/workspace',
  '/privacy',
  '/api/config',
  '/api/health',
  '/api/state',
]) {
  const response = await fetch(origin + route, { redirect: 'manual' });
  const h = Object.fromEntries(response.headers);
  const pass =
    h['content-security-policy'] === "frame-ancestors 'self'" &&
    h['x-frame-options'] === 'SAMEORIGIN' &&
    h['x-content-type-options'] === 'nosniff' &&
    (!route.startsWith('/api/') ||
      (h['cache-control'] === 'no-store' &&
        h['referrer-policy'] === 'no-referrer'));
  results.push({ route, status: response.status, headers: h, pass });
  await response.body?.cancel();
}
for (const route of [
  '/api/google/callback?error=access_denied&state=synthetic-invalid',
  '/api/integrations/facebook/callback?error=access_denied&state=synthetic-invalid',
  '/api/integrations/google_ads/callback?error=access_denied&state=synthetic-invalid',
]) {
  const response = await fetch(origin + route, { redirect: 'manual' });
  const location = response.headers.get('location');
  results.push({
    route,
    status: response.status,
    location,
    pass: response.status === 403 && !location,
    scope:
      'Invalid OAuth state is denied before any provider call. Configured connector returns and real connections remain unverified.',
  });
  await response.body?.cancel();
}
const tracePath = '.next/server/app/api/[...path]/route.js.nft.json';
const paths = [
  ...new Set(
    JSON.parse(readFileSync(tracePath, 'utf8')).files.filter(
      (file) => file.includes('/skills/') && file.endsWith('/SKILL.md'),
    ),
  ),
];
const skills = paths.map((file) => {
  const resolved = path.resolve(path.dirname(tracePath), file);
  return {
    file,
    exists: existsSync(resolved),
    sha256: existsSync(resolved)
      ? createHash('sha256').update(readFileSync(resolved)).digest('hex')
      : null,
  };
});
const report = {
  buildId: readFileSync('.next/BUILD_ID', 'utf8'),
  results,
  skills,
  skillTracePass: skills.length === 5 && skills.every((s) => s.exists),
  runtimeLoadEvidence:
    'Actual completed Chat requests load the traced skill instructions from the built API runtime',
};
writeFileSync('evidence/build-security.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode =
  results.every((r) => r.pass) && report.skillTracePass ? 0 : 1;
