import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib';
import { localized } from '../i18n';
type Rate = {
  rate: number | null;
  date: string | null;
  checkedAt: string | null;
  source: string;
  stale: boolean;
};
const RateContext = createContext<Rate | undefined>(undefined);
export function ExchangeRateProvider({ children }: { children: ReactNode }) {
  const [rate, setRate] = useState<Rate>();
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      api<Rate>('/exchange-rate', { signal: controller.signal })
        .then(setRate)
        .catch(() =>
          setRate((previous) =>
            previous ? { ...previous, stale: true } : undefined,
          ),
        );
    void refresh();
    const timer = setInterval(() => void refresh(), 60 * 60000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return <RateContext.Provider value={rate}>{children}</RateContext.Provider>;
}
export function UsdPrice({ amount }: { amount: number }) {
  const fx = useContext(RateContext);
  return (
    <small className="usd-price">
      {fx?.rate
        ? `≈ ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / fx.rate)} USD${fx.stale ? ' *' : ''}`
        : localized('USD rate unavailable', 'ยังไม่มีเรต USD')}
    </small>
  );
}
export function ExchangeRateNote() {
  const fx = useContext(RateContext);
  return (
    <p className="fx-note">
      {fx?.rate ? (
        <>
          {`1 USD = ${fx.rate.toFixed(4)} THB · `}
          {localized('Rate date', 'เรตวันที่')} {fx.date} ·{' '}
          <a
            href={
              fx.source === 'BOT'
                ? 'https://www.bot.or.th/th/statistics/exchange-rate.html'
                : 'https://frankfurter.dev'
            }
            target="_blank"
            rel="noreferrer"
          >
            {fx.source === 'BOT'
              ? localized(
                  'Bank of Thailand (BOT)',
                  'ธนาคารแห่งประเทศไทย (ธปท.)',
                )
              : 'Frankfurter'}
          </a>
          {' · '}
          {localized(
            'Daily reference rate. Latest published rate is used on holidays; actual bank quotes may differ.',
            'เรทอ้างอิงรายวัน วันหยุดใช้เรทล่าสุดที่เผยแพร่ เรทซื้อขายจริงของธนาคารอาจแตกต่างกัน',
          )}
          {fx.stale && (
            <strong>
              {' '}
              {localized(
                'Using the last saved rate; refresh pending.',
                'ใช้เรตล่าสุดที่บันทึกไว้ รออัปเดตเรตใหม่',
              )}
            </strong>
          )}
        </>
      ) : (
        localized(
          'USD conversion is temporarily unavailable. Prices remain in THB.',
          'ยังแปลงเป็น USD ไม่ได้ชั่วคราว ราคาเงินบาทยังใช้งานได้',
        )
      )}
    </p>
  );
}
