import { isActionKind, type Action, type ActionClass } from '../domain/actions.js';
import type { Policy } from './schema.js';

/** Maps an action to auto/notify/approve. Throws on unknown kinds; unlisted transitions fail closed to approve. */
export function classifyAction(a: Action, p: Policy): ActionClass {
  if (!isActionKind(a.kind)) throw new Error(`unknown action kind: ${String(a.kind)}`);
  switch (a.kind) {
    case 'stage.advance':
      return p.actions['stage.advance'][`${a.fromStage}->${a.toStage}`] ?? 'approve';
    case 'stage.kill':
      return a.fromStage !== undefined && a.fromStage <= p.actions['stage.kill'].max_auto_stage ? 'auto' : 'approve';
    case 'post.public': {
      const pp = p.actions['post.public'];
      return (a.channel !== undefined ? pp.channels[a.channel] : undefined) ?? pp.default;
    }
    default:
      return p.actions[a.kind];
  }
}
