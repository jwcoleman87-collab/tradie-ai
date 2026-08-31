import { z } from 'zod';
import { FacebookPayload } from '../contracts';
import {
  providerCredentials,
  recordConnectionVerification,
} from './connections';
import { graphRead, appSecretProof } from './provider-http';
import { graphVersion } from './provider-config';
import { env } from './config';
import { AppError, requireValue, timedFetch } from './errors';
import { adminDb, rpc } from './db';
export type PublishReceipt = { postId: string; url: string; published: true };
export async function sendFacebookPost(
  token: string,
  payload: unknown,
): Promise<PublishReceipt> {
  const p = FacebookPayload.parse(payload);
  let response: Response;
  try {
    response = await timedFetch(
      'https://graph.facebook.com/' + graphVersion() + '/' + p.pageId + '/feed',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'manual',
        body: new URLSearchParams({
          message: p.message,
          ...(p.link ? { link: p.link } : {}),
          appsecret_proof: await appSecretProof(token),
        }),
      },
    );
  } catch {
    throw new AppError(
      'PUBLICATION_UNCERTAIN',
      409,
      'Facebook may have received this post. Check the Page before taking further action.',
    );
  }
  // Only an explicit structured Graph rejection is considered safe to retry.
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AppError('PUBLICATION_UNCERTAIN', 409);
  }
  if (!response.ok) {
    const rejected =
      response.status >= 400 &&
      response.status < 500 &&
      z.object({ error: z.object({ code: z.number() }) }).safeParse(data)
        .success;
    throw new AppError(
      rejected ? 'FACEBOOK_REJECTED' : 'PUBLICATION_UNCERTAIN',
      409,
      rejected
        ? 'Facebook rejected the post. Check Page permissions and the approved content.'
        : 'The publication result is uncertain. Check the Page; automatic reposting is blocked.',
    );
  }
  const parsed = z
    .object({ id: z.string().regex(/^\d+_\d+$/) })
    .safeParse(data);
  requireValue(
    parsed.success && parsed.data.id.startsWith(p.pageId + '_'),
    'PUBLICATION_UNCERTAIN',
    409,
  );
  return {
    postId: parsed.data.id,
    url: 'https://www.facebook.com/' + parsed.data.id,
    published: true,
  };
}
export async function publishFacebook(
  workspaceId: string,
  actionId: string,
  payload: unknown,
  connectionId: string,
  executionToken: string,
) {
  requireValue(
    env('FACEBOOK_PUBLISHING_ENABLED') === 'true',
    'PUBLISHING_DISABLED',
    409,
    'Public publishing is not enabled. The approved post was not sent.',
  );
  const p = FacebookPayload.parse(payload),
    connection = await providerCredentials(
      workspaceId,
      'facebook',
      connectionId,
    );
  requireValue(connection.resource.id === p.pageId, 'CONNECTION_CHANGED', 409);
  const access = z
    .object({ id: z.string() })
    .parse(await graphRead(p.pageId, connection.token, { fields: 'id' }));
  requireValue(access.id === p.pageId, 'CONNECTION_CHANGED', 409);
  await recordConnectionVerification(workspaceId, 'facebook', connectionId);
  // Commit the sending marker before making the non-idempotent provider call.
  const attempt = await rpc<{ send: boolean; receipt?: PublishReceipt }>(
    adminDb(),
    'begin_external_publish',
    { p_action: actionId, p_token: executionToken },
  );
  if (!attempt.send) return attempt.receipt!;
  let receipt: PublishReceipt;
  try {
    receipt = await sendFacebookPost(connection.token, p);
  } catch (error) {
    try {
      await rpc(adminDb(), 'record_external_publish', {
        p_action: actionId,
        p_token: executionToken,
        p_status:
          error instanceof AppError && error.code === 'FACEBOOK_REJECTED'
            ? 'rejected'
            : 'uncertain',
        p_receipt: null,
      });
    } catch {
      throw new AppError(
        'PUBLICATION_UNCERTAIN',
        409,
        'The publication result could not be saved. Check the Page; automatic reposting is blocked.',
      );
    }
    throw error;
  }
  // If this receipt write fails, the marker remains 'sending'; retries are blocked.
  try {
    await rpc(adminDb(), 'record_external_publish', {
      p_action: actionId,
      p_token: executionToken,
      p_status: 'confirmed',
      p_receipt: receipt,
    });
  } catch {
    throw new AppError(
      'PUBLICATION_UNCERTAIN',
      409,
      'Facebook returned a post, but its receipt could not be saved. Check the Page; automatic reposting is blocked.',
    );
  }
  return receipt;
}
