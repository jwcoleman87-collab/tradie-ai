import {
  chromium,
  appOrigin,
  gatewayOrigin,
  evidenceRoot,
  browserLaunchOptions,
} from './review-env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const phase = process.argv[2] || 'final';
mkdirSync(`${evidenceRoot}/runtime`, { recursive: true });
const origin = appOrigin;
const gateway = gatewayOrigin;
mkdirSync(`${evidenceRoot}/${phase}`, { recursive: true });
const checks = [];
const errors = [];
const pageErrors = [];
let signingOut = false;
const requests = [];
const browser = await chromium.launch(browserLaunchOptions());
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.route('**/*', (route) =>
  ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue()
    : route.abort('blockedbyclient'),
);
await context.tracing.start({
  screenshots: true,
  snapshots: true,
  sources: false,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', (error) => {
  pageErrors.push(error.message);
  errors.push(error.message);
});
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400)
    requests.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      afterSignOut: signingOut,
    });
});
async function check(name, run) {
  try {
    const evidence = await run();
    checks.push({ name, status: 'passed', evidence });
  } catch (error) {
    checks.push({ name, status: 'failed', error: error.message });
    await page
      .screenshot({
        path: `${evidenceRoot}/${phase}/${checks.length}-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
  }
  writeFileSync(
    `${evidenceRoot}/${phase}/browser-results.json`,
    JSON.stringify({ checks, errors, requests }, null, 2),
  );
}
const textVisible = async (text) => {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout: 15000 });
};
const control = async (value) =>
  fetch(`${gateway}/review/control`, {
    method: 'POST',
    body: JSON.stringify(value),
  });
const modelEvents = async () =>
  (await (await fetch(`${gateway}/review/control`)).json()).events;
let token, workspaceId, conversationId;
async function sessionFromBrowser() {
  const value = await page.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.endsWith('-auth-token'),
      )?.[1],
  );
  return JSON.parse(value);
}
async function api(route, method = 'GET', body) {
  const response = await fetch(`${origin}/api/${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
await check(
  'Public landing, desktop navigation, and actual response headers',
  async () => {
    const response = await page.goto(origin);
    await page
      .getByRole('link', { name: 'Start chatting', exact: true })
      .first()
      .waitFor();
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/landing-desktop.png`,
      fullPage: true,
    });
    return { headers: await response.allHeaders(), title: await page.title() };
  },
);
await check('Cross-origin browser framing is refused', async () => {
  await page.goto(`${gateway}/review/frame`);
  await page.waitForTimeout(1000);
  const framed = page.frames().find((f) => f.url().startsWith(origin));
  const readable = framed
    ? await framed
        .locator('body')
        .innerText()
        .catch(() => '')
    : '';
  await page.screenshot({
    path: `${evidenceRoot}/${phase}/cross-origin-frame.png`,
    fullPage: true,
  });
  if (readable.includes('Open your Workbench'))
    throw Error(
      'The complete sign-in form renders inside a different origin iframe.',
    );
  const browserDenial = errors.filter((message) =>
    /frame-ancestors|X-Frame-Options/i.test(message),
  );
  if (!browserDenial.length)
    throw Error('No browser framing-policy refusal was observed');
  return { framedUrl: framed?.url() || null, browserDenial };
});
await check(
  'Synthetic sign-up using actual sign-up controls (authentication service mocked)',
  async () => {
    await page.goto(`${origin}/sign-in?view=signup`);
    await page
      .getByLabel('Email', { exact: true })
      .fill(`review-${phase}-${Date.now()}@example.invalid`);
    await page
      .getByLabel('Password', { exact: true })
      .fill('SyntheticReviewPassword123');
    await page
      .getByLabel('Confirm password', { exact: true })
      .fill('SyntheticReviewPassword123');
    await page
      .getByRole('button', { name: 'Continue to Chat', exact: true })
      .click();
    await page.waitForURL('**/onboarding');
    await page.getByLabel('Message Chat', { exact: true }).waitFor();
    const session = await sessionFromBrowser();
    token = session.access_token;
    return { userId: session.user.id, url: page.url() };
  },
);
await check(
  'No AI request before consent; first answer submitted through browser',
  async () => {
    await control({ reset: true, mode: 'success', delayMs: 0 });
    await page
      .getByLabel('Message Chat', { exact: true })
      .fill(
        'My business is Synthetic A Plumbing. SYNTHETIC_FIRST_ANSWER: We do plumbing.',
      );
    if (
      await page
        .getByRole('button', { name: 'Send to Chat', exact: false })
        .isEnabled()
    )
      throw Error('Send enabled before consent');
    const denied = await api('onboarding/turn', 'POST', {
      answer: 'No consent synthetic attempt',
      allowAI: false,
      requestId: randomUUID(),
    });
    if (denied.status !== 403)
      throw Error(`Consent denial HTTP ${denied.status}`);
    if ((await modelEvents()).length)
      throw Error('AI boundary called before consent');
    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: 'Send to Chat', exact: false })
      .click();
    await textVisible('I saved your synthetic plumbing business answer.');
    const snapshot = await api('onboarding');
    workspaceId = snapshot.data.workspaceId;
    if (
      !snapshot.data.messages.some((m) =>
        m.content.includes('SYNTHETIC_FIRST_ANSWER'),
      )
    )
      throw Error('First submitted answer absent in persisted HTTP snapshot');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/onboarding-first-answer.png`,
      fullPage: true,
    });
    return { workspaceId, aiCalls: (await modelEvents()).length };
  },
);
await check(
  'Leave, refresh, return and resume preserves first answer',
  async () => {
    await page.reload();
    await textVisible('SYNTHETIC_FIRST_ANSWER');
    await page.goto(origin);
    await page.goto(`${origin}/onboarding`);
    await textVisible('SYNTHETIC_FIRST_ANSWER');
    const finishLater =
      (await page.getByRole('button', { name: /finish later/i }).count()) +
      (await page.getByRole('link', { name: /finish later/i }).count());
    return {
      firstAnswerVisible: true,
      finishLaterControlCount: finishLater,
      finishLater: 'Not implemented on this candidate',
    };
  },
);
await check(
  'Review and correct the business using actual UI controls',
  async () => {
    await page
      .getByLabel('Message Chat', { exact: true })
      .fill(
        'Second answer: based in Synthetic Sydney. Please review my profile.',
      );
    await page
      .getByRole('button', { name: 'Send to Chat', exact: false })
      .click();
    await textVisible('Check what Chat learned.');
    const card = page
      .locator('.fact-card')
      .filter({ has: page.getByText('Business name', { exact: true }) });
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page
      .getByLabel('Business name', { exact: true })
      .fill('Synthetic Corrected Plumbing');
    await page
      .getByRole('button', { name: 'Save 1 change', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Confirm and open Workbench', exact: false })
      .click();
    await page.waitForURL('**/workspace');
    await page.getByLabel('Message Chat', { exact: true }).waitFor();
    const state = await api(`state?workspaceId=${workspaceId}`);
    conversationId = state.data.conversationId;
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/workspace-after-onboarding.png`,
      fullPage: true,
    });
    return {
      businessProfile: state.data.businessProfile,
      conversationId,
      messagesAfterHandover: state.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  },
);
await check(
  'Chat actual composer, visible response, persisted refresh and confirmed context',
  async () => {
    await control({ reset: true, mode: 'success', delayMs: 0 });
    await page
      .getByLabel('Message Chat', { exact: true })
      .fill('Hello synthetic team, please use my business context.');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await textVisible('Synthetic reply.');
    await page.reload();
    await textVisible('Synthetic reply.');
    const events = await modelEvents();
    if (!events.some((e) => e.hasConfirmedProfile))
      throw Error('Confirmed business profile missing at provider boundary');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/chat-desktop.png`,
      fullPage: true,
    });
    return { events };
  },
);
await check(
  'Allowed attachment through actual upload control reaches provider context',
  async () => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'synthetic-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'SYNTHETIC_ATTACHMENT_MARKER: a local inspection note.',
      ),
    });
    await textVisible('synthetic-note.txt');
    await page
      .getByLabel('Message Chat', { exact: true })
      .fill('Read my attached synthetic note.');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await textVisible('Read SYNTHETIC_ATTACHMENT_MARKER.');
    return { fileRead: true };
  },
);
await check(
  'Narrow mobile layout, long response, composer and scrolling',
  async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Chat', exact: true })
      .first()
      .click();
    await page
      .getByLabel('Message Chat', { exact: true })
      .fill('SYNTHETIC_LONG please provide the long test response.');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await textVisible('Synthetic response paragraph 35:');
    const metrics = await page.evaluate(() => {
      const c = document
        .querySelector('textarea[aria-label="Message Chat"]')
        ?.getBoundingClientRect();
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        composer: c ? { top: c.top, bottom: c.bottom } : null,
      };
    });
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/chat-mobile.png`,
      fullPage: true,
    });
    if (metrics.scrollWidth > metrics.viewport)
      throw Error(`Horizontal overflow ${JSON.stringify(metrics)}`);
    if (
      !metrics.composer ||
      metrics.composer.bottom > 844 ||
      metrics.composer.top < 0
    )
      throw Error(`Composer outside viewport ${JSON.stringify(metrics)}`);
    return metrics;
  },
);
async function sendChat(text) {
  await page.getByLabel('Message Chat', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page
    .waitForFunction(() => !document.querySelector('.chat-progress'), {
      timeout: 10000,
    })
    .catch(() => {});
}
async function newConversation() {
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await page.waitForTimeout(300);
  conversationId = await page
    .getByLabel('Conversation history', { exact: true })
    .inputValue();
}
await check(
  'Switch conversations using actual controls without mixing messages',
  async () => {
    const first = conversationId;
    await newConversation();
    if (
      await page.getByText('SYNTHETIC_FIRST_ANSWER', { exact: false }).count()
    )
      throw Error('Foreign conversation content visible');
    await sendChat('SYNTHETIC_SECOND_CONVERSATION');
    await textVisible('Synthetic reply.');
    await page
      .getByLabel('Conversation history', { exact: true })
      .selectOption(first);
    await textVisible('Synthetic response paragraph 35:');
    if (
      await page
        .getByText('SYNTHETIC_SECOND_CONVERSATION', { exact: true })
        .count()
    )
      throw Error('Second conversation leaked into first');
    await newConversation();
    return { separateContents: true };
  },
);
await check(
  'Deny proposal through mobile Workspace and prove no action occurs',
  async () => {
    await sendChat('SYNTHETIC_PROPOSAL please prepare one inspection note');
    await page
      .getByRole('button', { name: 'Workspace', exact: true })
      .first()
      .click();
    const card = page.locator('details.action-card').first();
    await card.locator('summary').click();
    await card
      .getByRole('button', { name: 'Decline proposal', exact: true })
      .click();
    await page.waitForTimeout(350);
    const state = await api(
      `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
    );
    if (
      state.data.records.length !== 0 ||
      !state.data.actions.some((a) => a.status === 'denied')
    )
      throw Error('Denied proposal executed or was not denied');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/denied-mobile.png`,
      fullPage: true,
    });
    return { records: state.data.records.length };
  },
);
await check(
  'Approve exact payload through mobile card; refresh/replay executes once',
  async () => {
    await page
      .getByRole('button', { name: 'Chat', exact: true })
      .first()
      .click();
    await sendChat('SYNTHETIC_PROPOSAL prepare the approved inspection note');
    await page
      .getByRole('button', { name: 'Workspace', exact: true })
      .first()
      .click();
    const card = page.locator('details.action-card').first();
    await card.locator('summary').click();
    await card
      .getByRole('button', { name: 'Save record', exact: true })
      .waitFor();
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/approval-mobile.png`,
      fullPage: true,
    });
    const before = await api(
      `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
    );
    const proposal = before.data.actions.find(
      (a) => a.status === 'waiting_approval',
    );
    await card
      .getByRole('button', { name: 'Save record', exact: true })
      .click();
    await page.waitForTimeout(400);
    await page.reload();
    await page
      .getByRole('button', { name: 'Workspace', exact: true })
      .first()
      .click();
    const replay = await api(`actions/${proposal.id}/execute`, 'POST', {});
    const after = await api(
      `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
    );
    const records = after.data.records.filter(
      (r) => r.title === proposal.payload.title,
    );
    if (records.length !== 1 || records[0].body !== proposal.payload.body)
      throw Error('Execution count or approved payload mismatch');
    return {
      replayStatus: replay.status,
      recordCount: records.length,
      payloadMatches: true,
    };
  },
);
await check(
  'Workspace create/switch controls keep private conversations separate',
  async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page
      .locator('#new-workspace-name')
      .fill('Synthetic second browser workspace');
    await page
      .getByRole('button', { name: 'Create separate workspace', exact: true })
      .click();
    await textVisible('Workspace created.');
    const second = await page
      .getByLabel('Business workspace', { exact: true })
      .inputValue();
    if (second === workspaceId) throw Error('Workspace did not switch');
    await page
      .getByRole('button', { name: 'Back to Chat', exact: true })
      .click();
    if (
      await page
        .getByText('SYNTHETIC_SECOND_CONVERSATION', { exact: true })
        .count()
    )
      throw Error('Other workspace message visible');
    await page
      .getByLabel('Business workspace', { exact: true })
      .selectOption(workspaceId);
    await page
      .getByLabel('Conversation history', { exact: true })
      .selectOption(conversationId);
    return { separateWorkspace: second };
  },
);
await check(
  'Provider failure preserves accepted message and recovery allows new work',
  async () => {
    await control({ reset: true, mode: 'failure', delayMs: 0 });
    await newConversation();
    await sendChat('SYNTHETIC_PROVIDER_FAILURE');
    await page.waitForTimeout(600);
    const failed = await api(
      `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
    );
    if (
      !failed.data.messages.some(
        (m) => m.content === 'SYNTHETIC_PROVIDER_FAILURE',
      ) ||
      !failed.data.runs.some((r) => r.status === 'failed')
    )
      throw Error('Failed run or submitted message not durable');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/provider-failure.png`,
      fullPage: true,
    });
    await control({ mode: 'success' });
    await sendChat('SYNTHETIC_RECOVERY_AFTER_FAILURE');
    await textVisible('Synthetic reply.');
    return { failedMessageSaved: true, subsequentRequestSucceeded: true };
  },
);
await check(
  'Provider timeout produces visible failure, releases work, and keeps saved message',
  async () => {
    await control({ reset: true, mode: 'timeout', delayMs: 0 });
    await newConversation();
    await sendChat('SYNTHETIC_PROVIDER_TIMEOUT');
    await page.waitForTimeout(1600);
    const failed = await api(
      `state?workspaceId=${workspaceId}&conversationId=${conversationId}`,
    );
    if (
      !failed.data.messages.some(
        (m) => m.content === 'SYNTHETIC_PROVIDER_TIMEOUT',
      ) ||
      !failed.data.runs.some(
        (r) => r.status === 'failed' && r.error_code === 'AI_TIMEOUT',
      )
    )
      throw Error('Expected durable timeout receipt absent');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/provider-timeout.png`,
      fullPage: true,
    });
    const events = await modelEvents();
    await control({ mode: 'success' });
    await sendChat('SYNTHETIC_RECOVERY_AFTER_TIMEOUT');
    await textVisible('Synthetic reply.');
    return { events };
  },
);
await check(
  'Sign out hides private data and invalid sessions fail closed',
  async () => {
    signingOut = true;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForTimeout(400);
    const body = await page.locator('body').innerText();
    if (
      body.includes('SYNTHETIC_RECOVERY_AFTER_TIMEOUT') ||
      body.includes('SYNTHETIC_APPROVED_PAYLOAD')
    )
      throw Error('Private content visible after sign out');
    const old = await api('state');
    if (old.status !== 401)
      throw Error(`Revoked mocked session accepted: ${old.status}`);
    const invalid = await fetch(`${origin}/api/state`, {
      headers: { authorization: 'Bearer invalid-synthetic-session' },
    });
    if (invalid.status !== 401) throw Error('Invalid session accepted');
    await page.reload();
    if (
      (await page.locator('body').innerText()).includes(
        'SYNTHETIC_RECOVERY_AFTER_TIMEOUT',
      )
    )
      throw Error('Private content after signed-out reload');
    await page.screenshot({
      path: `${evidenceRoot}/${phase}/signed-out.png`,
      fullPage: true,
    });
    return {
      revokedSessionStatus: old.status,
      invalidSessionStatus: invalid.status,
      authBoundary: 'mocked',
    };
  },
);
await check(
  'No unexpected page exceptions or failed application requests',
  async () => {
    if (pageErrors.length)
      throw Error(`Uncaught page errors: ${pageErrors.join('; ')}`);
    const unexpected = requests.filter(
      (r) =>
        !(r.afterSignOut && r.status === 401 && r.path === '/api/integrations'),
    );
    if (unexpected.length)
      throw Error(`Unexpected failed requests: ${JSON.stringify(unexpected)}`);
    const unexpectedConsole = errors.filter(
      (message) =>
        !message.includes(
          'violates the following Content Security Policy directive',
        ) &&
        !(
          message.includes('401 (Unauthorized)') &&
          requests.some((r) => r.afterSignOut && r.status === 401)
        ),
    );
    if (unexpectedConsole.length)
      throw Error(`Unexpected console errors: ${unexpectedConsole.join('; ')}`);
    return {
      uncaughtPageErrors: 0,
      unexpectedFailedRequests: 0,
      expectedFramingDenial: true,
      allowedPostLogoutDenials: requests.length,
    };
  },
);
await context.storageState({
  path: `${evidenceRoot}/runtime/${phase}-browser-state.json`,
});
writeFileSync(
  `${evidenceRoot}/runtime/${phase}-session.json`,
  JSON.stringify({ token, workspaceId, conversationId }),
);
await context.tracing.stop({
  path: `${evidenceRoot}/runtime/${phase}-raw-trace.zip`,
});
writeFileSync(
  `${evidenceRoot}/${phase}/browser-results.json`,
  JSON.stringify({ checks, errors, requests }, null, 2),
);
console.log(JSON.stringify({ checks, errors, requests }, null, 2));
await browser.close();
process.exitCode = checks.some((c) => c.status === 'failed') ? 1 : 0;
