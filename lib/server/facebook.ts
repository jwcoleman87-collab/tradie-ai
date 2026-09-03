import { z } from 'zod';
import { FacebookPayload } from '../contracts';
import {
  markConnectionReconnectRequired,
  providerCredentials,
  recordConnectionVerification,
} from './connections';
import { graphRead, appSecretProof } from './provider-http';
import { graphVersion } from './provider-config';
import { env } from './config';
import { AppError, requireValue, timedFetch } from './errors';
import { adminDb, checked, rpc } from './db';
import { validateFile } from './uploads';
export type PublishReceipt = { postId: string; url: string; published: true };
export type FacebookImage = {
  bytes: Uint8Array;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png';
};

export async function verifyFacebookConnection(
  workspaceId: string,
  connectionId: string,
) {
  try {
    const connection = await providerCredentials(
      workspaceId,
      'facebook',
      connectionId,
    );
    const page = z
      .object({ id: z.string(), name: z.string().min(1) })
      .parse(
        await graphRead(connection.resource.id, connection.token, {
          fields: 'id,name',
        }),
      );
    requireValue(page.id === connection.resource.id, 'CONNECTION_CHANGED', 409);
    await recordConnectionVerification(
      workspaceId,
      'facebook',
      connectionId,
      { displayName: page.name },
    );
    return page;
  } catch (error) {
    if (
      error instanceof AppError &&
      ['FACEBOOK_ACCESS_FAILED', 'RECONNECT_REQUIRED'].includes(error.code)
    ) {
      await markConnectionReconnectRequired(
        workspaceId,
        'facebook',
        connectionId,
        'FACEBOOK_ACCESS_REVOKED',
      );
      throw new AppError(
        'RECONNECT_REQUIRED',
        409,
        'Reconnect Facebook to restore Page access.',
      );
    }
    throw error;
  }
}

async function loadFacebookImage(
  workspaceId: string,
  conversationId: string,
  imageFileId: string,
): Promise<FacebookImage> {
  const db = adminDb();
  const file = checked(
    await db
      .from('uploaded_files')
      .select('filename,mime_type,object_path,size_bytes,sha256')
      .eq('id', imageFileId)
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversationId)
      .eq('status', 'ready')
      .in('mime_type', ['image/jpeg', 'image/png'])
      .lte('size_bytes', 4 * 1024 * 1024)
      .maybeSingle(),
  );
  requireValue(
    file,
    'FACEBOOK_IMAGE_INVALID',
    409,
    'The approved Facebook image is unavailable or unsupported.',
  );
  const data = checked(
    await db.storage.from('workspace-files').download(file.object_path),
  );
  requireValue(data, 'FACEBOOK_IMAGE_INVALID', 409);
  const bytes = new Uint8Array(await data.arrayBuffer());
  validateFile(bytes, file.mime_type);
  const digest = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex');
  requireValue(digest === file.sha256, 'FACEBOOK_IMAGE_INVALID', 409);
  return {
    bytes,
    filename: file.filename,
    mimeType: z.enum(['image/jpeg', 'image/png']).parse(file.mime_type),
  };
}

export async function sendFacebookPost(
  token: string,
  payload: unknown,
  image?: FacebookImage,
): Promise<PublishReceipt> {
  const p = FacebookPayload.parse(payload);
  requireValue(!!image === !!p.imageFileId, 'FACEBOOK_IMAGE_INVALID', 409);
  const proof = await appSecretProof(token);
  let body: FormData | URLSearchParams;
  if (image) {
    const imageBuffer = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(imageBuffer).set(image.bytes);
    body = new FormData();
    body.set(
      'source',
      new Blob([imageBuffer], { type: image.mimeType }),
      image.filename,
    );
    body.set('caption', p.message);
    body.set('published', 'true');
    body.set('appsecret_proof', proof);
  } else {
    body = new URLSearchParams({
      message: p.message,
      ...(p.link ? { link: p.link } : {}),
      appsecret_proof: proof,
    });
  }
  let response: Response;
  try {
    response = await timedFetch(
      'https://graph.facebook.com/' +
        graphVersion() +
        '/' +
        p.pageId +
        (image ? '/photos' : '/feed'),
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'manual',
        body,
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
  let postId = '';
  if (image) {
    const parsed = z
      .object({
        id: z.string().regex(/^\d+$/),
        post_id: z.string().regex(/^\d+_\d+$/),
      })
      .safeParse(data);
    if (parsed.success) postId = parsed.data.post_id;
  } else {
    const parsed = z
      .object({ id: z.string().regex(/^\d+_\d+$/) })
      .safeParse(data);
    if (parsed.success) postId = parsed.data.id;
  }
  requireValue(postId.startsWith(p.pageId + '_'), 'PUBLICATION_UNCERTAIN', 409);
  return {
    postId,
    url: 'https://www.facebook.com/' + postId,
    published: true,
  };
}
export async function publishFacebook(
  workspaceId: string,
  conversationId: string,
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
  let access: { id: string };
  try {
    access = z
      .object({ id: z.string() })
      .parse(await graphRead(p.pageId, connection.token, { fields: 'id' }));
  } catch (error) {
    if (error instanceof AppError && error.code === 'FACEBOOK_ACCESS_FAILED') {
      await markConnectionReconnectRequired(
        workspaceId,
        'facebook',
        connectionId,
        'FACEBOOK_ACCESS_REVOKED',
      );
      throw new AppError(
        'RECONNECT_REQUIRED',
        409,
        'Reconnect Facebook to restore Page access.',
      );
    }
    throw error;
  }
  requireValue(access.id === p.pageId, 'CONNECTION_CHANGED', 409);
  await recordConnectionVerification(workspaceId, 'facebook', connectionId);
  const image = p.imageFileId
    ? await loadFacebookImage(workspaceId, conversationId, p.imageFileId)
    : undefined;
  // Commit the sending marker before making the non-idempotent provider call.
  const attempt = await rpc<{ send: boolean; receipt?: PublishReceipt }>(
    adminDb(),
    'begin_external_publish',
    { p_action: actionId, p_token: executionToken },
  );
  if (!attempt.send) return attempt.receipt!;
  let receipt: PublishReceipt;
  try {
    receipt = await sendFacebookPost(connection.token, p, image);
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
