import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tooling = path.resolve('../e2e-tooling-20260908');
const config = JSON.parse(
  readFileSync(path.join(tooling, 'infra-config.json'), 'utf8'),
);
const { default: pg } = await import(
  pathToFileURL(path.join(tooling, 'node_modules/pg/lib/index.js'))
);
const pool = new pg.Pool(config.database);
const jwtSecret = config.jwtSecret;
const users = new Map();
const objects = new Map();
const signed = new Map();
let events = [];
let modelMode = 'success';
let delayMs = 0;
const revocations = new Set();
function jwt(claims) {
  const head = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 7200,
      ...claims,
    }),
  ).toString('base64url');
  return `${head}.${payload}.${createHmac('sha256', jwtSecret).update(`${head}.${payload}`).digest('base64url')}`;
}
function claims(req) {
  const token = req.headers.authorization?.replace(/^Bearer /i, '') || '';
  if (revocations.has(token)) return null;
  const [head, body, signature] = token.split('.');
  if (
    !head ||
    !body ||
    signature !==
      createHmac('sha256', jwtSecret)
        .update(`${head}.${body}`)
        .digest('base64url')
  )
    return null;
  const data = JSON.parse(Buffer.from(body, 'base64url'));
  return data.exp > Date.now() / 1000 ? data : null;
}
function userData(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: '2026-09-08T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-09-08T00:00:00Z',
  };
}
function session(user) {
  return {
    access_token: jwt({
      sub: user.id,
      role: 'authenticated',
      email: user.email,
      session_id: randomUUID(),
    }),
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    refresh_token: `review-refresh-${user.id}`,
    user: userData(user),
  };
}
async function bytes(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function send(res, status, data, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': 'http://127.0.0.1:3108',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    ...extra,
  });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function facts(name, review) {
  return [
    {
      fieldPath: 'display_name',
      value: name,
      confidence: 'high',
      factState: 'owner_supplied',
    },
    {
      fieldPath: 'services',
      value: ['Synthetic plumbing'],
      confidence: 'high',
      factState: 'owner_supplied',
    },
    ...(review
      ? [
          {
            fieldPath: 'base_location',
            value: 'Synthetic Sydney',
            confidence: 'high',
            factState: 'owner_supplied',
          },
        ]
      : []),
  ];
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:55441');
    if (req.method === 'OPTIONS') return send(res, 200, {});
    if (url.pathname === '/review/frame') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        '<!doctype html><title>Synthetic cross-origin framing test</title><h1>Untrusted origin framing test</h1><iframe src="http://127.0.0.1:3108/sign-in" width="1000" height="700"></iframe>',
      );
    }
    if (url.pathname === '/review/control') {
      if (req.method === 'GET')
        return send(res, 200, {
          events,
          modelMode,
          delayMs,
          objects: objects.size,
        });
      const body = JSON.parse(await bytes(req));
      if (body.reset) events = [];
      if (body.mode) modelMode = body.mode;
      if (body.delayMs !== undefined) delayMs = body.delayMs;
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/rest/v1')) {
      const body = await bytes(req);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      const reply = await fetch(
        `http://127.0.0.1:55440${url.pathname.slice(8)}${url.search}`,
        {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        },
      );
      const output = Buffer.from(await reply.arrayBuffer());
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      return res.end(output);
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      const action = url.pathname.slice(9);
      const body =
        req.method === 'GET'
          ? {}
          : JSON.parse((await bytes(req)).toString() || '{}');
      if (action === 'signup' || action === 'token') {
        let user = users.get(body.email);
        if (action === 'token' && body.refresh_token)
          user = [...users.values()].find(
            (u) => body.refresh_token === `review-refresh-${u.id}`,
          );
        if (action === 'signup' && !user) {
          user = {
            id: randomUUID(),
            email: body.email,
            password: body.password,
          };
          users.set(user.email, user);
          await pool.query('insert into auth.users(id) values($1)', [user.id]);
        }
        if (!user || (body.password && user.password !== body.password))
          return send(res, 400, {
            error_code: 'invalid_credentials',
            msg: 'Synthetic credentials invalid',
          });
        return send(res, 200, session(user));
      }
      if (action === 'user') {
        const claim = claims(req);
        let user = [...users.values()].find((u) => u.id === claim?.sub);
        if (
          !user &&
          claim?.sub &&
          (
            await pool.query('select 1 from auth.users where id=$1', [
              claim.sub,
            ])
          ).rowCount
        )
          user = { id: claim.sub, email: claim.email };
        return user
          ? send(res, 200, userData(user))
          : send(res, 401, { msg: 'Invalid JWT', error_code: 'bad_jwt' });
      }
      if (action === 'logout') {
        revocations.add(req.headers.authorization?.replace(/^Bearer /i, ''));
        return send(res, 204, '');
      }
      return send(res, 404, { error: 'Unsupported synthetic auth route' });
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      const claim = claims(req);
      const objectPath = decodeURIComponent(
        url.pathname.replace(
          /^\/storage\/v1\/object\/(?:authenticated\/|sign\/)?workspace-files\//,
          '',
        ),
      );
      if (
        url.pathname.startsWith('/storage/v1/object/sign/workspace-files/') &&
        req.method === 'POST'
      ) {
        if (!claim) return send(res, 401, { error: 'Unauthorized' });
        const permitted =
          claim.role === 'service_role' ||
          (
            await pool.query(
              'select 1 from workspace_members where user_id=$1 and workspace_id=$2',
              [claim.sub, objectPath.split('/')[0]],
            )
          ).rowCount;
        if (!permitted || !objects.has(objectPath))
          return send(res, 404, { error: 'Not found' });
        const token = randomUUID();
        signed.set(token, objectPath);
        return send(res, 200, {
          signedURL: `/object/sign/workspace-files/${encodeURI(objectPath)}?token=${token}`,
        });
      }
      if (req.method === 'GET') {
        const permitted =
          claim?.role === 'service_role' ||
          (claim?.sub &&
            (
              await pool.query(
                'select 1 from workspace_members where user_id=$1 and workspace_id=$2',
                [claim.sub, objectPath.split('/')[0]],
              )
            ).rowCount);
        const selected =
          signed.get(url.searchParams.get('token')) ||
          (permitted ? objectPath : null);
        if (selected !== objectPath || !objects.has(objectPath))
          return send(res, 404, { error: 'Not found' });
        const object = objects.get(objectPath);
        res.writeHead(200, { 'content-type': object.type });
        return res.end(object.body);
      }
      if (claim?.role !== 'service_role')
        return send(res, 403, { error: 'Forbidden' });
      if (
        req.method === 'POST' &&
        url.pathname.startsWith('/storage/v1/object/workspace-files/')
      ) {
        objects.set(objectPath, {
          body: await bytes(req),
          type: req.headers['content-type'],
        });
        return send(res, 200, { Key: `workspace-files/${objectPath}` });
      }
      if (req.method === 'DELETE') {
        const body = JSON.parse(await bytes(req));
        for (const name of body.prefixes || []) objects.delete(name);
        return send(res, 200, []);
      }
      return send(res, 404, { error: 'Unsupported synthetic storage route' });
    }
    if (url.pathname === '/mock/openai') {
      const body = JSON.parse(await bytes(req));
      const serialized = JSON.stringify(body.input);
      const schema = body.text?.format?.schema?.properties || {};
      const kind = schema.goalsCovered
        ? 'onboarding'
        : schema.agents
          ? 'routing'
          : 'response';
      const mode = modelMode;
      const event = {
        id: randomUUID(),
        kind,
        mode,
        startedAt: Date.now(),
        endedAt: null,
        aborted: false,
        hasConfirmedProfile: serialized.includes(
          'Synthetic Corrected Plumbing',
        ),
        hasAttachment: serialized.includes('SYNTHETIC_ATTACHMENT_MARKER'),
        hasOnboardingTranscript: serialized.includes('SYNTHETIC_FIRST_ANSWER'),
      };
      events.push(event);
      res.on('close', () => {
        if (!res.writableEnded) {
          event.aborted = true;
          event.endedAt = Date.now();
        }
      });
      if (delayMs || mode === 'timeout')
        await new Promise((r) =>
          setTimeout(r, mode === 'timeout' ? 7000 : delayMs),
        );
      if (res.destroyed) return;
      event.endedAt = Date.now();
      if (mode === 'failure')
        return send(res, 503, { error: { type: 'server_error' } });
      let output;
      if (kind === 'onboarding') {
        const review = /review|second answer|Synthetic New Business/i.test(
          serialized,
        );
        const name = serialized.includes('Synthetic New Business')
          ? 'Synthetic New Business'
          : serialized.includes('Synthetic B Plumbing')
            ? 'Synthetic B Plumbing'
            : 'Synthetic A Plumbing';
        output = {
          reply: review
            ? 'Your synthetic business profile is ready to review.'
            : 'I saved your synthetic plumbing business answer. Tell me the next detail when ready.',
          facts: facts(name, review),
          goalsCovered: ['identity_anchor'],
          nextGoal: review ? null : 'preferred_work',
          reviewReady: review,
          webSearch: false,
          searchQuery: null,
        };
      } else if (kind === 'routing')
        output = {
          agents: ['maintenance'],
          reason: 'Deterministic isolated test route',
          webSearch: false,
          calendarContext: false,
          searchQuery: null,
        };
      else {
        const propose = serialized.includes('SYNTHETIC_PROPOSAL');
        output = {
          reply: serialized.includes('SYNTHETIC_LONG')
            ? Array.from(
                { length: 35 },
                (_, i) =>
                  `Synthetic response paragraph ${i + 1}: this is local evidence for narrow-screen scrolling and readable messages.`,
              ).join('\n\n')
            : `Synthetic reply. ${event.hasConfirmedProfile ? 'Your confirmed Synthetic Corrected Plumbing context is present.' : ''} ${event.hasAttachment ? 'Read SYNTHETIC_ATTACHMENT_MARKER.' : ''}`,
          proposals: propose
            ? [
                {
                  type: 'record.create',
                  summary: 'Save synthetic inspection note',
                  agent: 'maintenance',
                  payload: {
                    kind: 'note',
                    title: 'Synthetic inspection note',
                    body: 'SYNTHETIC_APPROVED_PAYLOAD: inspection complete.',
                  },
                },
              ]
            : [],
          escalation: 'none',
        };
      }
      return send(res, 200, {
        status: 'completed',
        output: [
          { content: [{ type: 'output_text', text: JSON.stringify(output) }] },
        ],
        usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
      });
    }
    return send(res, 404, { error: 'Unknown review boundary' });
  } catch (error) {
    console.error('Gateway error', error.message);
    send(res, 500, { error: 'Review harness error' });
  }
});
mkdirSync('evidence/runtime', { recursive: true });
writeFileSync(
  'evidence/runtime/local-config.json',
  JSON.stringify({
    supabaseUrl: 'http://127.0.0.1:55441',
    anonKey: jwt({ role: 'anon' }),
    serviceKey: jwt({ role: 'service_role' }),
    port: 3108,
  }),
);
server.listen(55441, '127.0.0.1', () =>
  console.log(
    'Synthetic auth/storage/provider gateway listening on loopback 55441',
  ),
);
process.on('SIGINT', async () => {
  server.close();
  await pool.end();
  process.exit(0);
});
