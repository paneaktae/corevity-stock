import type { Bindings } from '../../auth';
import { processMetaWebhooks } from './webhooks';
import { processMetaSyncJobs } from './leads';
import { refreshMetaTokens } from './oauth';
import { timestamp } from './store';
export async function maintainMeta(env: Bindings) {
  if (env.META_INTEGRATION_ENABLED !== 'true') return;
  await Promise.allSettled([
    processMetaWebhooks(env),
    processMetaSyncJobs(env),
    refreshMetaTokens(env),
  ]);
  const parsed = Number(env.META_DATA_RETENTION_DAYS ?? 90),
    days =
      Number.isInteger(parsed) && parsed >= 30 && parsed <= 365 ? parsed : 90;
  const before = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM meta_oauth_states WHERE expires_at<?').bind(
      timestamp(),
    ),
    env.DB.prepare('DELETE FROM meta_insights_cache WHERE expires_at<?').bind(
      timestamp(),
    ),
    env.DB.prepare('DELETE FROM meta_rate_limits WHERE window_start<?').bind(
      Math.floor(Date.now() / 60000) - 1440,
    ),
    env.DB.prepare(
      "UPDATE meta_messages SET status='UNKNOWN' WHERE status='PENDING' AND created_at<?",
    ).bind(new Date(Date.now() - 300_000).toISOString()),
    env.DB.prepare(
      "UPDATE meta_drafts SET status='UNKNOWN',error_code='PROVIDER_OUTCOME_UNKNOWN',updated_at=? WHERE status='PUBLISHING' AND updated_at<?",
    ).bind(timestamp(), new Date(Date.now() - 300_000).toISOString()),
    env.DB.prepare(
      'DELETE FROM meta_messages WHERE created_at<? AND status<>?',
    ).bind(before(days), 'UNKNOWN'),
    env.DB.prepare(
      'DELETE FROM meta_conversation_notes WHERE created_at<?',
    ).bind(before(days)),
    env.DB.prepare('DELETE FROM meta_ai_drafts WHERE created_at<?').bind(
      before(30),
    ),
    env.DB.prepare(
      "UPDATE meta_webhook_events SET payload='{}' WHERE status IN ('PROCESSED','IGNORED') AND created_at<?",
    ).bind(before(7)),
    env.DB.prepare('DELETE FROM meta_webhook_events WHERE created_at<?').bind(
      before(30),
    ),
    env.DB.prepare(
      'DELETE FROM meta_operation_audit_logs WHERE created_at<?',
    ).bind(before(365)),
  ]);
}
