import { api } from './api-client.js';
import { account, getCurrentAccount, subscribeAccount } from './auth.js';
import { escapeText } from './public-products.js';

const validId = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 4294967295;
export function enquiryPage(data, page) {
  if (
    !Array.isArray(data.enquiries) ||
    data.enquiries.some(
      (row) =>
        !validId(row.id) ||
        !validId(row.product_id) ||
        ['product_title', 'name', 'phone', 'message', 'created_at'].some(
          (field) => typeof row[field] !== 'string',
        ),
    ) ||
    data.pagination?.page !== page ||
    typeof data.pagination.has_more !== 'boolean'
  )
    throw new Error('The backend returned unexpected enquiries. Please retry.');
  return data.enquiries;
}
export function renderEnquiryCard(row) {
  const date = new Date(row.created_at);
  const submitted = Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
  const reference = 'NMM-' + String(row.product_id).padStart(4, '0');
  return `<article class="admin-enquiry-card" data-enquiry-id="${row.id}" style="overflow-wrap:anywhere"><div class="admin-submission-top"><div><p class="eyebrow">Received ${escapeText(submitted)}</p><h3>${escapeText(row.product_title)}</h3></div></div><div class="admin-detail-grid"><div><small>Customer</small><strong>${escapeText(row.name)}</strong></div><div><small>Phone number</small><strong>${escapeText(row.phone)}</strong></div><div><small>Product reference</small><strong>${escapeText(reference)}</strong></div></div><details class="admin-enquiry-message" open><summary>Message</summary><p class="admin-submission-description" style="white-space:pre-wrap">${escapeText(row.message)}</p></details></article>`;
}

export const adminEnquiriesReady = initialize();
async function initialize() {
  const main = document.querySelector('[data-auth-protected="admin"]');
  if (!main || main.dataset.enquiriesReady) return false;
  main.dataset.enquiriesReady = 'true';
  const state = document.querySelector('[data-admin-enquiries-state]');
  const cards = document.querySelector('[data-admin-enquiries]');
  const refresh = document.querySelector('[data-enquiries-refresh]');
  const pagination = document.querySelector('[data-enquiries-pagination]');
  const previous = document.querySelector('[data-enquiries-previous]');
  const next = document.querySelector('[data-enquiries-next]');
  const label = document.querySelector('[data-enquiries-page]');
  const count = document.querySelector('[data-admin-enquiry-count]');
  const clearCount = () => { if (count) count.textContent = '—'; };
  clearCount();
  let permitted = false,
    adminId = null,
    version = 0,
    loading = null,
    loaded = false;
  let page = 1,
    hasMore = false,
    retryAt = 0,
    cooldownTimer;
  function controls() {
    const disabled = !permitted || Boolean(loading) || Date.now() < retryAt;
    refresh.disabled = disabled;
    previous.disabled = disabled || page === 1;
    next.disabled = disabled || !hasMore;
    state.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled;
    });
  }
  function listMessage(text, retry = false) {
    state.hidden = false;
    state.textContent = text;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-outline admin-action';
      button.textContent = 'Retry enquiries';
      button.addEventListener('click', () => load(page));
      state.append(document.createTextNode(' '), button);
    }
  }
  async function load(requestedPage = 1) {
    if (!permitted || Date.now() < retryAt) return false;
    if (loading) return loading;
    const currentVersion = version;
    listMessage('Loading buyer enquiries...');
    const work = (async () => {
      try {
        const data = await api.request(
          'GET',
          `/admin/enquiries?page=${requestedPage}&limit=20`,
        );
        if (version !== currentVersion) return false;
        const rows = enquiryPage(data, requestedPage);
        cards.innerHTML = rows.map(renderEnquiryCard).join('');
        page = requestedPage;
        hasMore = data.pagination.has_more;
        loaded = true;
        if (count) { count.textContent = String(rows.length); count.title = `Enquiries on page ${requestedPage}; not a global total`; }
        if (rows.length) state.hidden = true;
        else listMessage('No enquiries have been received on this page.');
        pagination.hidden = page === 1 && !hasMore;
        label.textContent = `Page ${page}`;
        return true;
      } catch (error) {
        if (version !== currentVersion) return false;
        loaded = false;
        listMessage(
          (error.message || 'Unable to load enquiries.') +
            (cards.childElementCount
              ? ' Previously loaded enquiries are shown below.'
              : ''),
          true,
        );
        if (error.status === 429 && error.retryAfterMs) {
          retryAt = Date.now() + error.retryAfterMs;
          clearTimeout(cooldownTimer);
          cooldownTimer = setTimeout(controls, error.retryAfterMs + 10);
        }
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
    permitted =
      snapshot.status === 'authenticated' &&
      snapshot.profile?.role === 'admin' &&
      snapshot.profile.status === 'active';
    if (permitted) {
      if (adminId !== snapshot.user.id) {
        version++;
        adminId = snapshot.user.id;
        loading = null;
        loaded = false;
        cards.replaceChildren();
        clearCount();
        page = 1;
        hasMore = false;
      }
    } else if (
      snapshot.status === 'guest' ||
      snapshot.status === 'authenticated'
    ) {
      version++;
      adminId = null;
      loading = null;
      loaded = false;
      cards.replaceChildren();
      clearCount();
      pagination.hidden = true;
      listMessage('Sign in as an administrator to view enquiries.');
    }
    controls();
    if (permitted && !loaded && !loading && Date.now() >= retryAt) load(page);
  }
  const refreshEnquiries = async () => {
    if (loading || Date.now() < retryAt) return;
    try {
      await getCurrentAccount({ force: true });
      if (permitted) await load(1);
    } catch {
      /* Shared account UI offers recovery; never log out on an outage. */
    }
  };
  refresh.addEventListener('click', refreshEnquiries);
  document
    .querySelector('[data-admin-refresh]')
    ?.addEventListener('click', refreshEnquiries);
  previous.addEventListener('click', () => {
    if (page > 1) load(page - 1);
  });
  next.addEventListener('click', () => {
    if (hasMore) load(page + 1);
  });
  window.addEventListener('online', () => {
    if (!loaded) load(page);
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
