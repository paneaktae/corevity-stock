import { useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Plus,
  Share2,
  X,
} from 'lucide-react';
import type { Customer, Product, Salesperson } from '../../shared/schemas';
import { salespersonName } from '../../shared/schemas';
import { api, money, useData } from '../lib';
import { t } from '../i18n';
import { ErrorBox, Field, Header, Loading } from '../components/ui';

type CatalogRow = {
  id: string;
  title: string;
  description: string;
  slug: string;
  status: 'ACTIVE' | 'ARCHIVED';
  publishToWeb: number | boolean;
  publishedToWebAt: string | null;
  customerId: string | null;
  customerName: string | null;
  assignedSalespersonEmail: string;
  assignedSalespersonName: string;
  assignedSalespersonLineReady: number | boolean;
  showPrices: number | boolean;
  showSold: number | boolean;
  expiresAt: string | null;
  productCount: number;
  pageViews: number;
  productViews: number;
  contactClicks: number;
};
type CatalogItemDraft = {
  productId: string;
  displayPrice: string;
  description: string;
};
type CatalogDetail = {
  catalog: CatalogRow;
  items: Array<{
    productId: string;
    displayPrice: number | null;
    description: string;
  }>;
};
type CatalogList = { catalogs: CatalogRow[]; publicBaseUrl: string };

export function CatalogsPage() {
  const { data, error, reload } = useData<CatalogList>('/catalogs');
  const { data: products, reload: reloadProducts } = useData<Product[]>('/products');
  const { data: customers } = useData<Customer[]>('/customers');
  const { data: salespeople } = useData<Salesperson[]>('/salespeople');
  const [editorId, setEditorId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [assignedSalespersonEmail, setAssignedSalespersonEmail] = useState('');
  const [showSold, setShowSold] = useState(false);
  const [expires, setExpires] = useState('');
  const [items, setItems] = useState<CatalogItemDraft[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishingAll, setPublishingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  function resetEditor() {
    setEditorId(null);
    setTitle('');
    setDescription('');
    setCustomerId('');
    setAssignedSalespersonEmail(salespeople?.find((person) => person.lineReady)?.email ?? salespeople?.[0]?.email ?? '');
    setShowSold(false);
    setExpires('');
    setItems([]);
  }
  function newCatalog() {
    resetEditor();
    setErrorMessage('');
    setNotice('');
    setEditorId('new');
  }
  async function editCatalog(id: string) {
    setBusy(true);
    setErrorMessage('');
    try {
      const detail = await api<CatalogDetail>(`/catalogs/${id}`);
      setEditorId(id);
      setTitle(detail.catalog.title);
      setDescription(detail.catalog.description);
      setCustomerId(detail.catalog.customerId ?? '');
      setAssignedSalespersonEmail(detail.catalog.assignedSalespersonEmail ?? '');
      setShowSold(Boolean(detail.catalog.showSold));
      setExpires(detail.catalog.expiresAt?.slice(0, 10) ?? '');
      setItems(
        detail.items.map((item) => ({
          productId: item.productId,
          displayPrice:
            item.displayPrice == null ? '' : String(item.displayPrice),
          description: item.description,
        })),
      );
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function toggleProduct(product: Product) {
    setItems((current) =>
      current.some((item) => item.productId === product.id)
        ? current.filter((item) => item.productId !== product.id)
        : [
            ...current,
            {
              productId: product.id,
              displayPrice: String(product.sellingPrice),
              description:
                product.catalogDetail ||
                product.descriptionEn ||
                product.descriptionTh ||
                product.shortDescription,
            },
          ],
    );
  }
  function moveItem(index: number, offset: number) {
    setItems((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  async function saveCatalog(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const payload = {
        title,
        description,
        customerId: customerId || null,
        assignedSalespersonEmail,
        showPrices: false,
        showSold,
        expiresAt: expires ? `${expires}T23:59:59.999Z` : null,
        items: items.map((item) => ({
          productId: item.productId,
          displayPrice:
            item.displayPrice === '' ? null : Number(item.displayPrice),
          description: item.description,
        })),
      };
      const result =
        editorId === 'new'
          ? await api<{ id: string; slug: string }>('/catalogs', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
          : await api<{ id: string; slug: string }>(`/catalogs/${editorId}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
      resetEditor();
      reload();
      setNotice(t('Catalog saved.'));
      if (result.slug && data?.publicBaseUrl)
        await navigator.clipboard
          .writeText(
            `${data.publicBaseUrl.replace(/\/$/, '')}/s/${result.slug}`,
          )
          .catch(() => undefined);
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyCatalogLink(slug: string) {
    if (!data?.publicBaseUrl) return;
    try {
      await navigator.clipboard.writeText(
        `${data.publicBaseUrl.replace(/\/$/, '')}/s/${slug}`,
      );
      setNotice(t('Catalog link copied.'));
    } catch {
      setErrorMessage(t('Could not copy the link.'));
    }
  }
  async function catalogAction(id: string, action: 'duplicate' | 'archive') {
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await api<{ slug?: string }>(`/catalogs/${id}/${action}`, {
        method: 'POST',
      });
      if (action === 'duplicate' && result.slug && data?.publicBaseUrl)
        await navigator.clipboard
          .writeText(
            `${data.publicBaseUrl.replace(/\/$/, '')}/s/${result.slug}`,
          )
          .catch(() => undefined);
      reload();
      setNotice(
        t(action === 'duplicate' ? 'Catalog duplicated.' : 'Catalog archived.'),
      );
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleWebPublish(catalog: CatalogRow) {
    setBusy(true);
    setErrorMessage('');
    try {
      await api(`/catalogs/${catalog.id}/${catalog.publishToWeb ? 'unpublish-from-web' : 'publish-to-web'}`, { method: 'POST' });
      reload();
      setNotice(t(catalog.publishToWeb ? 'Catalog removed from website.' : 'Catalog published to website.'));
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publishAllProducts() {
    setPublishingAll(true);
    setErrorMessage('');
    setNotice('');
    try {
      const result = await api<{ published: number }>('/products/publish-all', {
        method: 'POST',
      });
      reload();
      reloadProducts();
      setNotice(`${result.published} ${t('products published without prices.')}`);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPublishingAll(false);
    }
  }

  const eligibleProducts = (products ?? []).filter(
    (product) =>
      product.isPublished &&
      product.publicSlug &&
      `${product.brand} ${product.model} ${product.sku} ${product.category}`
        .normalize('NFKC')
        .toLocaleLowerCase()
        .includes(query.trim().normalize('NFKC').toLocaleLowerCase()),
  );
  const catalogProducts = new Map(
    (products ?? []).map((product) => [product.id, product]),
  );

  return (
    <>
      <Header
        title={t('Shareable catalogs')}
        subtitle={t('Build a curated product collection and share one link.')}
        action={
          <div className="button-row">
            {data?.publicBaseUrl && (
              <a
                className="button"
                href={`${data.publicBaseUrl.replace(/\/$/, '')}/catalog`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} /> {t('Open public catalog')}
              </a>
            )}
            <button type="button" disabled={publishingAll} onClick={() => void publishAllProducts()}>
              {publishingAll ? t('Publishing…') : t('Publish all products without prices')}
            </button>
            <button className="primary" type="button" onClick={newCatalog}>
              <Plus size={16} /> {t('Create catalog')}
            </button>
          </div>
        }
      />
      <ErrorBox message={errorMessage || error} />
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {!data ? <Loading /> : null}
      {editorId && (
        <section className="panel catalog-editor">
          <div className="section-heading">
            <h2>{t(editorId === 'new' ? 'Create catalog' : 'Edit catalog')}</h2>
            <button type="button" aria-label={t('Close')} onClick={resetEditor}>
              <X size={17} />
            </button>
          </div>
          <form onSubmit={(event) => void saveCatalog(event)}>
            <div className="form-grid">
              <Field label={t('Catalog title')}>
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label={t('Associate customer (optional)')}>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">{t('No customer')}</option>
                  {customers?.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.companyName || customer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Responsible salesperson *')}>
                <select required value={assignedSalespersonEmail} onChange={(e) => setAssignedSalespersonEmail(e.target.value)}>
                  <option value="">{t('Choose a salesperson')}</option>
                  {salespeople?.map((person) => <option key={person.email} value={person.email}>{salespersonName(person)} · {person.email} · {person.lineReady ? t('LINE connected') : t('LINE not connected')}</option>)}
                </select>
                {assignedSalespersonEmail && !salespeople?.find((person) => person.email === assignedSalespersonEmail)?.lineReady && <small className="field-hint">{t('This salesperson must connect LINE to receive catalog chat alerts.')}</small>}
              </Field>
            </div>
            <Field label={t('Catalog description')}>
              <textarea
                rows={3}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="form-grid catalog-options">
              <label className="quotation-check">
                <input
                  type="checkbox"
                  checked={showSold}
                  onChange={(e) => setShowSold(e.target.checked)}
                />
                {t('Include sold products')}
              </label>
              <Field label={t('Expiration date (optional)')}>
                <input
                  type="date"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('Search published products')}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search brand, model, SKU, or category')}
              />
            </Field>
            <div className="catalog-product-picker">
              {eligibleProducts.map((product) => {
                const checked = items.some(
                  (item) => item.productId === product.id,
                );
                return (
                  <label className="catalog-product-option" key={product.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProduct(product)}
                    />
                    {product.primaryImageId ? (
                      <img
                        src={`/api/images/${product.primaryImageId}`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="catalog-thumb-placeholder" />
                    )}
                    <span>
                      <strong>
                        {product.brand} {product.model}
                      </strong>
                      <small>
                        {t('Specification')}: {product.targetBodyPart || '—'}
                      </small>
                      <small>
                        {product.sku} · {product.category} ·{' '}
                        {money(product.sellingPrice)}
                      </small>
                    </span>
                  </label>
                );
              })}
              {!eligibleProducts.length && (
                <p className="muted">
                  {t(
                    query
                      ? 'No published products match your search.'
                      : 'Publish products from their detail page before adding them to a shareable catalog.',
                  )}
                </p>
              )}
            </div>
            <div className="catalog-order-list">
              <h3>
                {t('Selected products')} · {items.length}
              </h3>
              {items.map((item, index) => {
                const product = catalogProducts.get(item.productId);
                return (
                  <div className="catalog-order-item" key={item.productId}>
                    <div className="catalog-order-actions">
                      <button
                        type="button"
                        aria-label={t('Move item up')}
                        disabled={index === 0}
                        onClick={() => moveItem(index, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('Move item down')}
                        disabled={index === items.length - 1}
                        onClick={() => moveItem(index, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                    <span>
                      <strong>
                        {product
                          ? `${product.brand} ${product.model}`
                          : t('Product unavailable')}
                      </strong>
                      {product && (
                        <small>
                          {t('Specification')}: {product.targetBodyPart || '—'}
                        </small>
                      )}
                    </span>
                    <input
                      aria-label={t('Catalog display price')}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={item.displayPrice}
                      onChange={(e) =>
                        setItems((current) =>
                          current.map((value, i) =>
                            i === index
                              ? { ...value, displayPrice: e.target.value }
                              : value,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={t('Remove product')}
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="form-actions">
              <button type="button" onClick={resetEditor}>
                {t('Cancel')}
              </button>
              <button className="primary" disabled={busy || items.length === 0}>
                {busy ? t('Saving…') : t('Save catalog')}
              </button>
            </div>
          </form>
        </section>
      )}
      {data?.catalogs.map((catalog) => (
        <article className="panel catalog-row" key={catalog.id}>
          <div className="catalog-row-main">
            <div className="catalog-row-title">
              <Share2 size={18} />
              <div>
                <h2>{catalog.title}</h2>
                <small>{catalog.description || t('No description')}</small>
                {Boolean(catalog.publishToWeb) && <small>{catalog.expiresAt && Date.parse(catalog.expiresAt) <= Date.now() ? t('Website publication expired') : t('Published on website')}</small>}
              </div>
            </div>
            <div className="catalog-row-stats">
              <span>
                {catalog.productCount} {t('Products')}
              </span>
              <span>
                {catalog.pageViews} {t('Page views')}
              </span>
              <span>
                {catalog.productViews} {t('Product views')}
              </span>
              <span>
                {catalog.contactClicks} {t('Contact clicks')}
              </span>
              {catalog.customerName && (
                <span>
                  {t('Customer')}: {catalog.customerName}
                </span>
              )}
              <span>{t('Salesperson')}: {catalog.assignedSalespersonName || catalog.assignedSalespersonEmail}{!catalog.assignedSalespersonLineReady && ` · ${t('LINE not connected')}`}</span>
              {catalog.expiresAt && (
                <span>
                  {t('Expires:')}{' '}
                  {new Date(catalog.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          {catalog.status === 'ACTIVE' ? (
            <div className="catalog-row-actions">
              <button type="button" disabled={busy} onClick={() => void toggleWebPublish(catalog)}>
                {t(catalog.publishToWeb ? 'Unpublish from Website' : 'Publish to Website')}
              </button>
              {Boolean(catalog.publishToWeb) && (!catalog.expiresAt || Date.parse(catalog.expiresAt) > Date.now()) && (
                <a className="button" href={`https://corevityusedgym.com/th/catalog/${encodeURIComponent(catalog.slug)}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> {t('Open on Website')}
                </a>
              )}
              <button
                type="button"
                onClick={() => void copyCatalogLink(catalog.slug)}
              >
                <Copy size={14} />
                {t('Copy link')}
              </button>
              {data.publicBaseUrl && (
                <a
                  className="button"
                  href={`${data.publicBaseUrl.replace(/\/$/, '')}/s/${catalog.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  {t('Preview')}
                </a>
              )}
              <button
                type="button"
                onClick={() => void editCatalog(catalog.id)}
              >
                {t('Edit')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void catalogAction(catalog.id, 'duplicate')}
              >
                <Copy size={14} />
                {t('Duplicate')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void catalogAction(catalog.id, 'archive')}
              >
                <Archive size={14} />
                {t('Archive')}
              </button>
            </div>
          ) : (
            <span className="badge">{t('Archived')}</span>
          )}
        </article>
      ))}
      {data && !data.catalogs.length && (
        <section className="panel empty">
          <h2>{t('No catalogs yet')}</h2>
          <p>
            {t(
              'Create a shareable collection to send selected equipment to a customer.',
            )}
          </p>
        </section>
      )}
      {data && !data.publicBaseUrl && (
        <p className="muted">
          {t('Public catalog URL is not configured yet.')}
        </p>
      )}
    </>
  );
}
