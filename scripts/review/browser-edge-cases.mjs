import { chromium } from '../../../e2e-tooling-20260908/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

const origin = 'http://127.0.0.1:3108';
const gateway = 'http://127.0.0.1:55441';
const config = JSON.parse(
  readFileSync(
    new URL('../../../e2e-tooling-20260908/infra-config.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(config.synthetic, true);
assert.equal(config.database.host, '127.0.0.1');
const { Client } = createRequire(import.meta.url)(config.pgModule);
const db = new Client(config.database);
await db.connect();
mkdirSync('evidence/browser-edge-cases', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.route('**/*', (route) =>
  ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort('blockedbyclient'),
);
const page = await context.newPage();
page.setDefaultTimeout(12000);
const checks = [];
const errors = [];
const responses = [];
const startedAt = new Date().toISOString();
const buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400)
    responses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
    });
});
let token, workspaceId, conversationId, userId;
const password = randomUUID();
const events = async () =>
  (await (await fetch(`${gateway}/review/control`)).json()).events.length;
async function api(endpoint, method = 'GET', data, jwt = token) {
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      origin,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, data: await response.json() };
}
async function upload(name, mime, bytes) {
  const response = await fetch(
    `${origin}/api/uploads?${new URLSearchParams({ workspaceId, conversationId, filename: name })}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': mime,
        origin,
      },
      body: bytes,
    },
  );
  return { status: response.status, data: await response.json() };
}
async function check(name, run) {
  try {
    checks.push({ name, status: 'passed', evidence: await run() });
  } catch (error) {
    let message = error.message.replaceAll(password, '[redacted]');
    if (token) message = message.replaceAll(token, '[redacted]');
    checks.push({ name, status: 'failed', error: message });
    await page
      .screenshot({
        path: `evidence/browser-edge-cases/${checks.length}-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
  }
}

try {
  await check(
    'Synthetic signup, onboarding review and confirmation through actual UI',
    async () => {
      await page.goto(`${origin}/sign-in?view=signup`);
      await page
        .getByLabel('Email', { exact: true })
        .fill(`edge-${randomUUID()}@example.invalid`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm password', { exact: true }).fill(password);
      await page
        .getByRole('button', { name: 'Continue to Chat', exact: true })
        .click();
      await page.waitForURL('**/onboarding');
      await page
        .getByLabel('Message Chat', { exact: true })
        .fill(
          'My business is Synthetic A Plumbing. We do plumbing in Synthetic Sydney. Please review my profile.',
        );
      await page.getByRole('checkbox').check();
      await page
        .getByRole('button', { name: 'Send to Chat', exact: false })
        .click();
      await page
        .getByRole('button', {
          name: 'Confirm and open Workbench',
          exact: false,
        })
        .waitFor();
      await page
        .getByRole('button', {
          name: 'Confirm and open Workbench',
          exact: false,
        })
        .click();
      await page.waitForURL('**/workspace');
      await page.getByLabel('Message Chat', { exact: true }).waitFor();
      const session = JSON.parse(
        await page.evaluate(
          () =>
            Object.entries(localStorage).find(([key]) =>
              key.endsWith('-auth-token'),
            )?.[1],
        ),
      );
      token = session.access_token;
      userId = session.user.id;
      const state = await api('state');
      assert.equal(state.status, 200);
      workspaceId = state.data.workspace.id;
      conversationId = state.data.conversationId;
      return {
        confirmed: state.data.onboardingStatus === 'confirmed',
        authentication: 'synthetic gateway',
      };
    },
  );

  await check(
    'Unsupported file rejected through file input and actual HTTP',
    async () => {
      assert.ok(workspaceId, 'Signup prerequisite missing');
      const before = await events();
      const pending = page.waitForResponse(
        (response) =>
          response.url().includes('/api/uploads') &&
          response.request().method() === 'POST',
      );
      await page.locator('input[type=file]').setInputFiles({
        name: 'synthetic-invalid.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('synthetic unsupported content'),
      });
      assert.equal((await pending).status(), 415);
      await page
        .getByText('Choose a JPEG, PNG, WebP, PDF, TXT or CSV file.', {
          exact: false,
        })
        .first()
        .waitFor();
      const direct = await upload(
        'synthetic-invalid.exe',
        'application/octet-stream',
        Buffer.from('synthetic unsupported content'),
      );
      assert.equal(direct.status, 415);
      assert.equal(direct.data.error.code, 'FILE_TYPE_NOT_ALLOWED');
      assert.equal(await events(), before);
      return {
        browserStatus: 415,
        httpStatus: direct.status,
        code: direct.data.error.code,
        providerCallsAdded: 0,
      };
    },
  );

  await check(
    'Oversized file rejected by actual file control and HTTP body limit',
    async () => {
      const beforeRequests = responses.filter(
        (response) => response.path === '/api/uploads',
      ).length;
      await page.locator('input[type=file]').setInputFiles({
        name: 'synthetic-too-large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 97),
      });
      await page
        .getByText('Each file must be 10 MB or less.', { exact: false })
        .first()
        .waitFor();
      assert.equal(
        responses.filter((response) => response.path === '/api/uploads').length,
        beforeRequests,
      );
      const direct = await upload(
        'synthetic-too-large.txt',
        'text/plain',
        Buffer.alloc(10 * 1024 * 1024 + 1, 97),
      );
      assert.equal(direct.status, 413);
      assert.equal(direct.data.error.code, 'FILE_TOO_LARGE');
      await page.screenshot({
        path: 'evidence/browser-edge-cases/oversized-file.png',
        fullPage: true,
      });
      return {
        clientMessage: 'Each file must be 10 MB or less.',
        httpStatus: direct.status,
        code: direct.data.error.code,
      };
    },
  );

  await check(
    'Previously valid uploaded file cannot be attached while marked unready',
    async () => {
      const pending = page.waitForResponse(
        (response) =>
          response.url().includes('/api/uploads') &&
          response.request().method() === 'POST',
      );
      await page.locator('input[type=file]').setInputFiles({
        name: 'synthetic-ready.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('SYNTHETIC_ATTACHMENT_MARKER edge fixture'),
      });
      const response = await pending;
      assert.equal(response.status(), 201);
      const file = await response.json();
      await db.query(
        "update uploaded_files set status='uploading' where workspace_id=$1 and id=$2",
        [workspaceId, file.id],
      );
      try {
        const before = await events();
        const denied = await api('chat', 'POST', {
          workspaceId,
          conversationId,
          requestId: randomUUID(),
          text: 'Synthetic unready attachment attempt',
          attachmentIds: [file.id],
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.data.error.code, 'FORBIDDEN');
        assert.equal(await events(), before);
        const rows = await db.query(
          "select count(*)::integer count from messages where workspace_id=$1 and content='Synthetic unready attachment attempt'",
          [workspaceId],
        );
        assert.equal(rows.rows[0].count, 0);
        return {
          uploadedThroughFileControl: 201,
          rejectedHttpStatus: denied.status,
          providerCallsAdded: 0,
          persistedRejectedMessages: 0,
          faultInjection:
            'Only this synthetic ready file status temporarily changed to uploading via native SQL; restored in finally.',
        };
      } finally {
        await db.query(
          "update uploaded_files set status='ready' where workspace_id=$1 and id=$2",
          [workspaceId, file.id],
        );
        await page.reload();
        await page.getByLabel('Message Chat', { exact: true }).waitFor();
      }
    },
  );

  await check(
    'Burst rejection preserves exact browser draft and saved history without another provider call',
    async () => {
      // Make the twelve real requests and browser rejection in the same real
      // minute. This waits for a clock boundary; it never edits quota counters.
      const seconds = new Date().getSeconds();
      if (seconds > 30)
        await new Promise((resolve) =>
          setTimeout(resolve, (61 - seconds) * 1000),
        );
      const minuteStarted = Math.floor(Date.now() / 60000);
      const successful = [];
      for (let index = 0; index < 12; index++) {
        const text = `EDGE_QUOTA_PRIOR_${index}: synthetic saved message`;
        const result = await api('chat', 'POST', {
          workspaceId,
          conversationId,
          requestId: randomUUID(),
          text,
          attachmentIds: [],
        });
        assert.equal(
          result.status,
          200,
          `Accepted request ${index + 1} must succeed`,
        );
        successful.push(text);
      }
      await page.reload();
      await page.getByLabel('Message Chat', { exact: true }).waitFor();
      const previous = await api(
        `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
      );
      const previousIds = previous.data.messages.map((message) => message.id);
      const providerBefore = await events();
      const draft =
        'EDGE_REJECTED_DRAFT: preserve this exact unsent customer work.';
      await page.getByLabel('Message Chat', { exact: true }).fill(draft);
      const pending = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/chat' &&
          response.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      const rejected = await pending;
      assert.equal(rejected.status(), 429);
      await page
        .getByText('Please wait a minute before trying again.', {
          exact: false,
        })
        .first()
        .waitFor();
      const errorBox = await page
        .getByText('Please wait a minute before trying again.', {
          exact: false,
        })
        .first()
        .boundingBox();
      const rejectionMessageInViewport = Boolean(
        errorBox &&
        errorBox.y >= 0 &&
        errorBox.y + errorBox.height <= page.viewportSize().height,
      );
      assert.equal(
        await page.getByLabel('Message Chat', { exact: true }).inputValue(),
        draft,
      );
      const after = await api(
        `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
      );
      assert.deepEqual(
        after.data.messages.map((message) => message.id),
        previousIds,
      );
      assert.ok(
        successful.every((text) =>
          after.data.messages.some((message) => message.content === text),
        ),
      );
      assert.ok(
        !after.data.messages.some((message) => message.content === draft),
      );
      assert.equal(await events(), providerBefore);
      assert.equal(
        Math.floor(Date.now() / 60000),
        minuteStarted,
        'All quota requests must stay in the same actual minute',
      );
      await page.screenshot({
        path: 'evidence/browser-edge-cases/quota-draft-preserved.png',
        fullPage: true,
      });
      return {
        acceptedHttpRequests: 12,
        actualComposerHttpStatus: 429,
        sameRealMinute: true,
        exactDraftPreserved: true,
        rejectionMessageInViewport,
        rejectionMessageBounds: errorBox,
        viewport: page.viewportSize(),
        savedMessageIdsUnchanged: true,
        priorUserMessagesRetained: 12,
        providerCallsAddedByRejectedRequest: 0,
      };
    },
  );

  await check(
    'Correctly signed but expired synthetic session rejected by actual API',
    async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const body = Buffer.from(
        JSON.stringify({
          aud: 'authenticated',
          sub: userId,
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) - 60,
        }),
      ).toString('base64url');
      const jwt = `${header}.${body}.${createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url')}`;
      const result = await api('state', 'GET', undefined, jwt);
      assert.equal(result.status, 401);
      assert.equal(result.data.error.code, 'INVALID_SESSION');
      return {
        status: 401,
        code: result.data.error.code,
        boundary:
          'Synthetic HMAC authentication gateway; not real Supabase authentication.',
      };
    },
  );
} finally {
  await browser.close();
  await db.end();
  const report = {
    buildId,
    startedAt,
    finishedAt: new Date().toISOString(),
    boundaries:
      'Actual Chrome/UI, built application HTTP, native PostgreSQL/PostgREST. Synthetic authentication, storage and AI gateway; external network blocked. No raw credential-bearing trace captured.',
    checks,
    errors,
    responses,
  };
  writeFileSync(
    'evidence/browser-edge-cases.json',
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      failed: checks.filter((check) => check.status === 'failed').length,
      pageErrors: errors.length,
    }),
  );
  if (checks.some((check) => check.status === 'failed')) process.exitCode = 1;
}
