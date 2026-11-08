export type CampaignRecommendation = {
  campaignId: string;
  suggestion: string;
  improvements?: {
    area: 'CREATIVE' | 'AUDIENCE' | 'LANDING_PAGE' | 'BUDGET' | 'TRACKING';
    action: string;
    measure: string;
  }[];
};
export type CampaignPerformance = {
  campaignId: string;
  name: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  costPerLead: number | null;
  leadConversionRate: number | null;
  assessment: 'NO_TARGET' | 'INSUFFICIENT_DATA' | 'ON_TARGET' | 'ABOVE_TARGET';
};
