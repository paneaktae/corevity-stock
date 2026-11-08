import { HTTPException } from 'hono/http-exception';
import type { Bindings } from '../../auth';
import type { MetaMode } from '../../../shared/meta';
import { encryptMetaToken, decryptMetaToken } from './token-crypto';
export const timestamp = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export type TokenRow = {
  id: string;
  connection_id: string;
  token_type: 'USER' | 'PAGE' | 'SYSTEM_USER';
  asset_id: string;
  expires_at: string | null;
  data_access_expires_at: string | null;
  revoked_at: string | null;
  last_validated_at: string | null;
  permission_status: string;
  ciphertext: string;
  nonce: string;
  key_version: string;
  algorithm: 'AES-GCM';
};
export async function loadToken(
  env: Bindings,
  type: TokenRow['token_type'],
  assetId = '',
  allowStale = false,
) {
  const row = await env.DB.prepare(
    "SELECT m.*,s.ciphertext,s.nonce,s.key_version,s.algorithm FROM meta_token_metadata m JOIN meta_token_secrets s ON s.token_id=m.id JOIN meta_connections c ON c.id=m.connection_id WHERE c.mode='LIVE' AND c.status<>'DISCONNECTED' AND m.token_type=? AND m.asset_id=?",
  )
    .bind(type, assetId)
    .first<TokenRow>();
  if (
    !row ||
    row.revoked_at ||
    [row.expires_at, row.data_access_expires_at].some(
      (v) =>
        v && (!Number.isFinite(Date.parse(v)) || Date.parse(v) <= Date.now()),
    ) ||
    (!allowStale &&
      (row.permission_status !== 'GRANTED' ||
        !row.last_validated_at ||
        !Number.isFinite(Date.parse(row.last_validated_at)) ||
        Date.parse(row.last_validated_at) < Date.now() - 86_400_000))
  )
    throw new HTTPException(409, {
      message: 'Please reconnect and validate your Meta token.',
    });
  const token = await decryptMetaToken(
    env,
    {
      connectionId: row.connection_id,
      tokenId: row.id,
      tokenType: row.token_type,
      assetId: row.asset_id,
    },
    {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.key_version,
      algorithm: row.algorithm,
    },
  );
  return { token, row };
}
export async function tokenStatements(
  env: Bindings,
  args: {
    connectionId: string;
    type: TokenRow['token_type'];
    assetId?: string;
    token: string;
    expiresAt?: string | null;
    dataAccessExpiresAt?: string | null;
    issuedAt?: string | null;
    permissionStatus?: string;
  },
) {
  const id = args.connectionId + ':' + args.type + ':' + (args.assetId ?? '');
  const now = timestamp();
  const encrypted = await encryptMetaToken(
    env,
    {
      connectionId: args.connectionId,
      tokenId: id,
      tokenType: args.type,
      assetId: args.assetId ?? '',
    },
    args.token,
  );
  return [
    env.DB.prepare(
      'INSERT INTO meta_token_metadata(id,connection_id,token_type,asset_id,issued_at,expires_at,data_access_expires_at,last_validated_at,permission_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET issued_at=excluded.issued_at,expires_at=excluded.expires_at,data_access_expires_at=excluded.data_access_expires_at,last_validated_at=excluded.last_validated_at,permission_status=excluded.permission_status,revoked_at=NULL,updated_at=excluded.updated_at',
    ).bind(
      id,
      args.connectionId,
      args.type,
      args.assetId ?? '',
      args.issuedAt ?? null,
      args.expiresAt ?? null,
      args.dataAccessExpiresAt ?? null,
      now,
      args.permissionStatus ?? 'GRANTED',
      now,
      now,
    ),
    env.DB.prepare(
      'INSERT INTO meta_token_secrets(token_id,ciphertext,nonce,key_version,algorithm,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(token_id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,key_version=excluded.key_version,updated_at=excluded.updated_at',
    ).bind(
      id,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.keyVersion,
      encrypted.algorithm,
      now,
      now,
    ),
  ];
}
export type MetaAuditAction =
  | 'DEMO_INITIALIZED'
  | 'MESSAGE_SEND'
  | 'CONVERSATION_UPDATED'
  | 'NOTE_CREATED'
  | 'CUSTOMER_LINKED'
  | 'LEAD_CREATED'
  | 'LEAD_IMPORTED'
  | 'FORM_MAPPING_UPDATED'
  | 'DRAFT_CREATED'
  | 'DRAFT_EDITED'
  | 'DRAFT_VALIDATED'
  | 'DRAFT_REVIEWED'
  | 'DRAFT_CONFIRMED'
  | 'DRAFT_PUBLISH_STARTED'
  | 'DRAFT_PUBLISHED'
  | 'DRAFT_FAILED'
  | 'AI_DRAFT_CREATED'
  | 'AI_DRAFT_APPROVED'
  | 'CONNECTION_REFRESHED'
  | 'WEBHOOK_SUBSCRIBED'
  | 'MESSENGER_AUTOMATION_CONFIGURED';
export function operationAudit(
  env: Bindings,
  mode: MetaMode,
  actor: string,
  action: MetaAuditAction,
  entityId: string,
  outcome: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'SUCCESS',
) {
  return env.DB.prepare(
    'INSERT INTO meta_operation_audit_logs(id,mode,actor_email,action,entity_id,outcome,created_at) VALUES(?,?,?,?,?,?,?)',
  ).bind(uuid(), mode, actor, action, entityId, outcome, timestamp());
}
export async function rateLimit(
  env: Bindings,
  actor: string,
  operation: string,
  limit = 30,
) {
  const window = Math.floor(Date.now() / 60_000);
  const row = await env.DB.prepare(
    'INSERT INTO meta_rate_limits(bucket,window_start,attempts) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start RETURNING attempts',
  )
    .bind(operation + ':' + actor, window)
    .first<{ attempts: number }>();
  if ((row?.attempts ?? limit + 1) > limit)
    throw new HTTPException(429, {
      message: 'Too many requests. Please wait a minute.',
    });
}
