import { EventEmitter } from 'node:events';
import { logAudit } from '../services/audit';
import { createLogger } from '../logger';

const log = createLogger('audit-emitter');

export interface AuditEventPayload {
  userId: number | null;
  action: string;
  targetType?: string;
  targetId?: number;
  details?: Record<string, unknown>;
}

class AuditEmitter extends EventEmitter {
  constructor() {
    super();
    this.on('log', (payload: AuditEventPayload) => {
      try {
        logAudit(
          payload.userId,
          payload.action,
          payload.targetType,
          payload.targetId,
          payload.details
        );
      } catch (err) {
        log.error('Failed to log audit event', { error: (err as Error).message, payload });
      }
    });
  }

  public emitLog(payload: AuditEventPayload): void {
    this.emit('log', payload);
  }
}

export const auditEmitter = new AuditEmitter();
export default auditEmitter;
