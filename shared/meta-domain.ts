import { z } from 'zod';
export const conversationStatuses = [
  'NEW',
  'OPEN',
  'WAITING_CUSTOMER',
  'FOLLOW_UP',
  'CLOSED',
] as const;
export const conversationPatch = z
  .object({
    status: z.enum(conversationStatuses).optional(),
    assignedTo: z.string().trim().email().or(z.literal('')).optional(),
    markRead: z.boolean().optional(),
  })
  .strict();
export const messageInput = z
  .object({
    text: z.string().trim().min(1).max(2000),
    clientRequestId: z.string().uuid(),
    aiDraftId: z.string().uuid().optional(),
    approvedByHuman: z.literal(true),
  })
  .strict();
export const leadConversionInput = z
  .object({
    customerId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    assignedTo: z.string().email().or(z.literal('')).default(''),
    estimatedValue: z.number().finite().min(0).max(1e10).default(0),
    viewingAt: z.iso.datetime().nullable().default(null),
    nextFollowUpAt: z.iso.datetime().nullable().default(null),
    notes: z.string().max(5000).default(''),
    productIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  })
  .strict();
const campaign = z
  .object({
    name: z.string().trim().min(1).max(200),
    objective: z.enum([
      'OUTCOME_LEADS',
      'OUTCOME_TRAFFIC',
      'OUTCOME_ENGAGEMENT',
      'OUTCOME_AWARENESS',
      'OUTCOME_SALES',
    ]),
    special_ad_categories: z
      .array(
        z.enum([
          'HOUSING',
          'EMPLOYMENT',
          'CREDIT',
          'ISSUES_ELECTIONS_POLITICS',
        ]),
      )
      .max(4)
      .default([]),
  })
  .strict();
export const draftInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CAMPAIGN'), payload: campaign }).strict(),
  z
    .object({
      kind: z.literal('CAMPAIGN_UPDATE'),
      payload: z
        .object({
          campaignId: z.string().regex(/^\d+$|^demo:/),
          name: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('CAMPAIGN_STATUS'),
      payload: z
        .object({
          campaignId: z.string().regex(/^\d+$|^demo:/),
          status: z.enum(['PAUSED', 'ACTIVE']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('POST'),
      payload: z
        .object({
          message: z.string().trim().min(1).max(5000),
          productId: z.string().max(100).optional(),
          scheduledAt: z.iso.datetime().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export const draftTransition = z
  .object({
    revision: z.number().int().positive(),
    action: z.enum(['VALIDATE', 'REVIEW', 'CONFIRM', 'PUBLISH']),
    approvedByHuman: z.boolean().default(false),
    confirmation: z.string().max(200).optional(),
    approvalToken: z.string().max(200).optional(),
  })
  .strict();
export const formMappingInput = z
  .object({
    formId: z.string().regex(/^\d+$|^demo:/),
    fields: z
      .record(
        z.string().min(1).max(100),
        z.enum([
          'name',
          'email',
          'phone',
          'country',
          'interest',
          'budget',
          'notes',
        ]),
      )
      .refine((v) => Object.keys(v).length <= 30),
    assignedTo: z.string().email().or(z.literal('')).default(''),
    enabled: z.boolean(),
  })
  .strict();
export type MetaConversation = {
  id: string;
  mode: 'DEMO' | 'LIVE';
  page_id: string;
  sender_id: string;
  display_name: string;
  status: (typeof conversationStatuses)[number];
  assigned_to: string;
  customer_id: string | null;
  last_incoming_at: string | null;
  last_message_at: string;
  unread_count: number;
};
export type MetaMessage = {
  id: string;
  body: string;
  kind: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: string;
  created_at: string;
};
export type MetaDraft = {
  id: string;
  mode: 'DEMO' | 'LIVE';
  kind: z.infer<typeof draftInput>['kind'];
  asset_id: string;
  payload: string;
  revision: number;
  status: string;
  payload_hash: string;
  reviewed_by?: string | null;
  approval_hash: string | null;
  approval_expires_at: string | null;
  provider_id: string | null;
  error_code: string | null;
};
export type MetaReport = {
  mode: 'DEMO' | 'LIVE';
  data: Record<string, unknown>[];
  after: string | null;
  fetchedAt: string;
  currency: string | null;
  timezone: string | null;
  metrics?: {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    leads: number | null;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    costPerLead: number | null;
  };
  notice: string;
};
