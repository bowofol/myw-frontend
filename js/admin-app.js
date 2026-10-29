import { api } from './api-client.js';
import { account, getCurrentAccount, subscribeAccount } from './auth.js';

const statuses = {
  pending: 'Pending Review',
  published: 'Published',
  sold: 'Sold',
};
const validId = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 4294967295;
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );

// Keep decimal strings all the way to MySQL. Reject exponents, rounding and zero.
export function parsePublicRate(value) {
  const input = String(value ?? '').trim();
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(input);
  if (!match || input.length !== match[0].length)
    throw new Error(
      'Enter a positive public Rate with at most 10 whole digits and 2 decimal places.',
    );
  const whole = BigInt(match[1]);
  const cents = (match[2] || '').padEnd(2, '0');
  if (whole * 100n + BigInt(cents) <= 0n)
    throw new Error('Public Rate must be greater than zero.');
  return `${whole}.${cents}`;
}

export function buildAdminProductUpdate(product, action, rateValue) {
  if (!validId(product?.id) || !Object.hasOwn(statuses, product.status))
    throw new Error('This product is unavailable. Refresh the dashboard.');
  if (action === 'publish' && product.status === 'pending')
    return { public_rate: parsePublicRate(rateValue) };
  if (action === 'sold' && product.status === 'published') return {};
  throw new Error('This action is unavailable for the current product status.');
}

export async function updateAdminProduct(client, product, action, rateValue) {
  const changes = buildAdminProductUpdate(product, action, rateValue);
  const data = await client.request(
    'PATCH',
    `/admin/products/${product.id}/${action}`,
    changes,
  );
  const saved = data.product;
  const expected = action === 'publish' ? 'published' : 'sold';
  if (
    !saved ||
    saved.id !== product.id ||
    saved.status !== expected ||
    (action === 'publish' &&
      parsePublicRate(saved.public_rate) !== changes.public_rate)
  ) {
    throw new Error(
      'The backend did not confirm the requested change. Refresh the dashboard before retrying.',
    );
  }
  return {
    id: saved.id,
    status: saved.status,
    ...(action === 'publish' ? { public_rate: changes.public_rate } : {}),
  };
}

export function adminProductPage(data, page) {
  if (
    !Array.isArray(data.products) ||
    data.products.some(
      (product) =>
        !validId(product.id) ||
        !Object.hasOwn(statuses, product.status) ||
        !validId(product.seller?.id) ||
        !Array.isArray(product.images),
    ) ||
    data.pagination?.page !== page ||
    typeof data.pagination.has_more !== 'boolean'
  ) {
    throw new Error(
      'The backend returned unexpected admin products. Please retry.',
    );
  }
  return data.products;
}

function formatAmount(value, fallback = 'Not provided') {
  if (
    value === null ||
    value === undefined ||
    !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))
  )
    return fallback;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(Number(value));
}
function displayDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : 'Date unavailable';
}
function whatsAppNumber(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '234' + digits.slice(1);
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

export function renderSubmissionCard(
  product,
  draftRate = product.public_rate ?? '',
) {
  const seller = product.seller || {};
  const sellerName =
    [seller.first_name, seller.last_name].filter(Boolean).join(' ') ||
    'Not provided';
  const id = String(product.id);
  const images = product.images.filter((image) => validId(image.id));
  const gallery = images.length
    ? `<div class="admin-gallery">${images
        .map((image, index) => {
          const url = escapeHtml(api.url(`/product-images/${image.id}`));
          return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" crossorigin="use-credentials" width="78" height="68" alt="${escapeHtml(product.title)} photo ${index + 1}" loading="lazy"></a>`;
        })
        .join('')}</div>`
    : '<div class="admin-gallery admin-gallery-empty">No photos available</div>';
  const contact = whatsAppNumber(seller.phone)
    ? `<button class="button button-outline admin-action" type="button" data-admin-action="contact" data-id="${id}">Contact seller</button>`
    : '<span class="admin-action-note">No usable WhatsApp number</span>';
  const publish =
    product.status === 'pending'
      ? `<label class="admin-rate-field">Public Rate <input type="number" min="0.01" max="9999999999.99" step="0.01" inputmode="decimal" required value="${escapeHtml(draftRate)}" placeholder="Enter public Rate" data-admin-rate="${id}"></label><button class="button admin-action" type="button" data-admin-action="publish" data-id="${id}">Publish product</button>`
      : '';
  const sold =
    product.status === 'published'
      ? `<button class="button button-outline admin-action" type="button" data-admin-action="sold" data-id="${id}">Mark Sold</button>`
      : '';
  const details = [
    ['Phone / WhatsApp', seller.phone || 'Not provided'],
    ['Email', seller.email || 'Not provided'],
    ['Location', product.location],
    ['Condition', product.condition],
  ]
    .map(
      ([label, value]) =>
        `<div><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('');
  return `<article class="admin-submission" data-product-id="${id}">
    ${gallery}
    <div class="admin-item-copy"><div class="admin-submission-top"><div><p class="eyebrow">${escapeHtml(product.category)} · Submitted ${escapeHtml(displayDate(product.created_at))}</p><h3>${escapeHtml(product.title)}</h3><p class="admin-item-seller">Seller: <strong>${escapeHtml(sellerName)}</strong></p></div><span class="seller-status status-${product.status === 'pending' ? 'pending-review' : product.status}">${statuses[product.status]}</span></div>
    <div class="admin-rate-summary"><div><small>Seller expected amount (private)</small><strong>${escapeHtml(formatAmount(product.seller_expected_amount))}</strong></div><div><small>Public Rate</small><strong>${escapeHtml(formatAmount(product.public_rate, 'Rate not set'))}</strong></div></div>
    <details class="admin-item-details"><summary>Seller &amp; item details</summary><div class="admin-detail-grid">${details}</div><h4>Description</h4><p class="admin-submission-description">${escapeHtml(product.description)}</p></details></div>
    <div class="admin-actions">${contact}${publish}${sold}</div></article>`;
}

initializeAdminShell();
export const adminAppReady = initialize();

// Shell presentation only. Shared auth-ui retains the original account guard,
// menu toggle and logout handlers; the inventory controller owns all mutations.
function initializeAdminShell() {
  const sidebar = document.querySelector('.admin-sidebar');
  const toggle = document.querySelector('.menu-toggle');
  if (!sidebar || !toggle) return;
  const main = document.querySelector('#main');
  const footer = document.querySelector('.site-footer');
  const close = document.querySelector('[data-admin-sidebar-close]');
  const backdrop = document.querySelector('[data-admin-sidebar-backdrop]');
  const links = [...sidebar.querySelectorAll('[data-admin-section]')];
  const mobile = matchMedia('(max-width: 1023px)');
  let drawerOpen = false;
  let sectionFocus = false;
  function active(id) {
    links.forEach(link => {
      if (link.dataset.adminSection === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function closeDrawer() {
    if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  }
  function syncDrawer() {
    const open = mobile.matches && toggle.getAttribute('aria-expanded') === 'true';
    sidebar.inert = mobile.matches && !open;
    main.inert = footer.inert = open;
    backdrop.hidden = !open;
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
    const target = document.getElementById(id);
    if (!target) return;
    sectionFocus = true;
    closeDrawer();
    syncDrawer();
    active(id);
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    const heading = target.querySelector('h1,h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    history.replaceState(null, '', '#' + link.dataset.adminSection);
    navigate(link.dataset.adminSection);
  }));
  document.querySelector('[data-admin-shortcut]')?.addEventListener('click', event => {
    event.preventDefault();
    const filter = document.querySelector('[data-admin-filter="pending"]');
    if (!filter || filter.disabled) return;
    filter.click();
    navigate('admin-inventory');
  });
  document.querySelector('[data-admin-enquiry-shortcut]')?.addEventListener('click', event => {
    event.preventDefault(); navigate('buyer-enquiries');
  });
  close.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  new MutationObserver(syncDrawer).observe(toggle, { attributes: true, attributeFilter: ['aria-expanded'] });
  document.addEventListener('keydown', event => {
    if (!drawerOpen || event.key !== 'Tab') return;
    const items = [...sidebar.querySelectorAll('a[href],button,summary')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  });
  mobile.addEventListener('change', () => {
    const hiddenControlFocused = document.activeElement === close || document.activeElement === toggle;
    closeDrawer(); syncDrawer();
    if (mobile.matches && sidebar.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    else if (!mobile.matches && hiddenControlFocused) sidebar.querySelector('[data-admin-section][aria-current]')?.focus({ preventScroll: true });
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (links.some(link => link.dataset.adminSection === id)) navigate(id);
  });
  syncDrawer();
}

async function initialize() {
  const main = document.querySelector('[data-auth-protected="admin"]');
  if (!main || main.dataset.adminReady) return false;
  main.dataset.adminReady = 'true';
  const state = document.querySelector('[data-admin-state]');
  const cards = document.querySelector('[data-admin-submissions]');
  const overview = document.querySelector('[data-admin-overview]');
  const select = document.querySelector('#admin-status-filter');
  const filters = [...overview.querySelectorAll('[data-admin-filter]')];
  const refresh = document.querySelector('[data-admin-refresh]');
  const more = document.querySelector('[data-admin-more]');
  const message = document.querySelector('[data-admin-action-message]');
  let permitted = false,
    adminId = null,
    version = 0,
    saving = false,
    loading = null;
  let products = [],
    selected = 'all',
    page = 0,
    hasMore = false,
    loaded = false;
  const drafts = new Map();

  // Display counts of this loaded inventory view, never invented global totals.
  const countNote = document.querySelector('[data-admin-count-note]');
  function renderCounts() {
    overview.querySelectorAll('[data-admin-count]').forEach(element => {
      const status = element.dataset.adminCount;
      element.textContent = loaded ? String(status === 'all' ? products.length : products.filter(product => product.status === status).length) : '—';
      element.title = 'Loaded listings in the current inventory view; not a global total';
    });
    if (countNote) countNote.textContent = `Global product totals are unavailable. Inventory counts cover loaded results in ${selected === 'all' ? 'All submissions' : statuses[selected]}; load more for older items. Buyer enquiries count covers the current enquiry page.`;
  }
  renderCounts();
  function controls() {
    const disabled = !permitted || saving || Boolean(loading);
    refresh.disabled = select.disabled = more.disabled = disabled;
    filters.forEach((button) => {
      button.disabled = disabled;
      button.setAttribute('aria-pressed', String(button.dataset.adminFilter === selected));
      button.classList.toggle(
        'is-active',
        button.dataset.adminFilter === selected,
      );
    });
    cards.querySelectorAll('button, input').forEach((control) => {
      control.disabled = disabled;
    });
  }
  function actionMessage(text, success = false) {
    message.textContent = text;
    message.className = 'seller-message' + (success ? ' is-success' : '');
  }
  function listMessage(text, retry = false) {
    state.hidden = false;
    state.textContent = text;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-outline admin-action';
      button.textContent = 'Retry products';
      button.addEventListener('click', () => loadProducts());
      state.append(document.createTextNode(' '), button);
    }
  }
  function sessionFailure(error) {
    if (error.code === 'HTTP' && [401, 403].includes(error.status))
      getCurrentAccount({ force: true }).catch(() => {});
  }
  function render() {
    renderCounts();
    cards.innerHTML = products
      .map((product) =>
        renderSubmissionCard(
          product,
          drafts.get(product.id) ?? product.public_rate ?? '',
        ),
      )
      .join('');
    more.hidden = !hasMore;
    if (!products.length)
      listMessage(
        selected === 'all'
          ? 'No seller submissions have been received yet.'
          : 'No products match this status.',
      );
    else if (hasMore)
      listMessage(
        `Showing ${products.length} products${selected === 'all' ? '' : ' with status ' + statuses[selected]}. Load more to review older submissions.`,
      );
    else state.hidden = true;
    cards
      .querySelectorAll('[data-admin-rate]')
      .forEach((input) =>
        input.addEventListener('input', () =>
          drafts.set(Number(input.dataset.adminRate), input.value),
        ),
      );
    cards
      .querySelectorAll('[data-admin-action]')
      .forEach((button) =>
        button.addEventListener('click', () => handleAction(button)),
      );
    cards.querySelectorAll('img').forEach((img) =>
      img.addEventListener('error', () => {
        img.hidden = true;
        img.parentElement.textContent = 'Open image';
      }),
    );
    controls();
  }

  async function loadProducts(append = false) {
    if (!permitted) return false;
    if (loading) return loading;
    const currentVersion = version;
    const nextPage = append ? page + 1 : 1;
    listMessage(
      append ? 'Loading more products...' : 'Loading seller submissions...',
    );
    const work = (async () => {
      try {
        const route =
          `/admin/products?page=${nextPage}&limit=20` +
          (selected === 'all' ? '' : `&status=${selected}`);
        const data = await api.request('GET', route);
        if (currentVersion !== version) return false;
        const rows = adminProductPage(data, nextPage);
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
        listMessage(
          (error.message || 'Unable to load seller submissions.') +
            (products.length
              ? ' Previously loaded products are shown below.'
              : ''),
          true,
        );
        sessionFailure(error);
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

  async function handleAction(button) {
    if (!permitted || saving || loading || main.hidden) return;
    const product = products.find(
      (value) => value.id === Number(button.dataset.id),
    );
    if (!product) return;
    const action = button.dataset.adminAction;
    if (action === 'contact') {
      const number = whatsAppNumber(product.seller.phone);
      if (number)
        window.open(
          `https://wa.me/${number}?text=${encodeURIComponent('Hello, Newpage Material Managers is contacting you about your submission: ' + product.title)}`,
          '_blank',
          'noopener,noreferrer',
        );
      return;
    }
    const rateValue = button
      .closest('.admin-submission')
      .querySelector('[data-admin-rate]')?.value;
    actionMessage('');
    let changes;
    try {
      changes = buildAdminProductUpdate(product, action, rateValue);
    } catch (error) {
      actionMessage(error.message);
      return;
    }
    const confirmation =
      action === 'sold'
        ? `Mark “${product.title}” sold? It will disappear from the active marketplace.`
        : `Publish “${product.title}” at ${formatAmount(changes.public_rate)}?`;
    if (!window.confirm(confirmation)) return;
    const currentVersion = version;
    saving = true;
    controls();
    actionMessage(
      action === 'publish'
        ? 'Publishing product...'
        : 'Marking product sold...',
    );
    try {
      const saved = await updateAdminProduct(api, product, action, rateValue);
      if (currentVersion !== version) return;
      Object.assign(product, saved);
      drafts.delete(product.id);
      products = products.filter(
        (value) => selected === 'all' || value.status === selected,
      );
      render();
      actionMessage(
        action === 'publish'
          ? 'Product published successfully.'
          : 'Product marked sold successfully.',
        true,
      );
      // Keep confirmed success even if the following read fails. No mutation is
      // repeated after a lost response; Retry products only performs a read.
      loaded = false;
      await loadProducts();
    } catch (error) {
      if (currentVersion !== version) return;
      const uncertain =
        error.code === 'NETWORK' ||
        error.code === 'PROTOCOL' ||
        error.status >= 500;
      actionMessage(
        (error.message || 'Unable to confirm the product change.') +
          (uncertain
            ? ' The change could not be confirmed. Refresh the dashboard before trying again.'
            : ''),
      );
      sessionFailure(error);
    } finally {
      saving = false;
      controls();
    }
  }

  function accountChanged(snapshot) {
    const valid =
      snapshot.status === 'authenticated' &&
      snapshot.profile?.role === 'admin' &&
      snapshot.profile.status === 'active';
    permitted = valid;
    if (valid) {
      if (adminId !== snapshot.user.id) {
        version++;
        adminId = snapshot.user.id;
        products = [];
        loaded = false;
        loading = null;
        page = 0;
        hasMore = false;
        drafts.clear();
        renderCounts();
      }
      overview.hidden = false;
    } else if (
      snapshot.status === 'guest' ||
      snapshot.status === 'authenticated'
    ) {
      version++;
      adminId = null;
      products = [];
      loaded = false;
      loading = null;
      page = 0;
      hasMore = false;
      drafts.clear();
      renderCounts();
      cards.replaceChildren();
      overview.hidden = true;
      more.hidden = true;
      actionMessage('');
    }
    controls();
    if (valid && !loaded && !loading) loadProducts();
  }
  function filterProducts(value) {
    if (
      !permitted ||
      saving ||
      loading ||
      (value !== 'all' && !Object.hasOwn(statuses, value))
    )
      return;
    selected = value;
    select.value = value;
    products = [];
    page = 0;
    hasMore = false;
    loaded = false;
    render();
    loadProducts();
  }
  select.addEventListener('change', () => filterProducts(select.value));
  filters.forEach((button) =>
    button.addEventListener('click', () =>
      filterProducts(button.dataset.adminFilter),
    ),
  );
  more.addEventListener('click', () => loadProducts(true));
  refresh.addEventListener('click', async () => {
    if (saving || loading) return;
    try {
      await getCurrentAccount({ force: true });
      if (permitted) await loadProducts();
    } catch {
      /* Shared account UI provides session retry. */
    }
  });
  window.addEventListener('online', () => {
    if (!loaded) loadProducts();
  });
  subscribeAccount(accountChanged);
  accountChanged(account.snapshot());
  try {
    await getCurrentAccount();
    return true;
  } catch {
    return false;
  }
}
