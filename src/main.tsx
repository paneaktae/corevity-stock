import { t, useLanguage, setLanguage } from './i18n';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard,
  Dumbbell,
  Users,
  Kanban,
  CalendarClock,
  Settings,
  MessageCircle,
  Sparkles,
  ChevronRight,
  Moon,
  Sun,
  BookOpenText,
  FileText,
  Share2,
  MessageSquareText,
} from 'lucide-react';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage, ProductPage, ProductForm } from './pages/Inventory';
import { CustomersPage, CustomerPage, CustomerForm } from './pages/Customers';
import { SalesPage, LeadPage, LeadForm, FollowupsPage } from './pages/Sales';
import { ChatPage } from './pages/Chat';
import { InventoryAssistantPage } from './pages/InventoryAssistant';
import { EquipmentGuidePage } from './pages/EquipmentGuide';
import { ChatBadge } from './components/ChatBadge';
import { ExchangeRateProvider } from './components/UsdPrice';
import { SettingsPage } from './pages/Settings';
import {
  QuotationsPage,
  QuotationForm,
  QuotationPage,
} from './pages/Quotations';
import { CatalogsPage } from './pages/Catalogs';
import { CatalogChatsPage } from './pages/CatalogChats';
import './style.css';
const navigation = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/inventory', 'Inventory', Dumbbell],
  ['/catalogs', 'Catalogs', Share2],
  ['/catalog-chats', 'Catalog inquiries', MessageSquareText],
  ['/equipment-guide', 'Equipment guide', BookOpenText],
  ['/customers', 'Customers', Users],
  ['/sales', 'Sales', Kanban],
  ['/quotations', 'Quotations', FileText],
  ['/followups', 'Follow-ups', CalendarClock],
  ['/chat', 'Team chat', MessageCircle],
  ['/ai-search', 'AI product search', Sparkles],
  ['/settings', 'Settings', Settings],
] as const;
function App() {
  const language = useLanguage();
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
  document.documentElement.lang = language;
  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <NavLink to="/" className="brand">
            <div className="brand-mark">
              <Dumbbell size={25} />
            </div>
            <div>
              COREVITY<small>{t('EQUIPMENT MANAGER')}</small>
            </div>
          </NavLink>
          <div className="nav-label">{t('WORKSPACE')}</div>
          <nav>
            {navigation.map(([to, name, Icon]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <Icon size={19} />
                <span>{t(name)}</span>
                {to === '/chat' && <ChatBadge />}
                <ChevronRight className="nav-arrow" size={15} />
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="status-dot" /> {t('Your business, in motion.')}
            <small>{t('Fitness Equipment Manager')}</small>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <span>{t('Internal workspace')}</span>
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
              <div
                className="theme-toggle"
                role="group"
                aria-label={t('Theme')}
              >
                <button
                  className={
                    theme === 'light' ? 'theme-option active' : 'theme-option'
                  }
                  type="button"
                  aria-pressed={theme === 'light'}
                  onClick={() => setTheme('light')}
                >
                  <Sun size={16} />
                  {t('Light mode')}
                </button>
                <button
                  className={
                    theme === 'dark' ? 'theme-option active' : 'theme-option'
                  }
                  type="button"
                  aria-pressed={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                >
                  <Moon size={16} />
                  {t('Dark mode')}
                </button>
              </div>
              <span className="workspace-tag">
                <span className="status-dot" /> {t('Corevity Operations')}
              </span>
            </div>
          </div>
          <div className="content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/catalogs" element={<CatalogsPage />} />
              <Route path="/catalog-chats" element={<CatalogChatsPage />} />
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
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/ai-search" element={<InventoryAssistantPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<h1>{t('Page not found')}</h1>} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(
  <ExchangeRateProvider>
    <App />
  </ExchangeRateProvider>,
);
