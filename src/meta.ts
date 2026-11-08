import { useCallback, useEffect, useState } from 'react';
import { api } from './lib';
import { localized } from './i18n';
import type {
  CampaignPerformance,
  CampaignRecommendation,
} from '../shared/campaign-analysis';
export const metaCopy = (en: string, th: string) => localized(en, th);
export function useMetaData<T>(path: string | null, poll = 0) {
  const [snapshot, setSnapshot] = useState<{ path: string; value: T }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let alive = true,
      busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (alive) {
          setSnapshot({ path, value });
          setError('');
        }
      } catch (reason) {
        if (alive && !controller.signal.aborted)
          setError((reason as Error).message);
      } finally {
        busy = false;
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = poll
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void load();
        }, poll)
      : undefined;
    return () => {
      alive = false;
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [path, poll, version]);
  return {
    data: snapshot?.path === path ? snapshot.value : undefined,
    error,
    loading,
    reload,
  };
}
export type SharedProduct = {
  id: string;
  brand: string;
  model: string;
  category: string;
  condition: string;
  status: string;
  price: number | null;
  url: string;
  imageUrl: string | null;
};
export type AiDraftResponse = {
  id: string;
  mode: 'DEMO' | 'LIVE';
  status: string;
  simulated: boolean;
  content: {
    text: string;
    intent?: string;
    language?: string;
    followUp?: string;
    observedData?: unknown;
    calculatedMetrics?: unknown;
    recommendations?: CampaignRecommendation[];
    comparison?: CampaignPerformance[];
    reportScope?: {
      since: string;
      until: string;
      after: string | null;
      hasMore: boolean;
      fetchedAt: string;
      currency: string | null;
      timezone: string | null;
      targetCostPerLead: number | null;
    };
    ideas?: {
      productId: string;
      copy: string;
      creative: string;
      audience: string;
    }[];
    budgetSuggestion?: string;
    suggestedCampaignName?: string;
  };
  requiresHumanApproval: boolean;
};
