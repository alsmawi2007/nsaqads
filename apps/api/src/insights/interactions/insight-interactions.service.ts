import { Injectable } from '@nestjs/common';
import {
  ActionType,
  InsightFeedback,
  InsightInteraction,
  InsightInteractionStatus,
  Platform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Bulk lookup result keyed by insightId. Used by InsightsService to merge
// per-user state onto computed insights in a single pass.
export type InteractionsByInsightId = Map<string, InsightInteraction>;

// Denormalized metadata captured at write-time so analytics can group by
// these dimensions without re-deriving the (ephemeral) insight body.
// All optional — older clients can omit and rows will simply have null
// columns that are excluded from per-dimension aggregations.
export interface InsightMetadataInput {
  insightType?: string | null;
  severity?: string | null;
  priority?: string | null;
  relatedRuleId?: string | null;
  relatedActionType?: ActionType | null;
  platform?: Platform | null;
  entityType?: string | null;
  entityId?: string | null;
}

@Injectable()
export class InsightInteractionsService {
  constructor(private prisma: PrismaService) {}

  // Idempotent upsert. The (insightId, userId) unique constraint ensures
  // a single row per user-insight pair; the row's status / feedback fields
  // are mutated in place rather than appended, since the dashboard needs
  // current state, not history.
  async setStatus(
    orgId: string,
    insightId: string,
    userId: string,
    status: InsightInteractionStatus,
    metadata?: InsightMetadataInput,
  ): Promise<InsightInteraction> {
    const meta = pickMetadata(metadata);
    return this.prisma.insightInteraction.upsert({
      where: { insightId_userId: { insightId, userId } },
      create: { insightId, orgId, userId, status, ...meta },
      // On update, refresh the metadata too so analytics reflect what the
      // user saw most recently — relevant if a rule's action_type or platform
      // shifts over time.
      update: { status, ...meta },
    });
  }

  // Note is optional and replaces the prior note when supplied; if `note` is
  // undefined the existing note is left intact, so a user can keep an old
  // note while updating their feedback verdict.
  async setFeedback(
    orgId: string,
    insightId: string,
    userId: string,
    feedback: InsightFeedback,
    note?: string | null,
    metadata?: InsightMetadataInput,
  ): Promise<InsightInteraction> {
    const meta = pickMetadata(metadata);
    const update: Prisma.InsightInteractionUpdateInput = { feedback, ...meta };
    if (note !== undefined) update.note = note;

    return this.prisma.insightInteraction.upsert({
      where: { insightId_userId: { insightId, userId } },
      create: { insightId, orgId, userId, feedback, note: note ?? null, ...meta },
      update,
    });
  }

  // Single round-trip: load every interaction this user has on insights
  // belonging to this org, return as a Map keyed by insightId. Empty map
  // when the user has interacted with none — caller treats that as "no
  // overlay needed".
  async getForOrgUser(orgId: string, userId: string): Promise<InteractionsByInsightId> {
    const rows = await this.prisma.insightInteraction.findMany({
      where: { orgId, userId },
    });
    const out: InteractionsByInsightId = new Map();
    for (const row of rows) out.set(row.insightId, row);
    return out;
  }
}

// Strip undefined keys so the upsert's update payload doesn't clobber
// previously-populated columns with `undefined` writes. Null is preserved
// (it's an explicit clear); only undefined is dropped.
function pickMetadata(meta?: InsightMetadataInput): Partial<InsightMetadataInput> {
  if (!meta) return {};
  const out: Partial<InsightMetadataInput> = {};
  if (meta.insightType !== undefined)       out.insightType = meta.insightType;
  if (meta.severity !== undefined)          out.severity = meta.severity;
  if (meta.priority !== undefined)          out.priority = meta.priority;
  if (meta.relatedRuleId !== undefined)     out.relatedRuleId = meta.relatedRuleId;
  if (meta.relatedActionType !== undefined) out.relatedActionType = meta.relatedActionType;
  if (meta.platform !== undefined)          out.platform = meta.platform;
  if (meta.entityType !== undefined)        out.entityType = meta.entityType;
  if (meta.entityId !== undefined)          out.entityId = meta.entityId;
  return out;
}
