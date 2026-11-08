import type { MetaMode } from '../../../shared/meta';

// Fixed vocabulary only: audit entries cannot accept tokens or customer text.
export function metaAuditStatement(
  db: D1Database,
  entry: {
    actorEmail: string;
    mode: MetaMode;
    action:
      | 'SETTINGS_UPDATED'
      | 'CONNECTION_STARTED'
      | 'CONNECTION_COMPLETED'
      | 'CONNECTION_DISCONNECTED'
      | 'TOKEN_VALIDATED'
      | 'OPERATION_REJECTED';
    outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  },
  timestamp = new Date().toISOString(),
) {
  return db
    .prepare(
      'INSERT INTO meta_audit_logs(id,mode,actor_email,action,outcome,created_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      entry.mode,
      entry.actorEmail,
      entry.action,
      entry.outcome,
      timestamp,
    );
}
