import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  GripVertical,
  ListOrdered,
  ImagePlus,
  Plus,
  Share2,
  Trash2,
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
  webSortOrder: number | null;
  coverImageId: string | null;
  customerId: string | null;
  customerName: string | null;
  assignedSalespersonEmail: string;
  assignedSalespersonName: string;
  assignedSalespersonLineReady: number | boolean;
  showPricePrivate: number | boolean;
  showPriceWeb: number | boolean;
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
  const [showPricePrivate, setShowPricePrivate] = useState(true);
  const [showPriceWeb, setShowPriceWeb] = useState(false);
  const [expires, setExpires] = useState('');
  const [items, setItems] = useState<CatalogItemDraft[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishingAll, setPublishingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [coverImageId, setCoverImageId] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [removeCover, setRemoveCover] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editorId && !dialog.open) dialog.showModal();
    if (!editorId && dialog.open) dialog.close();
  }, [editorId]);
  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  function resetEditor() {
    setEditorId(null);
    setTitle('');
    setDescription('');
    setCustomerId('');
    setAssignedSalespersonEmail(salespeople?.find((person) => person.lineReady)?.email ?? salespeople?.[0]?.email ?? '');
    setShowSold(false);
    setShowPricePrivate(true);
    setShowPriceWeb(false);
    setExpires('');
    setItems([]);
    setCoverImageId(null);
    setCoverFile(null);
    setRemoveCover(false);
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
      setShowPricePrivate(Boolean(detail.catalog.showPricePrivate));
      setShowPriceWeb(Boolean(detail.catalog.showPriceWeb));
      setExpires(detail.catalog.expiresAt?.slice(0, 10) ?? '');
      setCoverImageId(detail.catalog.coverImageId ?? null);
      setCoverFile(null);
      setRemoveCover(false);
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
        showPricePrivate,
        showPriceWeb,
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
      let coverError = '';
      try {
        if (coverFile) {
          const form = new FormData();
          form.append('file', coverFile);
          await api(`/catalogs/${result.id}/cover`, { method: 'POST', body: form });
        } else if (removeCover && coverImageId) {
          await api(`/catalogs/${result.id}/cover`, { method: 'DELETE' });
        }
      } catch (e) {
        coverError = (e as Error).message;
      }
      resetEditor();
      reload();
      setNotice(t('Catalog saved.'));
      if (coverError) setErrorMessage(`${t('The catalog was saved, but the cover image was not updated.')} ${coverError}`);
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
  async function deleteCatalog(catalog: CatalogRow) {
    if (
      !window.confirm(
        `${t('Delete this catalog permanently?')}\n\n${catalog.title}\n\n${t('Its share link and website page will stop working. This cannot be undone.')}`,
      )
    )
      return;
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      await api(`/catalogs/${catalog.id}`, { method: 'DELETE' });
      if (editorId === catalog.id) resetEditor();
      reload();
      setNotice(t('Catalog deleted.'));
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveWebOrder(ids: string[]) {
    await api('/catalogs/web-order', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
    setOrderOpen(false);
    reload();
    setErrorMessage('');
    setNotice(t('Website catalog order saved.'));
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
  const webCatalogs = (data?.catalogs ?? [])
    .filter((catalog) => catalog.status === 'ACTIVE' && Boolean(catalog.publishToWeb))
    .sort(
      (a, b) =>
        (a.webSortOrder ?? Number.MAX_SAFE_INTEGER) - (b.webSortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (b.publishedToWebAt ?? '').localeCompare(a.publishedToWebAt ?? '') ||
        a.slug.localeCompare(b.slug),
    );
  const webPosition = new Map(webCatalogs.map((catalog, index) => [catalog.id, index + 1]));
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
            {webCatalogs.length > 1 && (
              <button type="button" onClick={() => setOrderOpen(true)}>
                <ListOrdered size={15} /> {t('Website order')}
              </button>
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
      <ErrorBox message={(editorId ? '' : errorMessage) || error} />
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {!data ? <Loading /> : null}
      <dialog
        ref={dialogRef}
        className="catalog-editor-dialog"
        aria-labelledby="catalog-editor-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) resetEditor();
        }}
      >
      {editorId && (
        <section className="panel catalog-editor">
          <div className="section-heading">
            <h2 id="catalog-editor-title">{t(editorId === 'new' ? 'Create catalog' : 'Edit catalog')}</h2>
            <button type="button" aria-label={t('Close')} disabled={busy} onClick={resetEditor}>
              <X size={17} />
            </button>
          </div>
          <form onSubmit={(event) => void saveCatalog(event)}>
            <ErrorBox message={errorMessage} />
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
            <div className="catalog-cover-field">
              <span className="catalog-cover-label">{t('Cover image (optional)')}</span>
              <div className="catalog-cover-row">
                <div className="catalog-cover-preview">
                  {coverPreview ? (
                    <img src={coverPreview} alt={t('New cover image')} />
                  ) : coverImageId && !removeCover && editorId !== 'new' ? (
                    <img src={`/api/catalogs/${editorId}/cover?v=${encodeURIComponent(coverImageId)}`} alt={t('Current cover image')} />
                  ) : (
                    <span>{t('Uses the first product photo')}</span>
                  )}
                </div>
                <div className="catalog-cover-actions">
                  <label className="button">
                    <ImagePlus size={15} />
                    {t(coverPreview || (coverImageId && !removeCover) ? 'Change cover' : 'Upload cover')}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        e.target.value = '';
                        if (file) {
                          setCoverFile(file);
                          setRemoveCover(false);
                        }
                      }}
                    />
                  </label>
                  {(coverPreview || (coverImageId && !removeCover)) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCoverFile(null);
                        setRemoveCover(true);
                      }}
                    >
                      <Trash2 size={14} />
                      {t('Remove cover')}
                    </button>
                  )}
                  <small className="field-hint">{t('JPEG, PNG or WebP. Shown on the website catalog card and share preview.')}</small>
                </div>
              </div>
            </div>
            <div className="form-grid catalog-options">
              <label className="quotation-check">
                <input
                  type="checkbox"
                  checked={showSold}
                  onChange={(e) => setShowSold(e.target.checked)}
                />
                {t('Include sold products')}
              </label>
              <fieldset className="catalog-price-visibility">
                <legend>{t('Show product prices')}</legend>
                <label className="quotation-check">
                  <input
                    type="checkbox"
                    checked={showPricePrivate}
                    onChange={(e) => setShowPricePrivate(e.target.checked)}
                  />
                  {t('On the private share link')}
                </label>
                <label className="quotation-check">
                  <input
                    type="checkbox"
                    checked={showPriceWeb}
                    onChange={(e) => setShowPriceWeb(e.target.checked)}
                  />
                  {t('On the website')}
                </label>
                <small className="field-hint">
                  {t('Leave both unchecked to hide prices everywhere.')}
                </small>
              </fieldset>
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
      </dialog>
      {orderOpen && (
        <WebOrderDialog
          catalogs={webCatalogs}
          onClose={() => setOrderOpen(false)}
          onSave={saveWebOrder}
        />
      )}
      {data?.catalogs.map((catalog) => (
        <article className="panel catalog-row" key={catalog.id}>
          <div className="catalog-row-main">
            <div className="catalog-row-title">
              <Share2 size={18} />
              <div>
                <h2>{catalog.title}</h2>
                <small>{catalog.description || t('No description')}</small>
                {Boolean(catalog.publishToWeb) && <small>{catalog.expiresAt && Date.parse(catalog.expiresAt) <= Date.now() ? t('Website publication expired') : t('Published on website')}{webPosition.has(catalog.id) && ` · ${t('Position')} ${webPosition.get(catalog.id)}`}</small>}
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
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void deleteCatalog(catalog)}
              >
                <Trash2 size={14} />
                {t('Delete')}
              </button>
            </div>
          ) : (
            <div className="catalog-row-actions">
              <span className="badge">{t('Archived')}</span>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void deleteCatalog(catalog)}
              >
                <Trash2 size={14} />
                {t('Delete')}
              </button>
            </div>
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

function WebOrderDialog({
  catalogs,
  onClose,
  onSave,
}: {
  catalogs: CatalogRow[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [order, setOrder] = useState(catalogs);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  const changed = order.some((catalog, index) => catalog.id !== catalogs[index]?.id);
  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(order.map((catalog) => catalog.id));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="catalog-editor-dialog catalog-order-dialog"
      aria-labelledby="catalog-order-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <section className="panel catalog-editor">
        <div className="section-heading">
          <h2 id="catalog-order-title">{t('Website catalog order')}</h2>
          <button type="button" aria-label={t('Close')} disabled={saving} onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p className="muted">
          {t('Drag catalogs or use the arrows. The first one is featured on the website homepage.')}
        </p>
        <ErrorBox message={error} />
        <ol className="catalog-order-list catalog-web-order-list">
          {order.map((catalog, index) => (
            <li
              key={catalog.id}
              className={`catalog-order-item catalog-web-order-item${dragIndex === index ? ' dragging' : ''}`}
              draggable={!saving}
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex === null || dragIndex === index) return;
                move(dragIndex, index);
                setDragIndex(index);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <GripVertical size={16} className="catalog-drag-handle" aria-hidden="true" />
              <span className="catalog-web-order-position">{index + 1}</span>
              <span>
                <strong>{catalog.title}</strong>
                <small>
                  {catalog.productCount} {t('Products')}
                  {catalog.expiresAt && Date.parse(catalog.expiresAt) <= Date.now()
                    ? ` · ${t('Website publication expired')}`
                    : ''}
                </small>
              </span>
              <div className="catalog-order-actions">
                <button
                  type="button"
                  aria-label={`${t('Move catalog up')}: ${catalog.title}`}
                  disabled={saving || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`${t('Move catalog down')}: ${catalog.title}`}
                  disabled={saving || index === order.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="form-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" type="button" disabled={saving || !changed} onClick={() => void save()}>
            {saving ? t('Saving…') : t('Save order')}
          </button>
        </div>
      </section>
    </dialog>
  );
}
