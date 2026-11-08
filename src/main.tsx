import { t, localized, useLanguage, setLanguage } from './i18n';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Dumbbell,
  Users,
  Kanban,
  CalendarClock,
  CalendarDays,
  Settings,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  ChevronRight,
  Moon,
  Sun,
  BookOpenText,
  FileText,
  Share2,
  Menu,
  X,
  Wallet,
  ReceiptText,
  LogOut,
  Globe2,
  ExternalLink,
  Clock3,
  Newspaper,
} from 'lucide-react';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage, ProductPage, ProductForm } from './pages/Inventory';
import { CustomersPage, CustomerPage, CustomerForm } from './pages/Customers';
import { SalesPage, LeadPage, LeadForm, FollowupsPage } from './pages/Sales';
import { ChatPage } from './pages/Chat';
import { CatalogChatsPage } from './pages/CatalogChats';
import { InventoryAssistantPage } from './pages/InventoryAssistant';
import { EquipmentGuidePage } from './pages/EquipmentGuide';
import { ChatBadge } from './components/ChatBadge';
import { ExchangeRateProvider } from './components/UsdPrice';
import { SettingsPage } from './pages/Settings';
import { QuotationsPage, QuotationForm, QuotationPage } from './pages/Quotations';
import { CatalogsPage } from './pages/Catalogs';
import { ExpenseCategoriesPage, ExpenseDetailPage, ExpenseFormPage, ExpensesPage, FinanceOverviewPage } from './pages/Finance';
import { CalendarPage } from './pages/Calendar';
import { NewsPage } from './pages/News';
import { api, useData } from './lib';
import { getCatalogChatReadCursors } from './catalogChatRead';
import './style.css';
const MetaPage = lazy(() => import('./pages/Meta').then(module => ({ default: module.MetaPage })));
const navigationGroups = [
  { label: 'Overview', items: [['/', 'Dashboard', LayoutDashboard]] },
  { label: 'Products & inventory', items: [['/inventory', 'Inventory', Dumbbell], ['/catalogs', 'Catalogs', Share2], ['/equipment-guide', 'Equipment guide', BookOpenText]] },
  { label: 'Customers & sales', items: [['/customers', 'Customers', Users], ['/sales', 'Sales', Kanban], ['/quotations', 'Quotations', FileText], ['/followups', 'Follow-ups', CalendarClock], ['/calendar', 'Calendar & reminders', CalendarDays]] },
  { label: 'Tools', items: [['/chat', 'Team chat', MessageCircle], ['/catalog-chats', 'Customer chat', MessagesSquare], ['/ai-search', 'AI product search', Sparkles], ['/news', 'News', Newspaper]] },
  { label: 'Meta / Facebook', items: [['/meta/inbox', 'Messenger Inbox', MessagesSquare], ['/meta/leads', 'Meta Leads', Users], ['/meta/ads', 'Ads Dashboard', LayoutDashboard], ['/meta/campaigns', 'Campaigns', FileText], ['/meta/insights', 'Page Insights', Globe2], ['/meta/content', 'Page Content', FileText], ['/meta/webhooks', 'Meta Webhooks', CalendarClock]] },
  { label: 'Finance', items: [['/finance', 'Finance', Wallet], ['/expenses', 'Expenses', ReceiptText]] },
  { label: 'Preferences', items: [['/settings', 'Settings', Settings]] },
] as const;
const worldTimeZones = [
  { zone: 'Asia/Bangkok', th: 'ไทย', en: 'Thailand' },
  { zone: 'America/New_York', th: 'สหรัฐฯ (NY)', en: 'US (NY)' },
  { zone: 'Europe/London', th: 'อังกฤษ', en: 'UK' },
  { zone: 'Asia/Shanghai', th: 'จีน', en: 'China' },
] as const;
function WorldClocks() {
  const language = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <div className="world-clocks" aria-label={localized('World clocks', 'เวลาทั่วโลก')}>
      <Clock3 size={16} aria-hidden="true" />
      {worldTimeZones.map(({ zone, th, en }) => (
        <div className="world-clock" key={zone}>
          <span>{language === 'th' ? th : en}</span>
          <strong>
            {new Intl.DateTimeFormat(language === 'th' ? 'th-TH-u-nu-latn' : 'en-US', {
              timeZone: zone,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hourCycle: 'h23',
            }).format(now)}
          </strong>
        </div>
      ))}
    </div>
  );
}
function AppLayout() {
  const language = useLanguage();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatPopupOpen, setChatPopupOpen] = useState(false);
  const [unreadCustomerChats, setUnreadCustomerChats] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('corevity-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Keep the app usable when browser storage is disabled.
    }
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('corevity-theme', theme);
    } catch {
      // Keep the selected theme for this session.
    }
  }, [theme]);
  useEffect(() => {
    setMobileMenuOpen(false);
    if (location.pathname === '/chat') setChatPopupOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!chatPopupOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatPopupOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [chatPopupOpen]);
  useEffect(() => {
    let mounted = true;
    let refreshing = false;
    const refreshUnread = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await api<{ threads: { id: string; lastMessageId: number; lastSender: 'VISITOR' | 'SALESPERSON' }[] }>('/catalog-chats');
        if (!mounted) return;
        const cursors = getCatalogChatReadCursors();
        const activeThreadId = location.pathname === '/catalog-chats' && document.visibilityState === 'visible'
          ? new URLSearchParams(location.search).get('thread')
          : null;
        setUnreadCustomerChats(result.threads.filter((thread) =>
          thread.lastSender === 'VISITOR' &&
          thread.lastMessageId > (cursors[thread.id] ?? 0) &&
          thread.id !== activeThreadId,
        ).length);
      } catch {
        // Keep the rest of the workspace usable if the inbox is temporarily unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refreshUnread();
    const timer = window.setInterval(() => void refreshUnread(), 5000);
    const update = () => void refreshUnread();
    window.addEventListener('corevity:customer-chat-read', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('corevity:customer-chat-read', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [location.pathname, location.search]);
  document.documentElement.lang = language;
  return (
    <>
      <div className="app">
        {mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label={t('Close menu')} onClick={() => setMobileMenuOpen(false)} />}
        <aside className={`sidebar${mobileMenuOpen ? ' mobile-open' : ''}`}>
          <button className="mobile-menu-close" type="button" aria-label={t('Close menu')} onClick={() => setMobileMenuOpen(false)}><X size={21} /></button>
          <NavLink to="/" className="brand">
            <div className="brand-mark">
              <Dumbbell size={25} />
            </div>
            <div>
              COREVITY<small>{t('EQUIPMENT MANAGER')}</small>
            </div>
          </NavLink>
          <div className="nav-label sidebar-workspace-label">{t('WORKSPACE')}</div>
          <div className="sidebar-menu-scroll">
            {navigationGroups.map((group) => (
              <nav className="sidebar-nav-group" aria-label={t(group.label)} key={group.label}>
                <div className="nav-group-label">{t(group.label)}</div>
                {group.items.map(([to, name, Icon]) => (
                  <NavLink key={to} to={to} end={to === '/'}>
                    <Icon size={19} />
                    <span>{t(name)}</span>
                    {to === '/catalog-chats' && unreadCustomerChats > 0 && <span className="customer-chat-nav-badge" aria-label={`${unreadCustomerChats} ${t('unread customer chats')}`}>{unreadCustomerChats > 9 ? '9+' : unreadCustomerChats}</span>}
                    <ChevronRight className="nav-arrow" size={15} />
                  </NavLink>
                ))}
              </nav>
            ))}
            <nav className="sidebar-nav-group" aria-label={t('Website')}>
              <div className="nav-group-label">{t('Website')}</div>
              <a
                className="external-nav-link"
                href={`https://corevityusedgym.com/${language}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Globe2 size={19} />
                <span>{t('Company website')}</span>
                <ExternalLink className="external-nav-icon" size={15} />
              </a>
            </nav>
          </div>
          <div className="sidebar-bottom">
            <span className="status-dot" /> {t('Your business, in motion.')}
            <small>{t('Fitness Equipment Manager')}</small>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <button className="mobile-menu-toggle" type="button" aria-label={t('Open menu')} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><Menu size={21} /><span>{t('Menu')}</span></button>
            <span>{t('Internal workspace')}</span>
            <WorldClocks />
            <div className="topbar-actions">
              <label className="language-picker">
                <span>{t('Language')}</span>
                <select
                  aria-label={t('Language')}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as 'th' | 'en')}
                >
                  <option value="th">ไทย</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div className="theme-toggle" role="group" aria-label={t('Theme')}>
                <button
                  className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                  type="button"
                  aria-pressed={theme === 'light'}
                  onClick={() => setTheme('light')}
                >
                  <Sun size={16} />
                  {t('Light mode')}
                </button>
                <button
                  className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                  type="button"
                  aria-pressed={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                >
                  <Moon size={16} />
                  {t('Dark mode')}
                </button>
              </div>
              <button type="button" className="signout-button" onClick={async () => {
                try { await api('/auth/logout', { method: 'POST' }); } catch { /* Always return to the sign-in screen. */ }
                window.location.assign('/login');
              }}><LogOut size={16} /><span>{t('Sign out')}</span></button>
            </div>
          </div>
          <div className="content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/catalogs" element={<CatalogsPage />} />
              <Route path="/equipment-guide" element={<EquipmentGuidePage />} />
              <Route path="/inventory/new" element={<ProductForm />} />
              <Route path="/inventory/:id" element={<ProductPage />} />
              <Route path="/inventory/:id/edit" element={<ProductForm />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/new" element={<CustomerForm />} />
              <Route path="/customers/:id" element={<CustomerPage />} />
              <Route path="/customers/:id/edit" element={<CustomerForm />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/sales/new" element={<LeadForm />} />
              <Route path="/sales/:id" element={<LeadPage />} />
              <Route path="/sales/:id/edit" element={<LeadForm />} />
              <Route path="/quotations" element={<QuotationsPage />} />
              <Route path="/quotations/new" element={<QuotationForm />} />
              <Route path="/quotations/:id" element={<QuotationPage />} />
              <Route path="/quotations/:id/edit" element={<QuotationForm />} />
              <Route path="/followups" element={<FollowupsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/catalog-chats" element={<CatalogChatsPage />} />
              <Route path="/ai-search" element={<InventoryAssistantPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/finance" element={<FinanceOverviewPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/expenses/new" element={<ExpenseFormPage />} />
              <Route path="/expenses/:id/edit" element={<ExpenseFormPage />} />
              <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
              <Route path="/finance/categories" element={<ExpenseCategoriesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/meta/:section" element={<Suspense fallback={<p>Loading Meta…</p>}><MetaPage /></Suspense>} />
              <Route path="*" element={<h1>{t('Page not found')}</h1>} />
            </Routes>
          </div>
        </main>
        <button
          type="button"
          className="chat-quick-access"
          style={location.pathname === '/chat' ? { display: 'none' } : undefined}
          aria-hidden={location.pathname === '/chat'}
          tabIndex={location.pathname === '/chat' ? -1 : undefined}
          aria-label={t('Team chat')}
          title={t('Team chat')}
          aria-expanded={chatPopupOpen}
          aria-controls="team-chat-popup"
          onClick={() => setChatPopupOpen((open) => !open)}
        >
          <MessageCircle size={25} strokeWidth={2.2} aria-hidden="true" />
          <ChatBadge active={chatPopupOpen} />
        </button>
        {chatPopupOpen && location.pathname !== '/chat' && (
          <section
            className="chat-popup"
            id="team-chat-popup"
            role="dialog"
            aria-label={t('Team chat')}
          >
            <ChatPage compact onClose={() => setChatPopupOpen(false)} />
          </section>
        )}
      </div>
    </>
  );
}
type AuthSession = { authenticated: boolean; email?: string; hasPassword?: boolean };
function LoginPage() {
  const location = useLocation();
  const requestedPath = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') && !requestedPath.includes('\\')
    ? requestedPath
    : '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <main className="auth-page"><form className="panel auth-panel" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); window.location.assign(returnTo); }
    catch (reason) { setError((reason as Error).message); setBusy(false); }
  }}>
    <div className="brand-mark"><Dumbbell size={25} /></div>
    <h1>COREVITY</h1><p>{t('Sign in to your workspace')}</p>
    {error && <div className="error" role="alert">{error}</div>}
    <label className="field"><span>{t('Username (email)')}</span><input autoComplete="username" type="email" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label className="field"><span>{t('Password')}</span><input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button className="primary" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')}</button>
  </form></main>;
}
function AuthGate() {
  const location = useLocation();
  const { data, error } = useData<AuthSession>('/auth/session');
  if (!data && !error) return <main className="auth-page"><p>{t('Loading your workspace…')}</p></main>;
  if (!data?.authenticated) return <Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />} /></Routes>;
  if (location.pathname === '/login') return <Navigate to="/" replace />;
  return <AppLayout />;
}
function App() { return <BrowserRouter><AuthGate /></BrowserRouter>; }
createRoot(document.getElementById('root')!).render(
  <ExchangeRateProvider>
    <App />
  </ExchangeRateProvider>,
);
