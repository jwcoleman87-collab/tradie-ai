import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
const legacyTooling = path.resolve(repository, '../e2e-tooling-20260908');
const useLegacy =
  process.platform === 'win32' &&
  existsSync(path.join(legacyTooling, 'infra-config.json'));
export const toolingRoot = path.resolve(
  process.env.E2E_TOOLING_ROOT ||
    (useLegacy
      ? legacyTooling
      : path.join(repository, 'scripts/review/tooling')),
);
export const infraConfigPath = path.resolve(
  process.env.E2E_INFRA_CONFIG ||
    (useLegacy
      ? path.join(legacyTooling, 'infra-config.json')
      : path.join(repository, 'tmp/review-ci/infra-config.json')),
);
export const evidenceRoot = path.resolve(
  process.env.E2E_EVIDENCE_DIR || path.join(repository, 'evidence'),
);
const systemChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const chromeExecutable =
  process.env.E2E_CHROME_EXECUTABLE ||
  (process.platform === 'win32' && existsSync(systemChrome)
    ? systemChrome
    : undefined);
export function loopbackOrigin(value) {
  const url = new URL(value);
  assert.equal(
    url.protocol,
    'http:',
    'Review services require plain HTTP on loopback',
  );
  assert.equal(
    url.hostname,
    '127.0.0.1',
    'Review services must bind to 127.0.0.1',
  );
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.equal(url.pathname, '/');
  return url.origin;
}
export const appOrigin = loopbackOrigin(
  process.env.E2E_APP_ORIGIN || 'http://127.0.0.1:3108',
);
export const gatewayOrigin = loopbackOrigin(
  process.env.E2E_GATEWAY_ORIGIN || 'http://127.0.0.1:55441',
);

export function readInfraConfig() {
  assert.ok(
    existsSync(infraConfigPath),
    `Missing isolated infrastructure: ${infraConfigPath}. Run start-test-infra.mjs; this is a failure, not a skipped test.`,
  );
  const config = JSON.parse(readFileSync(infraConfigPath, 'utf8'));
  assert.equal(
    config.synthetic,
    true,
    'Only explicitly synthetic configuration is accepted',
  );
  assert.equal(config.database.host, '127.0.0.1');
  assert.match(config.database.database, /^e2e_synthetic(?:_[a-z0-9_]+)?$/);
  loopbackOrigin(config.postgrestUrl);
  loopbackOrigin(config.gatewayUrl);
  return config;
}

export function requireTool(name) {
  const require = createRequire(path.join(toolingRoot, 'package.json'));
  try {
    return require(name);
  } catch (error) {
    throw new Error(
      `Missing review dependency ${name}; run npm ci --prefix scripts/review/tooling. No tests may be skipped.`,
      { cause: error },
    );
  }
}

export function browserLaunchOptions() {
  return {
    headless: true,
    ...(chromeExecutable ? { executablePath: chromeExecutable } : {}),
  };
}
export const pg = requireTool('pg');
export const { chromium } = requireTool('playwright');
