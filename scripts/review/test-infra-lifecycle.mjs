import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {
  evidenceRoot,
  infraConfigPath,
  pg,
  readInfraConfig,
} from './review-env.mjs';

// Integration check for a fresh owned cluster, including IPC cleanup on Windows.
assert.ok(
  process.env.E2E_PG_BIN,
  'Lifecycle check requires its own native cluster',
);
mkdirSync(path.dirname(infraConfigPath), { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });
const child = spawn(process.execPath, ['scripts/review/start-test-infra.mjs'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
const log = (chunk) =>
  appendFileSync(
    path.join(path.dirname(infraConfigPath), 'lifecycle-private.log'),
    chunk,
  );
child.stdout.on('data', log);
child.stderr.on('data', log);
const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  checks: [],
};
let config;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Infrastructure lifecycle readiness timed out')),
      90000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Infrastructure exited ${code} before readiness`));
    });
    child.once('message', (message) => {
      clearTimeout(timer);
      if (message.ready) resolve();
      else reject(new Error('Invalid readiness message'));
    });
  });
  config = readInfraConfig();
  const clients = [
    new pg.Client(config.database),
    new pg.Client(config.database),
  ];
  const pids = [];
  try {
    for (const client of clients) {
      await client.connect();
      pids.push(
        (await client.query('select pg_backend_pid() pid')).rows[0].pid,
      );
    }
    assert.notEqual(pids[0], pids[1]);
    const available = (
      await clients[0].query(
        "select to_regprocedure('public.configure_account_quotas(jsonb)') is not null present",
      )
    ).rows[0].present;
    assert.equal(available, true);
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
  report.checks.push({
    name: 'Independent native connections and final quota RPC',
    passed: true,
    backendPids: pids,
  });
  const service = await fetch(`${config.postgrestUrl}/workspaces?select=id`, {
    headers: { Authorization: `Bearer ${config.serviceRoleKey}` },
  });
  assert.equal(service.status, 200);
  assert.deepEqual(await service.json(), []);
  const anon = await fetch(`${config.postgrestUrl}/workspaces?select=id`, {
    headers: { Authorization: `Bearer ${config.anonKey}` },
  });
  assert.equal(anon.status, 401);
  await anon.body?.cancel();
  report.checks.push({
    name: 'PostgREST service positive and anon denied',
    passed: true,
  });
  report.appliedMigrationCount = JSON.parse(
    readFileSync(path.join(evidenceRoot, 'infrastructure.json'), 'utf8'),
  ).migrations.length;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (child.connected) child.send({ stop: true });
  if (child.exitCode === null) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Graceful infrastructure shutdown timed out'));
      }, 15000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    }).catch((error) => {
      report.cleanupError = error.message;
      process.exitCode = 1;
    });
  }
  if (config) {
    for (const port of [
      config.database.port,
      Number(new URL(config.postgrestUrl).port),
    ]) {
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
      }).catch((error) => {
        report.cleanupError = error.message;
        process.exitCode = 1;
      });
    }
    report.checks.push({
      name: 'IPC shutdown releases both owned service ports',
      passed: !report.cleanupError,
    });
  }
  report.passed = !process.exitCode;
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    path.join(evidenceRoot, 'infrastructure-lifecycle.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
