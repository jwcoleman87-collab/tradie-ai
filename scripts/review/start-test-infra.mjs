import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  repository,
  infraConfigPath,
  toolingRoot,
  pg,
  appOrigin,
  gatewayOrigin,
  evidenceRoot,
  loopbackOrigin,
} from './review-env.mjs';

// This entry point accepts only a freshly provisioned local synthetic server.
// E2E_PG_BIN starts an owned native cluster; otherwise an explicit fixture service
// designation is mandatory. No inherited production PG/Supabase settings are read.
const runtime = path.dirname(infraConfigPath);
mkdirSync(runtime, { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });
assert.ok(
  !existsSync(infraConfigPath),
  'Refusing to overwrite existing infrastructure config; choose a fresh E2E_INFRA_CONFIG directory',
);
const port = Number(process.env.E2E_PG_PORT || 55439);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const databaseName = process.env.E2E_DATABASE_NAME || 'e2e_synthetic';
assert.match(databaseName, /^e2e_synthetic(?:_[a-z0-9_]+)?$/);
const postgrestUrl = loopbackOrigin(
  process.env.E2E_POSTGREST_ORIGIN || 'http://127.0.0.1:55440',
);
const binary = path.resolve(
  process.env.E2E_POSTGREST_BINARY ||
    path.join(
      repository,
      'tmp/review-ci/bin',
      process.platform === 'win32' ? 'postgrest.exe' : 'postgrest',
    ),
);
assert.ok(
  existsSync(binary),
  'Missing PostgREST binary: run download-postgrest.mjs or set E2E_POSTGREST_BINARY. Tests are not skipped.',
);
const config = {
  synthetic: true,
  purpose:
    'Disposable test-only configuration. Never use these constants externally.',
  database: {
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'synthetic-local-e2e-postgres',
    database: databaseName,
  },
  jwtSecret: 'synthetic-local-e2e-jwt-secret-20260908-DO-NOT-USE-EXTERNALLY',
  postgrestUrl,
  gatewayUrl: gatewayOrigin,
  appOrigin,
  pgModule: path.join(toolingRoot, 'node_modules/pg/lib/index.js'),
};
const jwt = (role) => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 86400 }),
  ).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
};
config.anonKey = jwt('anon');
config.serviceRoleKey = jwt('service_role');
const log = (line) =>
  appendFileSync(path.join(runtime, 'infra-private.log'), line);
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(PG|PGRST_)/.test(name)),
);
const children = [];
function start(executable, args, env = cleanEnvironment) {
  const child = spawn(executable, args, {
    cwd: repository,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log(chunk.toString()));
  child.stderr.on('data', (chunk) => log(chunk.toString()));
  child.on('error', (error) => log(`${error.message}\n`));
  children.push(child);
  return child;
}
async function run(executable, args) {
  const child = start(executable, args);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Infrastructure command failed (${path.basename(executable)}, exit ${code}); see private log`,
            ),
          ),
    );
  });
}
async function freePort(value) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(value, '127.0.0.1', () => server.close(resolve));
  });
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pgCtl;
let dataDirectory;
let ownedPostgres;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.toReversed()) {
    if (child !== ownedPostgres && child.exitCode === null) child.kill();
  }
  if (pgCtl)
    spawnSync(pgCtl, ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10000,
    });
  if (ownedPostgres?.exitCode === null) ownedPostgres.kill();
}
process.once('SIGINT', () => {
  stop();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stop();
  process.exit(143);
});
process.once('exit', stop);
process.on('message', (message) => {
  if (message?.stop === true) {
    stop();
    process.exit(0);
  }
});

try {
  await freePort(Number(new URL(postgrestUrl).port));
  if (process.env.E2E_PG_BIN) {
    const pgBin = path.resolve(process.env.E2E_PG_BIN);
    const extension = process.platform === 'win32' ? '.exe' : '';
    const postgres = path.join(pgBin, `postgres${extension}`);
    pgCtl = path.join(pgBin, `pg_ctl${extension}`);
    dataDirectory = path.join(runtime, 'postgres-data');
    assert.ok(
      !existsSync(dataDirectory),
      'Refusing to reuse an existing cluster directory',
    );
    await freePort(port);
    const passwordFile = path.join(runtime, 'init-password.txt');
    writeFileSync(passwordFile, config.database.password + '\n', {
      mode: 0o600,
    });
    await run(path.join(pgBin, `initdb${extension}`), [
      '-D',
      dataDirectory,
      '--auth=scram-sha-256',
      '--username=postgres',
      `--pwfile=${passwordFile}`,
      '--encoding=UTF8',
      '--locale=C',
    ]);
    ownedPostgres = start(postgres, [
      '-D',
      dataDirectory,
      '-p',
      String(port),
      '-h',
      '127.0.0.1',
      '-c',
      'max_connections=50',
    ]);
    config.postgresBinary = postgres;
    config.pgCtlBinary = pgCtl;
    config.dataDirectory = dataDirectory;
  } else {
    assert.equal(
      process.env.E2E_ISOLATED_POSTGRES,
      '1',
      'No owned PostgreSQL binary supplied. E2E_ISOLATED_POSTGRES=1 must designate the disposable CI service; missing infrastructure fails the run.',
    );
  }
  let admin;
  for (let attempt = 0; attempt < 100; attempt++) {
    admin = new pg.Client({
      ...config.database,
      database: 'postgres',
      connectionTimeoutMillis: 500,
    });
    try {
      await admin.connect();
      break;
    } catch {
      await admin.end().catch(() => {});
      if (attempt === 99)
        throw new Error('Isolated PostgreSQL did not become ready');
      await pause(100);
    }
  }
  try {
    const existing = await admin.query(
      'select 1 from pg_database where datname=$1',
      [databaseName],
    );
    assert.equal(
      existing.rowCount,
      0,
      'Refusing to reuse an existing test database',
    );
    const roles = await admin.query(
      "select rolname from pg_roles where rolname in ('anon','authenticated','service_role','e2e_authenticator')",
    );
    assert.equal(
      roles.rowCount,
      0,
      'Expected a fresh disposable server; refusing to alter existing application roles',
    );
    await admin.query(`create database "${databaseName}"`);
  } finally {
    await admin.end();
  }
  const db = new pg.Client(config.database);
  await db.connect();
  const hashes = [];
  const syntheticPolicy = {
    chat_burst: 12,
    chat_daily: 10000,
    chat_concurrency: 1000,
    onboarding_burst: 10,
    onboarding_daily: 10000,
    workspace_active: 20,
    workspace_total: 10000,
    workspace_daily: 10000,
  };
  let databaseFacts;
  try {
    await db.query(
      readFileSync(new URL('fixture.sql', import.meta.url), 'utf8'),
    );
    const migrations = path.join(repository, 'supabase/migrations');
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(path.join(migrations, name), 'utf8');
      await db.query('begin');
      try {
        await db.query(sql);
        await db.query('commit');
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
      hashes.push({
        name,
        sha256: createHash('sha256').update(sql).digest('hex'),
      });
    }
    await db.query('select public.configure_account_quotas($1::jsonb)', [
      JSON.stringify(syntheticPolicy),
    ]);
    databaseFacts = (
      await db.query(
        "select version(), current_database(), current_setting('listen_addresses') as listen_addresses, current_setting('port') as port",
      )
    ).rows[0];
  } finally {
    await db.end();
  }
  writeFileSync(infraConfigPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  const restConfig = path.join(runtime, 'postgrest.conf');
  writeFileSync(
    restConfig,
    [
      `db-uri = "postgres://e2e_authenticator:synthetic-local-authenticator@127.0.0.1:${port}/${databaseName}?sslmode=disable"`,
      'db-schemas = "public"',
      'db-anon-role = "anon"',
      'db-pool = 10',
      'server-host = "127.0.0.1"',
      `server-port = ${new URL(postgrestUrl).port}`,
      `jwt-secret = "${config.jwtSecret}"`,
      'log-level = "warn"',
    ].join('\n'),
    { mode: 0o600 },
  );
  const restEnvironment = { ...cleanEnvironment };
  if (process.env.E2E_PG_BIN)
    restEnvironment.PATH =
      path.resolve(process.env.E2E_PG_BIN) + path.delimiter + process.env.PATH;
  const rest = start(
    binary,
    [restConfig, '+RTS', '-N1', '-RTS'],
    restEnvironment,
  );
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(rest.exitCode, null, 'PostgREST exited before readiness');
    try {
      const response = await fetch(
        `${postgrestUrl}/workspaces?select=id&limit=1`,
        {
          headers: { Authorization: `Bearer ${config.serviceRoleKey}` },
          signal: AbortSignal.timeout(1000),
        },
      );
      if (response.ok && (await response.text()) === '[]') {
        ready = true;
        break;
      }
    } catch {
      /* bounded readiness retry */
    }
    await pause(100);
  }
  assert.ok(
    ready,
    'PostgREST did not become ready; no database/browser suite was skipped',
  );
  writeFileSync(
    path.join(evidenceRoot, 'infrastructure.json'),
    JSON.stringify(
      {
        ready: true,
        databaseFacts,
        migrations: hashes,
        syntheticPolicy,
        postgrest: '16.2',
        nativeDatabase: true,
        mocked: ['Auth', 'Storage', 'AI'],
        binding: 'loopback only',
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    'Isolated PostgreSQL and PostgREST ready; all migrations and explicit synthetic quota policy applied.',
  );
  process.send?.({ ready: true });
  rest.once('exit', () => {
    if (!stopping) {
      console.error('PostgREST exited unexpectedly');
      stop();
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    }
  });
} catch (error) {
  stop();
  console.error(`Isolated infrastructure failed: ${error.message}`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
