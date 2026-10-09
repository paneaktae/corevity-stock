import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard,
  Dumbbell,
  Users,
  Kanban,
  CalendarClock,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage, ProductPage, ProductForm } from './pages/Inventory';
import { CustomersPage, CustomerPage, CustomerForm } from './pages/Customers';
import { SalesPage, LeadPage, LeadForm, FollowupsPage } from './pages/Sales';
import { SettingsPage } from './pages/Settings';
import './style.css';
const navigation = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/inventory', 'Inventory', Dumbbell],
  ['/customers', 'Customers', Users],
  ['/sales', 'Sales', Kanban],
  ['/followups', 'Follow-ups', CalendarClock],
  ['/settings', 'Settings', Settings],
] as const;
function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <NavLink to="/" className="brand">
            <div className="brand-mark">
              <Dumbbell size={25} />
            </div>
            <div>
              COREVITY<small>EQUIPMENT MANAGER</small>
            </div>
          </NavLink>
          <div className="nav-label">WORKSPACE</div>
          <nav>
            {navigation.map(([to, name, Icon]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <Icon size={19} />
                <span>{name}</span>
                <ChevronRight className="nav-arrow" size={15} />
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="status-dot" /> Your business, in motion.
            <small>Fitness Equipment Manager</small>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <span>Internal workspace</span>
            <span className="workspace-tag">
              <span className="status-dot" /> Corevity Operations
            </span>
          </div>
          <div className="content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
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
              <Route path="/followups" element={<FollowupsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<h1>Page not found</h1>} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
