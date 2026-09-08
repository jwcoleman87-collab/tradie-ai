import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceManifest } from './source-manifest.mjs';

// One foreground owner supervises every helper. A missing tool/service or failing
// assertion returns nonzero; no critical suite uses a skip guard.
const repository = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(repository);
process.env.E2E_INFRA_CONFIG ||= path.join(
  repository,
  'tmp/review-ci/infra-config.json',
);
process.env.E2E_TOOLING_ROOT ||= path.join(
  repository,
  'scripts/review/tooling',
);
process.env.E2E_EVIDENCE_DIR ||= path.join(repository, 'evidence/ci');
const {
  infraConfigPath,
  evidenceRoot,
  appOrigin,
  gatewayOrigin,
  chromium,
  browserLaunchOptions,
  readInfraConfig,
} = await import('./review-env.mjs');
mkdirSync(path.dirname(infraConfigPath), { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });
const privateRuntime = path.join(evidenceRoot, 'runtime');
mkdirSync(privateRuntime, { recursive: true });
const summary = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  nativeDatabaseRequired: true,
  browserRequired: true,
  mocked: ['Auth', 'Storage', 'AI'],
  checks: [],
};
const children = [];
const running = (child) => child.exitCode === null && child.signalCode === null;
const sensitiveValues = new Set([
  'synthetic-local-e2e-postgres',
  'synthetic-local-authenticator',
  'synthetic-local-e2e-jwt-secret-20260908-DO-NOT-USE-EXTERNALLY',
  'SyntheticReviewPassword123',
]);
function publicDiagnostics() {
  const destination = path.join(evidenceRoot, 'diagnostics');
  mkdirSync(destination, { recursive: true });
  const sources = [privateRuntime, path.dirname(infraConfigPath)];
  for (const directory of new Set(sources)) {
    for (const file of readdirSync(directory).filter((name) =>
      name.endsWith('.log'),
    )) {
      let text = readFileSync(path.join(directory, file), 'utf8');
      text = text
        .replace(
          /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
          'REDACTED_SYNTHETIC_JWT',
        )
        .replace(
          /review-refresh-[a-f0-9-]+/g,
          'REDACTED_SYNTHETIC_REFRESH_TOKEN',
        );
      for (const value of sensitiveValues)
        if (value) text = text.replaceAll(value, 'REDACTED_SYNTHETIC_VALUE');
      writeFileSync(path.join(destination, file), text);
    }
  }
}
const persist = () =>
  writeFileSync(
    path.join(evidenceRoot, 'critical-e2e.json'),
    JSON.stringify(summary, null, 2),
  );
function start(name, executable, args, env = process.env, ipc = false) {
  const child = spawn(executable, args, {
    cwd: repository,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])],
  });
  const log = (chunk) =>
    appendFileSync(path.join(privateRuntime, `${name}.log`), chunk);
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('error', (error) => log(`${error.message}\n`));
  children.push(child);
  return child;
}
async function command(name, script, args = [], env = process.env) {
  assert.ok(
    existsSync(path.join(repository, script)),
    `Missing mandatory critical suite: ${script}`,
  );
  const child = start(name, process.execPath, [script, ...args], env);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  summary.checks.push({ name, script, exitCode: code, passed: code === 0 });
  persist();
  console.log(`${name}: ${code === 0 ? 'passed' : 'FAILED'}`);
  assert.equal(
    code,
    0,
    `${name} failed; private diagnostic log retained, no suite skipped`,
  );
}
async function sanitizeTrace() {
  const raw = path.join(privateRuntime, 'final-raw-trace.zip');
  const sanitized = path.join(evidenceRoot, 'final/browser-trace.zip');
  assert.ok(existsSync(raw), 'Missing mandatory browser trace');
  const python =
    process.env.E2E_PYTHON ||
    (process.platform === 'win32' ? 'python' : 'python3');
  for (const args of [
    ['scripts/review/sanitize-trace.py', raw, sanitized],
    ['-m', 'zipfile', '-t', sanitized],
  ]) {
    const child = start('trace-sanitization', python, args);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(
      code,
      0,
      'Browser trace sanitization/integrity verification failed',
    );
  }
  summary.sanitizedTrace = 'final/browser-trace.zip';
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function healthy(child, url) {
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(
      running(child),
      true,
      `Helper exited before readiness: ${url}`,
    );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* bounded readiness retry */
    }
    await pause(100);
  }
  throw new Error(`Required local service unavailable: ${url}`);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.toReversed()) {
    if (!running(child)) continue;
    // SIGTERM does not invoke Node handlers on Windows. Infrastructure accepts
    // IPC shutdown and uses its own pg_ctl path before this owner exits.
    if (child.connected) child.send({ stop: true });
    else child.kill('SIGTERM');
    for (let attempt = 0; attempt < 150 && running(child); attempt++)
      await pause(100);
    if (running(child)) child.kill('SIGKILL');
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });

try {
  const source = sourceManifest();
  summary.sourceSha256 = source.sourceSha256;
  summary.checkoutHead = source.checkoutHead;
  writeFileSync(
    path.join(evidenceRoot, 'source-manifest.json'),
    JSON.stringify(source, null, 2),
  );
  assert.ok(
    existsSync(path.join(repository, '.next/BUILD_ID')),
    'Missing production build; run npm run build first',
  );
  summary.buildId = readFileSync(
    path.join(repository, '.next/BUILD_ID'),
    'utf8',
  );
  // Fail before creating a database if the mandatory browser is unavailable.
  const browser = await chromium.launch(browserLaunchOptions());
  await browser.close();
  const infra = start(
    'infrastructure',
    process.execPath,
    ['scripts/review/start-test-infra.mjs'],
    process.env,
    true,
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error('Isolated infrastructure startup deadline exceeded')),
      90000,
    );
    infra.once('message', (message) => {
      clearTimeout(timer);
      if (message.ready) resolve();
      else reject(new Error('Invalid infrastructure readiness'));
    });
    infra.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    infra.once('exit', () => {
      clearTimeout(timer);
      reject(
        new Error(
          'Isolated infrastructure failed; inspect private diagnostics. No tests skipped.',
        ),
      );
    });
  });
  const config = readInfraConfig();
  for (const value of [
    config.anonKey,
    config.serviceRoleKey,
    config.jwtSecret,
    config.database.password,
  ])
    sensitiveValues.add(value);
  const gateway = start('gateway', process.execPath, [
    'scripts/review/gateway.mjs',
  ]);
  await healthy(gateway, `${gatewayOrigin}/review/control`);
  const appEnvironment = {
    ...process.env,
    APP_ORIGIN: appOrigin,
    SUPABASE_URL: gatewayOrigin,
    SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    OPENAI_API_KEY: 'synthetic-review-provider-key',
    OPENAI_MODEL: 'gpt-5-mini',
    ANTHROPIC_API_KEY: '',
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AI_REQUEST_TIMEOUT_MS: '1000',
    WEB_SEARCH_ENABLED: 'false',
    FACEBOOK_PUBLISHING_ENABLED: 'false',
    GOOGLE_CLIENT_ID: 'synthetic-google-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    GOOGLE_ADS_CLIENT_ID: 'synthetic-google-ads-client',
    GOOGLE_ADS_CLIENT_SECRET: 'synthetic-google-ads-secret',
    GOOGLE_ADS_DEVELOPER_TOKEN: '',
    META_APP_ID: 'synthetic-meta-app',
    META_APP_SECRET: 'synthetic-meta-secret',
    META_LOGIN_CONFIG_ID: 'synthetic-meta-config',
  };
  for (const [name, value] of Object.entries(appEnvironment)) {
    if (/(KEY|SECRET|TOKEN|PASSWORD)$/.test(name) && value)
      sensitiveValues.add(value);
  }
  const app = start(
    'application',
    process.execPath,
    [
      '--import',
      pathToFileURL(
        path.join(repository, 'scripts/review/provider-preload.mjs'),
      ).href,
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      new URL(appOrigin).port,
    ],
    appEnvironment,
  );
  await healthy(app, `${appOrigin}/api/config`);
  await command('native-database', 'scripts/review/database-concurrency.mjs');
  await command(
    'native-onboarding-claims',
    'scripts/review/native-onboarding-claims.mjs',
  );
  await command(
    'native-account-quotas',
    'scripts/review/native-account-quotas.mjs',
  );
  await command(
    'onboarding-integrity',
    'scripts/review/http-onboarding-integrity.mjs',
    ['--phase=final'],
  );
  await command('tenant-isolation', 'scripts/review/http-isolation.mjs', [], {
    ...process.env,
    E2E_CANDIDATE_LABEL: 'ci',
  });
  await command('runtime-recovery', 'scripts/review/runtime-recovery.mjs');
  await command('browser-journey', 'scripts/review/browser-journey.mjs', [
    'final',
  ]);
  await command('browser-edge-cases', 'scripts/review/browser-edge-cases.mjs');
  await command('built-security', 'scripts/review/build-security.mjs');
  await sanitizeTrace();
  assert.equal(
    sourceManifest().sourceSha256,
    summary.sourceSha256,
    'Source files changed during verification; rerun the actual final source',
  );
  summary.passed = true;
} catch (error) {
  summary.passed = false;
  summary.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop();
  const trace = path.join(privateRuntime, 'final-raw-trace.zip');
  if (
    !summary.sanitizedTrace &&
    existsSync(trace) &&
    statSync(trace).mtimeMs >= Date.parse(summary.startedAt)
  ) {
    try {
      await sanitizeTrace();
    } catch (error) {
      summary.traceError = error.message;
      summary.passed = false;
      process.exitCode = 1;
    }
  }
  publicDiagnostics();
  summary.finishedAt = new Date().toISOString();
  persist();
}
