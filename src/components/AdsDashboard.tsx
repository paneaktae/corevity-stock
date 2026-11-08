import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { MetaStatus } from '../../shared/meta';
import type {
  AdsAlert,
  AdsAnalysis,
  AdsBreakdown,
  BreakdownDimension,
  CampaignPerformance,
  DailyPoint,
  ResultType,
  TotalMetrics,
} from '../../shared/campaign-analysis';
import { percentChange } from '../../shared/ads-analytics';
import { api, date } from '../lib';
import { ErrorBox, Loading, Field } from './ui';
import { useLanguage } from '../i18n';
import { metaCopy as copy, useMetaData, type AiDraftResponse } from '../meta';
import { DateFilters, dateDefaults } from './MetaDateFilters';

const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: digits,
      }).format(value);
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : number(value) + '%';
const resultLabel = (type: ResultType) =>
  ({
    LEAD: copy('Leads (form)', 'ลีด (ฟอร์ม)'),
    MESSAGING: copy('Messenger chats', 'แชท Messenger'),
    LINK_CLICK: copy('Link clicks', 'คลิกลิงก์'),
    REACH: copy('Reach', 'Reach'),
  })[type];
const costLabel = (type: ResultType) =>
  ({
    LEAD: copy('Cost per lead', 'ต้นทุน/ลีด'),
    MESSAGING: copy('Cost per chat', 'ต้นทุน/แชท'),
    LINK_CLICK: copy('Cost per link click', 'ต้นทุน/คลิก'),
    REACH: copy('Cost per 1,000 reached', 'ต้นทุน/1,000 คน'),
  })[type];

/** Percent change chip. `goodWhenUp` decides the colour. */
function Change({
  value,
  goodWhenUp,
}: {
  value: number | null | undefined;
  goodWhenUp: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 1)
    return <span className="ads-change neutral">±0%</span>;
  const good = rounded > 0 === goodWhenUp;
  return (
    <span
      className={'ads-change ' + (good ? 'good' : 'bad')}
      title={copy('vs previous period', 'เทียบช่วงก่อนหน้า')}
    >
      {rounded > 0 ? '▲' : '▼'} {Math.abs(rounded)}%
    </span>
  );
}

function alertCopy(alert: AdsAlert, currency: string) {
  const v = alert.values;
  const money = (n: number | null | undefined) =>
    number(n) + (currency ? ' ' + currency : '');
  switch (alert.code) {
    case 'LOW_DATA':
      return {
        title: copy('Not enough data yet', 'ข้อมูลยังน้อย'),
        detail: copy(
          `${number(v.impressions, 0)} impressions (under ${number(v.minImpressions, 0)}).`,
          `แสดงผล ${number(v.impressions, 0)} ครั้ง (ต่ำกว่า ${number(v.minImpressions, 0)})`,
        ),
        action: copy(
          'Let it run longer before changing creative or budget.',
          'ปล่อยให้รันต่ออีกสักระยะก่อนตัดสินใจเปลี่ยนชิ้นงานหรืองบ',
        ),
      };
    case 'SPEND_NO_RESULTS':
      return {
        title: copy('Spending without results', 'ใช้เงินแต่ไม่มีผลลัพธ์'),
        detail: copy(
          `Spent ${money(v.spend)} with no reported results.`,
          `ใช้ไป ${money(v.spend)} แต่ไม่มีผลลัพธ์ที่รายงาน`,
        ),
        action: copy(
          'Check the lead form / Messenger tracking first, then consider pausing for review.',
          'ตรวจการติดตามผล (ฟอร์มลีด / Messenger) ก่อน แล้วพิจารณาหยุดเพื่อตรวจสอบ',
        ),
      };
    case 'CLICKS_NO_RESULTS':
      return {
        title: copy('Clicks but no results', 'มีคนคลิกแต่ไม่มีผลลัพธ์'),
        detail: copy(
          `${number(v.linkClicks, 0)} link clicks, no reported leads or chats.`,
          `คลิกลิงก์ ${number(v.linkClicks, 0)} ครั้ง แต่ไม่มีลีดหรือแชทที่รายงาน`,
        ),
        action: copy(
          'Review the destination: form length, Messenger welcome message, price clarity.',
          'ตรวจหน้าปลายทาง: ความยาวฟอร์ม ข้อความต้อนรับ Messenger และความชัดเจนของราคา',
        ),
      };
    case 'CREATIVE_FATIGUE':
      return {
        title: copy('Creative fatigue', 'ชิ้นงานโฆษณาเริ่มล้า'),
        detail: copy(
          `Frequency ${number(v.frequency)} and link CTR ${percent(v.linkCtrChangePercent)} vs previous period.`,
          `ความถี่ ${number(v.frequency)} ครั้ง/คน และ CTR ลิงก์เปลี่ยน ${percent(v.linkCtrChangePercent)} จากช่วงก่อน`,
        ),
        action: copy(
          'Add 2–3 new images or videos, or widen the audience.',
          'เพิ่มภาพ/วิดีโอใหม่ 2–3 ชิ้น หรือขยายกลุ่มเป้าหมาย',
        ),
      };
    case 'HIGH_FREQUENCY':
      return {
        title: copy('Same people see it often', 'คนเดิมเห็นโฆษณาบ่อย'),
        detail: copy(
          `Frequency ${number(v.frequency)} (threshold ${number(v.threshold)}).`,
          `ความถี่ ${number(v.frequency)} ครั้ง/คน (เกณฑ์ ${number(v.threshold)})`,
        ),
        action: copy(
          'Widen the audience or rotate creatives before CTR drops.',
          'ขยายกลุ่มเป้าหมายหรือสลับชิ้นงานก่อนที่ CTR จะตก',
        ),
      };
    case 'CTR_DROP':
      return {
        title: copy('Link CTR dropped', 'CTR ลิงก์ลดลง'),
        detail: copy(
          `${percent(v.previousLinkCtr)} → ${percent(v.linkCtr)}.`,
          `${percent(v.previousLinkCtr)} → ${percent(v.linkCtr)}`,
        ),
        action: copy(
          'Test a new headline, first image or offer.',
          'ทดสอบหัวข้อ ภาพแรก หรือข้อเสนอใหม่',
        ),
      };
    case 'CPM_RISE':
      return {
        title: copy('Reach got more expensive', 'ค่าแสดงผล (CPM) แพงขึ้น'),
        detail: copy(
          `CPM ${money(v.previousCpm)} → ${money(v.cpm)}.`,
          `CPM ${money(v.previousCpm)} → ${money(v.cpm)}`,
        ),
        action: copy(
          'Audience may be saturated: try a broader or lookalike audience, or Advantage+ placements.',
          'กลุ่มเป้าหมายอาจอิ่มตัว ลองกลุ่มที่กว้างขึ้น / Lookalike หรือเปิดตำแหน่งอัตโนมัติ',
        ),
      };
    case 'COST_PER_RESULT_RISE':
      return {
        title: copy('Cost per result rose', 'ต้นทุนต่อผลลัพธ์สูงขึ้น'),
        detail: copy(
          `${money(v.previousCostPerResult)} → ${money(v.costPerResult)}.`,
          `${money(v.previousCostPerResult)} → ${money(v.costPerResult)}`,
        ),
        action: copy(
          'Find which ad set, ad or placement got worse in the breakdown below.',
          'ดูในส่วนเจาะลึกว่ากลุ่มโฆษณา ตัวโฆษณา หรือตำแหน่งไหนแย่ลง',
        ),
      };
    case 'LOW_LINK_CTR':
      return {
        title: copy(
          'Low link CTR vs other campaigns',
          'CTR ลิงก์ต่ำกว่าแคมเปญอื่น',
        ),
        detail: copy(
          `${percent(v.linkCtr)} vs average ${percent(v.averageLinkCtr)}.`,
          `${percent(v.linkCtr)} เทียบค่าเฉลี่ย ${percent(v.averageLinkCtr)}`,
        ),
        action: copy(
          'The ad is not grabbing attention: test real product photos, price in the image, or a short video.',
          'โฆษณายังไม่ดึงดูด ลองภาพสินค้าจริง ใส่ราคาในภาพ หรือวิดีโอสั้น',
        ),
      };
    case 'LOW_RESULT_RATE':
      return {
        title: copy(
          'Few clicks turn into results',
          'คลิกแล้วไม่ค่อยเกิดผลลัพธ์',
        ),
        detail: copy(
          `${percent(v.resultRate)} of link clicks vs average ${percent(v.averageResultRate)}.`,
          `${percent(v.resultRate)} ของคลิก เทียบค่าเฉลี่ย ${percent(v.averageResultRate)}`,
        ),
        action: copy(
          'Make the ad and the destination match (same product, price, offer).',
          'ทำให้โฆษณากับหน้าปลายทางตรงกัน (สินค้า ราคา ข้อเสนอเดียวกัน)',
        ),
      };
    case 'ABOVE_TARGET':
      return {
        title: copy('Above target cost', 'ต้นทุนสูงกว่าเป้า'),
        detail: copy(
          `${money(v.costPerResult)} vs target ${money(v.targetCostPerResult)}.`,
          `${money(v.costPerResult)} เทียบเป้า ${money(v.targetCostPerResult)}`,
        ),
        action: copy(
          'Shift spend to the best ad set / ad in the breakdown, or pause the weakest.',
          'ย้ายงบไปกลุ่มโฆษณา/ตัวโฆษณาที่ดีที่สุด หรือหยุดตัวที่แย่ที่สุด',
        ),
      };
    case 'TOP_PERFORMER':
      return {
        title: copy('Best performer', 'แคมเปญที่คุ้มที่สุด'),
        detail: copy(
          `${money(v.costPerResult)} vs average ${money(v.averageCostPerResult)}.`,
          `${money(v.costPerResult)} เทียบค่าเฉลี่ย ${money(v.averageCostPerResult)}`,
        ),
        action: copy(
          `Consider raising budget by about ${number(v.scaleBudgetPercent, 0)}% and watch cost per result for 3–4 days.`,
          `ลองเพิ่มงบประมาณ ~${number(v.scaleBudgetPercent, 0)}% แล้วดูต้นทุนต่อผลลัพธ์ 3–4 วัน`,
        ),
      };
  }
}

function Kpi({
  label,
  value,
  change,
  goodWhenUp,
}: {
  label: string;
  value: string;
  change?: number | null;
  goodWhenUp?: boolean;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      {goodWhenUp !== undefined && (
        <Change value={change} goodWhenUp={goodWhenUp} />
      )}
    </article>
  );
}

function Totals({
  current,
  previous,
  currency,
}: {
  current: TotalMetrics;
  previous: TotalMetrics | null;
  currency: string;
}) {
  const change = (key: keyof TotalMetrics) =>
    previous ? percentChange(current[key], previous[key]) : null;
  const money = (n: number | null) =>
    n === null ? '—' : number(n) + (currency ? ' ' + currency : '');
  return (
    <div className="meta-kpis ads-kpis">
      <Kpi
        label={copy('Spend', 'ค่าโฆษณา')}
        value={money(current.spend)}
        change={change('spend')}
        goodWhenUp
      />
      <Kpi
        label={copy('Messenger chats', 'แชท Messenger')}
        value={number(current.messagingConversations, 0)}
        change={change('messagingConversations')}
        goodWhenUp
      />
      <Kpi
        label={copy('Cost per chat', 'ต้นทุน/แชท')}
        value={money(current.costPerMessagingConversation)}
        change={change('costPerMessagingConversation')}
        goodWhenUp={false}
      />
      <Kpi
        label={copy('Leads (form)', 'ลีด (ฟอร์ม)')}
        value={number(current.leads, 0)}
        change={change('leads')}
        goodWhenUp
      />
      <Kpi
        label={copy('Cost per lead', 'ต้นทุน/ลีด')}
        value={money(current.costPerLead)}
        change={change('costPerLead')}
        goodWhenUp={false}
      />
      <Kpi
        label={copy('Link clicks', 'คลิกลิงก์')}
        value={number(current.linkClicks, 0)}
        change={change('linkClicks')}
        goodWhenUp
      />
      <Kpi
        label={copy('Link CTR', 'CTR ลิงก์')}
        value={percent(current.linkCtr)}
        change={change('linkCtr')}
        goodWhenUp
      />
      <Kpi
        label="CPM"
        value={money(current.cpm)}
        change={change('cpm')}
        goodWhenUp={false}
      />
    </div>
  );
}

function DailyChart({
  points,
  currency,
}: {
  points: DailyPoint[];
  currency: string;
}) {
  if (points.length < 2) return null;
  const width = 720,
    height = 200,
    pad = { l: 8, r: 8, t: 14, b: 26 };
  const results = points.map(
    (p) =>
      (p.leads ?? 0) + (p.messagingConversations ?? 0) ||
      (p.leads === null && p.messagingConversations === null ? null : 0),
  );
  const maxSpend = Math.max(1, ...points.map((p) => p.spend ?? 0));
  const maxResults = Math.max(1, ...results.map((r) => r ?? 0));
  const step = (width - pad.l - pad.r) / points.length;
  const y = (value: number, max: number) =>
    pad.t + (height - pad.t - pad.b) * (1 - value / max);
  const line = results
    .map((r, i) =>
      r === null ? '' : `${pad.l + step * (i + 0.5)},${y(r, maxResults)}`,
    )
    .filter(Boolean)
    .join(' ');
  const labelEvery = Math.ceil(points.length / 8);
  return (
    <figure className="ads-chart">
      <figcaption>
        <strong>
          {copy(
            'Daily trend (whole ad account)',
            'แนวโน้มรายวัน (ทั้งบัญชีโฆษณา)',
          )}
        </strong>
        <span className="ads-legend">
          <i className="spend" /> {copy('Spend', 'ค่าโฆษณา')}
          <i className="results" /> {copy('Leads + chats', 'ลีด + แชท')}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={copy('Daily spend and results', 'ค่าโฆษณาและผลลัพธ์รายวัน')}
      >
        {points.map((p, i) => {
          const top = y(p.spend ?? 0, maxSpend);
          return (
            <g key={p.date}>
              <rect
                className="ads-bar"
                x={pad.l + step * i + step * 0.15}
                y={top}
                width={step * 0.7}
                height={Math.max(0, height - pad.b - top)}
                rx={3}
              >
                <title>
                  {p.date}: {number(p.spend)} {currency} ·{' '}
                  {copy('results', 'ผลลัพธ์')} {number(results[i], 0)} · CTR{' '}
                  {percent(p.linkCtr)}
                </title>
              </rect>
              {i % labelEvery === 0 && (
                <text
                  className="ads-axis"
                  x={pad.l + step * (i + 0.5)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <polyline className="ads-line" points={line} fill="none" />
        {results.map((r, i) =>
          r === null ? null : (
            <circle
              key={i}
              className="ads-dot"
              cx={pad.l + step * (i + 0.5)}
              cy={y(r, maxResults)}
              r={3}
            />
          ),
        )}
      </svg>
    </figure>
  );
}

const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2, POSITIVE: 3 };
function ActionList({
  campaigns,
  currency,
}: {
  campaigns: CampaignPerformance[];
  currency: string;
}) {
  const items = campaigns
    .flatMap((campaign) =>
      (campaign.alerts ?? []).map((alert) => ({ campaign, alert })),
    )
    .sort(
      (a, b) =>
        severityOrder[a.alert.severity] - severityOrder[b.alert.severity],
    );
  return (
    <section className="ads-actions">
      <h3>{copy('What to do next', 'สิ่งที่ควรทำต่อ')}</h3>
      <p className="muted">
        {copy(
          'Rule-based checks on the reported numbers. They point to what to test; they do not prove the cause.',
          'ตรวจจากตัวเลขที่ Meta รายงานด้วยกฎตายตัว ใช้บอกว่าควรทดสอบอะไร ไม่ได้พิสูจน์สาเหตุ',
        )}
      </p>
      {items.length === 0 && (
        <p>
          {copy(
            'No issues found for these dates.',
            'ไม่พบสิ่งที่ต้องแก้ในช่วงวันที่นี้',
          )}
        </p>
      )}
      <ul>
        {items.map(({ campaign, alert }, i) => {
          const text = alertCopy(alert, currency);
          return (
            <li
              key={campaign.campaignId + alert.code + i}
              className={'ads-alert ' + alert.severity.toLowerCase()}
            >
              <div>
                <strong>{text.title}</strong>
                <small>{campaign.name}</small>
              </div>
              <p>{text.detail}</p>
              <p className="ads-alert-action">→ {text.action}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CampaignTable({
  campaigns,
  currency,
  selected,
  onSelect,
}: {
  campaigns: CampaignPerformance[];
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="meta-table-wrap">
      <table className="ads-table">
        <thead>
          <tr>
            <th>{copy('Campaign', 'แคมเปญ')}</th>
            <th>{copy('Spend', 'ค่าโฆษณา')}</th>
            <th>{copy('Results', 'ผลลัพธ์')}</th>
            <th>{copy('Cost per result', 'ต้นทุน/ผลลัพธ์')}</th>
            <th>{copy('Link CTR', 'CTR ลิงก์')}</th>
            <th>CPM</th>
            <th>{copy('Frequency', 'ความถี่')}</th>
            <th>{copy('Click → result', 'คลิก → ผลลัพธ์')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const worst = c.alerts?.[0];
            return (
              <tr
                key={c.campaignId}
                className={selected === c.campaignId ? 'selected' : ''}
              >
                <td>
                  <strong>{c.name}</strong>
                  <small>
                    {c.objective ?? '—'}
                    {worst && (
                      <span
                        className={
                          'ads-dot-badge ' + worst.severity.toLowerCase()
                        }
                      >
                        {alertCopy(worst, currency).title}
                      </span>
                    )}
                  </small>
                </td>
                <td>
                  {number(c.spend)}
                  <Change value={c.changes?.spend} goodWhenUp />
                </td>
                <td>
                  {number(c.results, 0)}
                  <small>{resultLabel(c.resultType)}</small>
                  <Change value={c.changes?.results} goodWhenUp />
                </td>
                <td>
                  {number(c.costPerResult)}
                  <small>{costLabel(c.resultType)}</small>
                  <Change value={c.changes?.costPerResult} goodWhenUp={false} />
                </td>
                <td>
                  {percent(c.linkCtr)}
                  <Change value={c.changes?.linkCtr} goodWhenUp />
                </td>
                <td>
                  {number(c.cpm)}
                  <Change value={c.changes?.cpm} goodWhenUp={false} />
                </td>
                <td>{number(c.frequency)}</td>
                <td>{percent(c.resultRate)}</td>
                <td>
                  <button onClick={() => onSelect(c.campaignId)}>
                    {copy('Drill down', 'เจาะลึก')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const dimensions: [BreakdownDimension, string, string][] = [
  ['adset', 'Ad sets', 'กลุ่มโฆษณา'],
  ['ad', 'Ads', 'ตัวโฆษณา'],
  ['age', 'Age', 'อายุ'],
  ['gender', 'Gender', 'เพศ'],
  ['publisher_platform', 'Platform', 'แพลตฟอร์ม'],
  ['platform_position', 'Placement', 'ตำแหน่งโฆษณา'],
  ['region', 'Province', 'จังหวัด'],
];
function Breakdown({
  campaign,
  range,
  currency,
  onClose,
}: {
  campaign: CampaignPerformance;
  range: { since: string; until: string };
  currency: string;
  onClose: () => void;
}) {
  const [dimension, setDimension] = useState<BreakdownDimension>('adset');
  const query = new URLSearchParams({
    ...range,
    campaignId: campaign.campaignId,
    dimension,
  });
  const result = useMetaData<AdsBreakdown>('/meta/ads/breakdown?' + query);
  const rows = result.data?.rows ?? [];
  const totalSpend = rows.reduce((n, r) => n + (r.spend ?? 0), 0);
  // Only rows with a meaningful share of spend are ranked.
  const ranked = rows.filter(
    (r) =>
      r.costPerResult !== null &&
      (r.results ?? 0) > 0 &&
      totalSpend > 0 &&
      (r.spend ?? 0) / totalSpend >= 0.05,
  );
  const best = ranked.reduce<(typeof rows)[number] | null>(
    (a, r) => (!a || r.costPerResult! < a.costPerResult! ? r : a),
    null,
  );
  const worst = ranked.reduce<(typeof rows)[number] | null>(
    (a, r) => (!a || r.costPerResult! > a.costPerResult! ? r : a),
    null,
  );
  const wasted = rows.filter(
    (r) =>
      (r.resultType === 'LEAD' || r.resultType === 'MESSAGING') &&
      (r.results ?? 0) === 0 &&
      totalSpend > 0 &&
      (r.spend ?? 0) / totalSpend >= 0.05,
  );
  return (
    <section className="ads-breakdown">
      <div className="ads-breakdown-head">
        <h3>
          {copy('Drill down', 'เจาะลึก')}: {campaign.name}
        </h3>
        <button onClick={onClose}>{copy('Close', 'ปิด')}</button>
      </div>
      <div className="ads-tabs" role="tablist">
        {dimensions.map(([key, en, th]) => (
          <button
            key={key}
            role="tab"
            aria-selected={dimension === key}
            className={dimension === key ? 'active' : ''}
            onClick={() => setDimension(key)}
          >
            {copy(en, th)}
          </button>
        ))}
      </div>
      <ErrorBox message={result.error} />
      {!result.data && !result.error && <Loading />}
      {result.data && (
        <>
          {(best || wasted.length > 0) && (
            <div className="ads-breakdown-insight">
              {best && worst && best.key !== worst.key && (
                <p>
                  {copy('Best', 'ดีที่สุด')}: <strong>{best.label}</strong> (
                  {number(best.costPerResult)} {currency}) ·{' '}
                  {copy('Worst', 'แย่ที่สุด')}: <strong>{worst.label}</strong> (
                  {number(worst.costPerResult)} {currency}).{' '}
                  {copy(
                    'Test moving budget toward the best group.',
                    'ลองทดสอบย้ายงบไปยังกลุ่มที่ดีที่สุด',
                  )}
                </p>
              )}
              {wasted.length > 0 && (
                <p>
                  {copy('Spend with no results', 'ใช้เงินแต่ไม่มีผลลัพธ์')}:{' '}
                  <strong>{wasted.map((r) => r.label).join(', ')}</strong>.{' '}
                  {copy(
                    'Consider excluding or pausing.',
                    'พิจารณาตัดออกหรือหยุด',
                  )}
                </p>
              )}
            </div>
          )}
          <div className="meta-table-wrap">
            <table className="ads-table">
              <thead>
                <tr>
                  <th>{copy('Group', 'กลุ่ม')}</th>
                  <th>{copy('Spend', 'ค่าโฆษณา')}</th>
                  <th>{copy('Share', 'สัดส่วน')}</th>
                  <th>{copy('Link CTR', 'CTR ลิงก์')}</th>
                  <th>{copy('Results', 'ผลลัพธ์')}</th>
                  <th>{copy('Cost per result', 'ต้นทุน/ผลลัพธ์')}</th>
                  <th>{copy('Click → result', 'คลิก → ผลลัพธ์')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    className={
                      r.key === best?.key
                        ? 'best'
                        : r.key === worst?.key || wasted.includes(r)
                          ? 'worst'
                          : ''
                    }
                  >
                    <td>{r.label}</td>
                    <td>{number(r.spend)}</td>
                    <td>
                      {totalSpend
                        ? percent(((r.spend ?? 0) / totalSpend) * 100)
                        : '—'}
                    </td>
                    <td>{percent(r.linkCtr)}</td>
                    <td>{number(r.results, 0)}</td>
                    <td>{number(r.costPerResult)}</td>
                    <td>{percent(r.resultRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p>
              {copy(
                'No data for this breakdown.',
                'ไม่มีข้อมูลสำหรับมุมมองนี้',
              )}
            </p>
          )}
          {result.data.hasMore && (
            <p className="muted">
              {copy('Showing the first 100 rows.', 'แสดง 100 แถวแรก')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function AdsDashboard({ status }: { status: MetaStatus }) {
  const language = useLanguage();
  const analysisRequest = useRef(0);
  const [range, setRange] = useState(dateDefaults),
    [after, setAfter] = useState<string | null>(null),
    [ai, setAi] = useState<AiDraftResponse | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [targetInput, setTargetInput] = useState(''),
    [target, setTarget] = useState<number | undefined>(),
    [selected, setSelected] = useState<string | null>(null);
  const parsed = targetInput.trim() ? Number(targetInput) : undefined;
  const validTarget =
    parsed === undefined ||
    (Number.isFinite(parsed) && parsed > 0 && parsed <= 1e10);
  function resetAnalysis() {
    analysisRequest.current++;
    setAi(null);
    setBusy(false);
    setError('');
  }
  function applyTarget() {
    if (!validTarget || parsed === target) return;
    resetAnalysis();
    setTarget(parsed);
  }
  const query = new URLSearchParams({
    ...range,
    ...(after ? { after } : {}),
    ...(target !== undefined ? { target: String(target) } : {}),
  });
  const result = useMetaData<AdsAnalysis>('/meta/ads/analysis?' + query);
  const data = result.data;
  const currency = data?.currency ?? '';
  const selectedCampaign = data?.campaigns.find(
    (c) => c.campaignId === selected,
  );
  return (
    <section className="panel ads-dashboard">
      <DateFilters
        {...range}
        onChange={(since, until) => {
          setRange({ since, until });
          setAfter(null);
          setSelected(null);
          resetAnalysis();
        }}
      />
      <ErrorBox message={error || result.error} />
      {!data && !result.error && <Loading />}
      {data && (
        <>
          {data.mode === 'DEMO' && (
            <p className="meta-window-warning">
              {copy(
                'DEMO: simulated data, not Meta reporting.',
                'DEMO: ข้อมูลจำลอง ไม่ใช่รายงานจริงจาก Meta',
              )}
            </p>
          )}
          <small className="muted">
            {data.range.since} – {data.range.until} ·{' '}
            {copy('compared with', 'เทียบกับ')} {data.previousRange.since} –{' '}
            {data.previousRange.until} · {currency || '—'} ·{' '}
            {data.timezone ?? '—'} · {copy('fetched', 'ดึงเมื่อ')}{' '}
            {date(data.fetchedAt)}
          </small>
          {data.warnings.length > 0 && (
            <p className="muted">
              {copy(
                'Some comparison data could not be loaded from Meta.',
                'โหลดข้อมูลเปรียบเทียบบางส่วนจาก Meta ไม่สำเร็จ',
              )}
            </p>
          )}
          <Totals
            current={data.totals.current}
            previous={data.totals.previous}
            currency={currency}
          />
          {data.daily && <DailyChart points={data.daily} currency={currency} />}
          <ActionList campaigns={data.campaigns} currency={currency} />
          <div className="ads-target">
            <Field
              label={copy(
                'Target cost per lead / chat (optional)',
                'เป้าต้นทุนต่อลีด / แชท (ไม่บังคับ)',
              )}
            >
              <input
                type="number"
                min="0.01"
                max="10000000000"
                step="any"
                value={targetInput}
                placeholder={copy('e.g. 150', 'เช่น 150')}
                aria-invalid={!validTarget}
                onChange={(event) => setTargetInput(event.target.value)}
                onBlur={applyTarget}
                onKeyDown={(event) => event.key === 'Enter' && applyTarget()}
              />
            </Field>
          </div>
          <h3>{copy('Campaigns', 'แคมเปญ')}</h3>
          <CampaignTable
            campaigns={data.campaigns}
            currency={currency}
            selected={selected}
            onSelect={setSelected}
          />
          {data.campaigns.length === 0 && (
            <p>
              {copy(
                'No campaigns reported for these dates.',
                'ไม่มีข้อมูลแคมเปญในช่วงวันที่เลือก',
              )}
            </p>
          )}
          {selectedCampaign && (
            <Breakdown
              key={selectedCampaign.campaignId}
              campaign={selectedCampaign}
              range={data.range}
              currency={currency}
              onClose={() => setSelected(null)}
            />
          )}
          {data.after && (
            <button
              onClick={() => {
                resetAnalysis();
                setSelected(null);
                setAfter(data.after);
              }}
            >
              {copy('Next reporting page', 'หน้ารายงานถัดไป')}
            </button>
          )}
          {after && (
            <button
              onClick={() => {
                resetAnalysis();
                setSelected(null);
                setAfter(null);
              }}
            >
              {copy('First reporting page', 'หน้ารายงานแรก')}
            </button>
          )}
          <div className="meta-analysis-controls">
            <button
              disabled={
                !status.capabilities.useAI ||
                busy ||
                !validTarget ||
                data.campaigns.length === 0
              }
              aria-busy={busy}
              onClick={async () => {
                const requestId = ++analysisRequest.current;
                setBusy(true);
                setAi(null);
                setError('');
                try {
                  const response = await api<AiDraftResponse>(
                    '/meta/ai/analyze-campaign',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        ...range,
                        ...(after ? { after } : {}),
                        language,
                        ...(target !== undefined
                          ? { targetCostPerLead: target }
                          : {}),
                      }),
                    },
                  );
                  if (analysisRequest.current === requestId) setAi(response);
                } catch (reason) {
                  if (analysisRequest.current === requestId)
                    setError((reason as Error).message);
                } finally {
                  if (analysisRequest.current === requestId) setBusy(false);
                }
              }}
            >
              <Sparkles size={16} />
              {busy
                ? copy('Analyzing campaigns…', 'กำลังวิเคราะห์แคมเปญ…')
                : copy(
                    'Ask AI for a detailed plan',
                    'ให้ AI วิเคราะห์และวางแผนแต่ละแคมเปญ',
                  )}
            </button>
          </div>
          {ai && <AiAnalysis analysis={ai} />}
          <p className="muted">
            {copy(
              'Results follow each campaign objective: Messenger chats started, lead-form leads, link clicks or reach. Missing values are not zero. Revenue and ROAS need CRM sales attribution (not available yet).',
              'ผลลัพธ์นับตามเป้าหมายของแคมเปญ: แชท Messenger ที่เริ่ม, ลีดจากฟอร์ม, คลิกลิงก์ หรือ Reach ค่าที่ไม่มีข้อมูลไม่ได้แปลว่าศูนย์ ยอดขายและ ROAS ต้องผูกยอดขาย CRM กับแคมเปญก่อน (ยังไม่มี)',
            )}
          </p>
        </>
      )}
    </section>
  );
}

function AiAnalysis({ analysis }: { analysis: AiDraftResponse }) {
  const areas = {
    CREATIVE: copy('Creative and copy', 'ภาพและข้อความโฆษณา'),
    AUDIENCE: copy('Audience', 'กลุ่มเป้าหมาย'),
    LANDING_PAGE: copy(
      'Landing page / form / Messenger',
      'หน้าปลายทาง / ฟอร์ม / Messenger',
    ),
    BUDGET: copy('Budget', 'งบประมาณ'),
    TRACKING: copy('Tracking and lead quality', 'การติดตามผลและคุณภาพลีด'),
  };
  const assessment = {
    NO_TARGET: copy('No target set', 'ยังไม่ได้ตั้งเป้า'),
    INSUFFICIENT_DATA: copy('Insufficient data', 'ข้อมูลยังไม่พอ'),
    ON_TARGET: copy('Meets target', 'อยู่ในเป้า'),
    ABOVE_TARGET: copy('Above target', 'สูงกว่าเป้า'),
    NOT_APPLICABLE: copy('Not a lead / chat objective', 'ไม่ใช่แคมเปญลีด/แชท'),
  };
  return (
    <div className="meta-ai-review meta-campaign-analysis">
      <h3>{copy('AI plan per campaign', 'แผนจาก AI รายแคมเปญ')}</h3>
      {analysis.simulated && (
        <p className="meta-window-warning">
          {copy(
            'DEMO: simulated data and advice',
            'DEMO: ข้อมูลและคำแนะนำจำลอง',
          )}
        </p>
      )}
      {analysis.content.reportScope?.hasMore && (
        <p className="muted">
          {copy(
            'More campaigns are on the next reporting page. Analyze that page separately.',
            'ยังมีแคมเปญในหน้ารายงานถัดไป กรุณาเปิดหน้านั้นเพื่อวิเคราะห์เพิ่มเติม',
          )}
        </p>
      )}
      {(analysis.content.comparison ?? []).map((campaign) => {
        const recommendation = analysis.content.recommendations?.find(
          (row) => row.campaignId === campaign.campaignId,
        );
        return (
          <article key={campaign.campaignId} className="meta-campaign-card">
            <div className="meta-draft-heading">
              <h4>{campaign.name}</h4>
              <span
                className={
                  'meta-assessment ' + campaign.assessment.toLowerCase()
                }
              >
                {assessment[campaign.assessment]}
              </span>
            </div>
            <p>
              {recommendation?.suggestion ||
                copy(
                  'No AI advice available. Retry analysis.',
                  'ยังไม่มีคำแนะนำ AI กรุณาลองวิเคราะห์ใหม่',
                )}
            </p>
            {Boolean(recommendation?.improvements?.length) && (
              <>
                <h5>
                  {copy('What to test next', 'สิ่งที่ควรปรับและทดสอบต่อ')}
                </h5>
                <ol className="meta-campaign-actions">
                  {recommendation!.improvements!.map((improvement, index) => (
                    <li key={index}>
                      <strong>{areas[improvement.area]}</strong>
                      <p>{improvement.action}</p>
                      <p className="muted">
                        {copy('Measure', 'ติดตามผล')}: {improvement.measure}
                      </p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </article>
        );
      })}
      {analysis.content.budgetSuggestion && (
        <p>{analysis.content.budgetSuggestion}</p>
      )}
      <Link
        to={
          '/meta/campaigns?name=' +
          encodeURIComponent(analysis.content.suggestedCampaignName ?? '')
        }
      >
        {copy(
          'Create a reviewed campaign draft',
          'สร้างร่างแคมเปญเพื่อตรวจทาน',
        )}
      </Link>
    </div>
  );
}
