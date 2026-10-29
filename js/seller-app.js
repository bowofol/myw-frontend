import { api } from './api-client.js';
import {
  account,
  getCurrentAccount,
  subscribeAccount,
  profileName,
} from './auth.js';

const statuses = {
  pending: {
    label: 'Pending Review',
    className: 'status-pending-review',
    description:
      'Your item has been submitted and is waiting for the team to review it.',
  },
  published: {
    label: 'Published',
    className: 'status-published',
    description:
      'Your item is visible in the Newpage Material Managers marketplace.',
  },
  sold: {
    label: 'Sold',
    className: 'status-sold',
    description: 'This item has been marked as sold.',
  },
};
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Build an allowlisted multipart body. Contact details are displayed from the
// account, but identity, permissions and status are always decided by the server.
export function submissionBody(form) {
  const values = new FormData(form);
  const body = new FormData();
  for (const field of [
    'title',
    'description',
    'category',
    'condition',
    'location',
  ]) {
    const value = String(values.get(field) || '').trim();
    if (!value) throw new Error('Complete all product details.');
    body.append(field, value);
  }
  const amount = String(values.get('sellerExpectedRate') || '').trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount))
    throw new Error(
      'Enter an expected amount from 0 to 9999999999.99, with at most two decimal places.',
    );
  body.append('seller_expected_amount', amount);
  const files = [...form.elements.photos.files];
  if (!files.length || files.length > 6)
    throw new Error('Add between 1 and 6 product images.');
  if (files.some((file) => !allowedTypes.has(file.type)))
    throw new Error('Only JPEG, PNG and WebP images are accepted.');
  if (files.some((file) => !file.size || file.size > 5 * 1024 * 1024))
    throw new Error('Each image must contain data and be at most 5 MB.');
  for (const file of files) body.append('images', file, file.name);
  return body;
}

function safeProducts(data, page) {
  if (
    !Array.isArray(data.products) ||
    data.products.some(
      (product) =>
        !Number.isSafeInteger(product.id) ||
        product.id < 1 ||
        !statuses[product.status] ||
        !Array.isArray(product.images),
    ) ||
    data.pagination?.page !== page ||
    typeof data.pagination.has_more !== 'boolean'
  ) {
    throw new Error(
      'The backend returned unexpected product history. Please retry.',
    );
  }
  return data.products;
}

initializeSellerShell();
export const sellerAppReady = initialize();

async function initialize() {
  const main = document.querySelector('[data-auth-protected="seller"]');
  const form = document.querySelector('#item-submission-form');
  if (!main || !form || form.dataset.sellerReady) return false;
  form.dataset.sellerReady = 'true';
  const panel = document.querySelector('#item-submission');
  const open = document.querySelector('[data-open-item-form]');
  const close = document.querySelector('[data-close-item-form]');
  const submit = form.querySelector('[type="submit"]');
  const idleMarkup = submit.innerHTML;
  const message = document.querySelector('#item-submission-message');
  const state = document.querySelector('[data-listings-state]');
  const cards = document.querySelector('[data-seller-listings]');
  const summary = document.querySelector('[data-listing-summary]');
  const refresh = document.querySelector('[data-listings-refresh]');
  const more = document.querySelector('[data-listings-more]');
  const fields = [...form.querySelectorAll('input, select, textarea, button')];
  const filters = [...summary.querySelectorAll('[data-listing-filter]')];
  const previews = document.querySelector('[data-photo-previews]');
  const photoSummary = document.querySelector('[data-photo-summary]');
  const previewReaders = new Set();
  let previewGeneration = 0;
  function clearPreviews() {
    previewGeneration++;
    previewReaders.forEach(reader => { if (reader.readyState === FileReader.LOADING) reader.abort(); });
    previewReaders.clear();
    previews?.replaceChildren();
    if (photoSummary) photoSummary.textContent = 'No photos selected.';
  }
  function previewPhotos() {
    clearPreviews();
    if (!previews || !photoSummary) return;
    const files = [...form.elements.photos.files];
    photoSummary.textContent = `${files.length} ${files.length === 1 ? 'photo' : 'photos'} selected. Only you can see these previews.`;
    const version = previewGeneration;
    files.slice(0, 6).forEach((file, index) => {
      const figure = document.createElement('figure'); figure.setAttribute('role', 'listitem');
      const caption = document.createElement('figcaption'); caption.textContent = file.name;
      figure.append(caption); previews.append(figure);
      // Preview is presentation only. Existing submissionBody remains the validator.
      if (!allowedTypes.has(file.type) || !file.size || file.size > 5 * 1024 * 1024) return;
      const image = document.createElement('img'); image.alt = `Selected photo ${index + 1}: ${file.name}`; image.width = 160; image.height = 160;
      image.addEventListener('error', () => { image.remove(); }, { once: true });
      figure.prepend(image);
      const reader = new FileReader(); previewReaders.add(reader);
      reader.addEventListener('load', () => {
        if (version === previewGeneration && image.isConnected) image.src = reader.result;
      }, { once: true });
      reader.addEventListener('loadend', () => previewReaders.delete(reader), { once: true });
      reader.readAsDataURL(file);
    });
  }
  form.elements.photos.addEventListener('change', previewPhotos);
  form.addEventListener('reset', clearPreviews);
  window.addEventListener('pagehide', clearPreviews);
  window.addEventListener('pageshow', event => { if (event.persisted) previewPhotos(); });
  let permitted = false,
    sellerId = null,
    version = 0,
    saving = false;
  let products = [],
    filter = 'all',
    page = 0,
    hasMore = false,
    loaded = false,
    loading = null;

  for (const name of ['contactName', 'contactPhone', 'contactEmail'])
    form.elements[name].readOnly = true;
  open.setAttribute('aria-controls', panel.id);
  open.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-label', 'Status counts for loaded products');

  function controls() {
    fields.forEach((field) => {
      field.disabled = !permitted || saving;
    });
    open.disabled = close.disabled = !permitted || saving;
    open.title = permitted
      ? 'List an item for Newpage Material Managers to review'
      : 'Checking seller access';
    refresh.disabled = more.disabled = !permitted || saving || Boolean(loading);
    filters.forEach((button) => {
      const supported =
        button.dataset.listingFilter === 'all' ||
        Boolean(statuses[button.dataset.listingFilter]);
      button.disabled = !permitted || saving || !supported;
      button.title = supported
        ? 'Filter loaded products'
        : 'This status is not used by the current backend';
    });
  }
  function showMessage(text, success = false) {
    message.textContent = text;
    message.className = 'seller-message' + (success ? ' is-success' : '');
  }
  function fillContact(profile = account.snapshot().profile) {
    if (!profile) return;
    form.elements.contactName.value = profileName(profile);
    form.elements.contactPhone.value = profile.phone || '';
    form.elements.contactEmail.value = profile.email || '';
  }
  function historyMessage(text, retry = false) {
    state.hidden = false;
    state.className = 'dashboard-loading';
    state.textContent = text;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-small button-outline';
      button.textContent = 'Retry history';
      button.addEventListener('click', () => loadHistory());
      state.append(document.createTextNode(' '), button);
    }
  }
  function render() {
    cards.replaceChildren();
    summary.hidden = !loaded;
    more.hidden = !hasMore;
    summary.querySelectorAll('[data-listing-count]').forEach((element) => {
      const status = element.dataset.listingCount;
      element.textContent = String(
        status === 'all'
          ? products.length
          : products.filter((product) => product.status === status).length,
      );
    });
    filters.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.listingFilter === filter));
      button.classList.toggle(
        'is-active',
        button.dataset.listingFilter === filter,
      );
    });
    const shown =
      filter === 'all'
        ? products
        : products.filter((product) => product.status === filter);
    if (!products.length)
      historyMessage(
        'No listings submitted yet. Use List your item to submit your first product.',
      );
    else if (!shown.length)
      historyMessage(
        'No loaded listings match this status.' +
          (hasMore ? ' Load more to see older products.' : ''),
      );
    else if (hasMore)
      historyMessage(
        `Showing ${products.length} products. Counts cover loaded products; load more for older submissions.`,
      );
    else state.hidden = true;

    for (const product of shown) {
      const article = document.createElement('article');
      article.className = 'seller-listing';
      article.dataset.productId = String(product.id);
      const details = document.createElement('div');
      details.className = 'seller-listing-copy';
      const title = document.createElement('h3');
      title.textContent = product.title;
      const meta = document.createElement('p');
      const date = new Date(product.created_at);
      meta.textContent = `${product.category} · Submitted ${Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date)}`;
      const status = statuses[product.status];
      const description = document.createElement('p');
      description.className = 'item-status-detail';
      description.textContent = status.description;
      details.append(title, meta, description);
      if (
        product.public_rate !== null &&
        product.public_rate !== undefined &&
        /^\d{1,10}(?:\.\d{1,2})?$/.test(String(product.public_rate))
      ) {
        const rate = document.createElement('p');
        rate.className = 'item-status-detail';
        rate.textContent =
          'Admin-approved public Rate: ' +
          new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
          }).format(Number(product.public_rate));
        details.append(rate);
      }
      if (product.images.length) {
        // Reuse the existing gallery styles, with session cookies on image reads.
        const gallery = document.createElement('div');
        gallery.className = 'admin-gallery';
        for (const image of product.images) {
          if (!Number.isSafeInteger(image.id) || image.id < 1) continue;
          const link = document.createElement('a');
          link.href = api.url(`/product-images/${image.id}`);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `View image of ${product.title}`);
          const img = document.createElement('img');
          img.crossOrigin = 'use-credentials';
          img.alt = product.title;
          img.width = 78;
          img.height = 68;
          img.loading = 'lazy';
          img.src = link.href;
          img.addEventListener('error', () => {
            img.hidden = true;
            link.textContent = 'Retry image';
          });
          link.append(img);
          gallery.append(link);
        }
        details.append(gallery);
      } else {
        const empty = document.createElement('div');
        empty.className = 'seller-listing-no-photo';
        empty.textContent = 'No photos available';
        details.append(empty);
      }
      if (product.status === 'published') {
        const link = document.createElement('a');
        link.className = 'seller-listing-link';
        link.href = `product.html?id=${product.id}`;
        link.textContent = 'View public listing \u2197';
        details.append(link);
      }
      const badge = document.createElement('span');
      badge.className = 'seller-status ' + status.className;
      badge.textContent = status.label;
      article.append(details, badge);
      cards.append(article);
    }
  }

  async function loadHistory(append = false) {
    if (!permitted) return false;
    if (loading) return loading;
    const currentVersion = version;
    const nextPage = append ? page + 1 : 1;
    historyMessage(
      append
        ? 'Loading more products...'
        : 'Loading your submitted products...',
    );
    const work = (async () => {
      try {
        const data = await api.request(
          'GET',
          `/seller/products?page=${nextPage}&limit=20`,
        );
        if (currentVersion !== version) return false;
        const rows = safeProducts(data, nextPage);
        products = append
          ? [
              ...new Map(
                [...products, ...rows].map((product) => [product.id, product]),
              ).values(),
            ]
          : rows;
        page = nextPage;
        hasMore = data.pagination.has_more;
        loaded = true;
        render();
        return true;
      } catch (error) {
        if (currentVersion !== version) return false;
        loaded = false;
        historyMessage(
          (error.message || 'Unable to load your product history.') +
            (products.length
              ? ' Previously loaded products are shown below.'
              : ''),
          true,
        );
        // Confirm session failures through the existing account manager. A network
        // error never clears identity or calls logout.
        if (error.code === 'HTTP' && [401, 403].includes(error.status))
          getCurrentAccount({ force: true }).catch(() => {});
        return false;
      }
    })();
    loading = work;
    controls();
    try {
      return await work;
    } finally {
      if (loading === work) loading = null;
      controls();
    }
  }

  function accountChanged(snapshot) {
    const valid =
      snapshot.status === 'authenticated' &&
      snapshot.profile?.role === 'seller' &&
      snapshot.profile.status === 'active';
    permitted = valid;
    if (valid) {
      if (sellerId !== snapshot.user.id) {
        version++;
        sellerId = snapshot.user.id;
        products = [];
        loaded = false;
        loading = null;
        page = 0;
        hasMore = false;
      }
      fillContact(snapshot.profile);
    } else if (
      snapshot.status === 'guest' ||
      (snapshot.status === 'authenticated' && !valid)
    ) {
      version++;
      sellerId = null;
      products = [];
      loaded = false;
      loading = null;
      page = 0;
      hasMore = false;
      cards.replaceChildren();
      summary.hidden = more.hidden = true;
      panel.hidden = true;
      form.reset();
      showMessage('');
    }
    controls();
    if (valid && !loaded && !loading) loadHistory();
  }

  open.addEventListener('click', () => {
    if (!permitted || saving) return;
    fillContact();
    panel.hidden = false;
    open.setAttribute('aria-expanded', 'true');
    form.elements.title.focus();
  });
  close.addEventListener('click', () => {
    if (saving) return;
    panel.hidden = true;
    open.setAttribute('aria-expanded', 'false');
  });
  filters.forEach((button) =>
    button.addEventListener('click', () => {
      if (!permitted || button.disabled) return;
      filter = button.dataset.listingFilter;
      render();
    }),
  );
  refresh.addEventListener('click', () => loadHistory());
  more.addEventListener('click', () => loadHistory(true));
  window.addEventListener('online', () => {
    if (!loaded) loadHistory();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !permitted) return;
    showMessage('');
    if (!form.reportValidity()) {
      showMessage('Please correct the highlighted fields and try again.');
      return;
    }
    let body;
    try {
      body = submissionBody(form);
    } catch (error) {
      showMessage(error.message);
      return;
    }
    const currentVersion = version;
    saving = true;
    controls();
    submit.textContent = 'Submitting for review...';
    showMessage('Uploading product details and images...');
    try {
      const data = await api.request('POST', '/products', body, {
        timeoutMs: 120000,
      });
      if (currentVersion !== version) return;
      if (
        !Number.isSafeInteger(data.product?.id) ||
        data.product.id < 1 ||
        data.product.status !== 'pending'
      )
        throw new Error(
          'The backend did not confirm a pending product. Check My listings before submitting again.',
        );
      form.reset();
      fillContact();
      filter = 'all';
      showMessage(
        'Your product was submitted successfully. Its status is Pending Review.',
        true,
      );
      // A history-read failure must not turn a confirmed submission into an error
      // or invite an accidental duplicate. History has its own Retry control.
      if (loading) await loading;
      if (currentVersion === version) {
        loaded = false;
        await loadHistory();
      }
    } catch (error) {
      if (currentVersion !== version) return;
      const uncertain =
        error.code === 'NETWORK' ||
        error.code === 'PROTOCOL' ||
        error.status >= 500;
      showMessage(
        (error.message || 'Unable to submit this product.') +
          (uncertain
            ? ' Submission could not be confirmed. Refresh My listings before submitting again.'
            : ''),
      );
      if (error.code === 'HTTP' && [401, 403].includes(error.status))
        getCurrentAccount({ force: true }).catch(() => {});
    } finally {
      saving = false;
      submit.innerHTML = idleMarkup;
      controls();
    }
  });

  subscribeAccount(accountChanged);
  accountChanged(account.snapshot());
  try {
    await getCurrentAccount();
    return true;
  } catch {
    return false; /* The shared navigation owns session recovery. */
  }
}

// Presentation only: reuse the existing navigation toggle, account controls and
// submission trigger. Authentication and all API requests stay with their owners.
function initializeSellerShell() {
  const sidebar = document.querySelector('.seller-sidebar');
  const toggle = document.querySelector('.menu-toggle');
  if (!sidebar || !toggle) return;
  const main = document.querySelector('#main');
  const footer = document.querySelector('.site-footer');
  const backdrop = document.querySelector('[data-sidebar-backdrop]');
  const close = document.querySelector('[data-sidebar-close]');
  const openForm = document.querySelector('[data-open-item-form]');
  const formPanel = document.querySelector('#item-submission');
  const links = [...sidebar.querySelectorAll('[data-seller-section]')];
  const mobile = matchMedia('(max-width: 1023px)');
  let drawerOpen = false;
  let sectionFocus = false;

  function active(id) {
    links.forEach(link => {
      if (link.dataset.sellerSection === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function closeDrawer() {
    if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  }
  function syncDrawer() {
    const open = mobile.matches && toggle.getAttribute('aria-expanded') === 'true';
    sidebar.inert = mobile.matches && !open;
    main.inert = open;
    footer.inert = open;
    backdrop.hidden = !open;
    document.body.classList.toggle('seller-drawer-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      if (!drawerOpen) close.focus({ preventScroll: true });
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      if (drawerOpen && !sectionFocus && mobile.matches) toggle.focus({ preventScroll: true });
    }
    drawerOpen = open;
    sectionFocus = false;
  }
  function navigate(id) {
    if (id === 'item-submission') {
      if (openForm.disabled) return;
      openForm.click();
    }
    const target = document.getElementById(id);
    if (!target) return;
    sectionFocus = true;
    closeDrawer();
    // Clear the inert background before focusing an in-page destination.
    syncDrawer();
    active(id);
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    const heading = target.querySelector('h1,h2');
    if (id !== 'item-submission' && heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else if (id === 'item-submission') {
      document.querySelector('#item-title').focus({ preventScroll: true });
    }
  }
  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const id = link.dataset.sellerSection;
    if (id === 'item-submission' && openForm.disabled) return;
    history.replaceState(null, '', '#' + id);
    navigate(id);
  }));
  close.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  new MutationObserver(syncDrawer).observe(toggle, { attributes: true, attributeFilter: ['aria-expanded'] });
  new MutationObserver(() => {
    if (!formPanel.hidden) active('item-submission');
    else if (sidebar.querySelector('[data-seller-section="item-submission"][aria-current]')) {
      active('main');
      openForm.focus({ preventScroll: true });
    }
  }).observe(formPanel, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => {
    if (!openForm.disabled && location.hash === '#item-submission' && formPanel.hidden) navigate('item-submission');
  }).observe(openForm, { attributes: true, attributeFilter: ['disabled'] });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (links.some(link => link.dataset.sellerSection === id)) navigate(id);
  });
  document.addEventListener('keydown', event => {
    if (!drawerOpen || event.key !== 'Tab') return;
    const items = [...sidebar.querySelectorAll('a[href],button,summary')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  });
  mobile.addEventListener('change', () => {
    const focusWasOnHiddenControl = document.activeElement === close || document.activeElement === toggle;
    closeDrawer();
    syncDrawer();
    if (mobile.matches && sidebar.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    else if (!mobile.matches && focusWasOnHiddenControl) sidebar.querySelector('[data-seller-section][aria-current]')?.focus({ preventScroll: true });
  });
  syncDrawer();
}
