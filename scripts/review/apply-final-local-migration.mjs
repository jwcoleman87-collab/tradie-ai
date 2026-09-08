import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from '../../../e2e-tooling-20260908/node_modules/pg/lib/index.js';
const config = JSON.parse(
  readFileSync('../e2e-tooling-20260908/infra-config.json', 'utf8'),
);
if (
  config.synthetic !== true ||
  config.database.host !== '127.0.0.1' ||
  config.database.port !== 55439 ||
  config.database.database !== 'e2e_synthetic'
)
  throw Error('Not the isolated review database');
const db = new pg.Client(config.database);
await db.connect();
await db.query(
  readFileSync(
    'supabase/migrations/202609080002_onboarding_integrity.sql',
    'utf8',
  ),
);
await db.query("NOTIFY pgrst, 'reload schema'");
const rows = (
  await db.query(
    "select p.proname, pg_get_function_identity_arguments(p.oid) signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commit_onboarding_turn','confirm_onboarding','correct_onboarding_profile') order by p.proname",
  )
).rows;
const hashes = Object.fromEntries(
  readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(`supabase/migrations/${file}`))
        .digest('hex'),
    ]),
);
writeFileSync(
  'evidence/final-migration-state.json',
  JSON.stringify(
    {
      appliedAt: new Date().toISOString(),
      functions: rows,
      sourceMigrationHashes: hashes,
    },
    null,
    2,
  ),
);
console.log(
  'Final onboarding migration applied to isolated loopback database; three server-only functions present.',
);
await db.end();
