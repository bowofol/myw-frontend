import { api } from './api-client.js';
import { account, subscribeAccount } from './auth.js';
import {
  browseState,
  productsQuery,
  publicPage,
  productCard,
  imageFallbacks,
  setupPublicNavigation,
} from './public-products.js';

setupPublicNavigation();
const grid = document.querySelector('#product-grid');
const search = document.querySelector('#listing-search');
const categories = document.querySelector('#category-options');
const count = document.querySelector('#results-count');
const empty = document.querySelector('#empty-state');
const state = document.querySelector('#marketplace-state');
const retry = document.querySelector('#marketplace-retry');
const pagination = document.querySelector('#marketplace-pagination');
const previous = document.querySelector('#previous-page');
const next = document.querySelector('#next-page');
const pageLabel = document.querySelector('#current-page');
const clear = document.querySelector('#clear-search');
const selected = document.querySelector('#active-filters');
const resetFilters = document.querySelector('#reset-filters');
const inventory = document.querySelector('.market-inventory');
const emptyTitle = document.querySelector('#empty-title');
const emptyDescription = document.querySelector('#empty-description');
const emptyReset = document.querySelector('#empty-reset');
const categoryNames = [
  'All Items',
  'Electronics',
  'Furniture',
  'Home & Kitchen',
  'Clothing',
  'Books',
  'Other Items',
];
let current = { q: '', category: '', page: 1 },
  generation = 0,
  searchTimer;

// Presentation only: the existing account manager remains the session owner.
function sellerInvitation(snapshot) {
  const seller = snapshot.status === 'authenticated' &&
    snapshot.profile?.role === 'seller' && snapshot.profile.status === 'active';
  document.querySelector('[data-market-seller-guest]').hidden = snapshot.status !== 'guest';
  document.querySelector('[data-market-seller-active]').hidden = !seller;
  document.querySelector('[data-market-seller-contact]').hidden = snapshot.status !== 'authenticated' || seller;
}
subscribeAccount(sellerInvitation);
sellerInvitation(account.snapshot());

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const revealed = new WeakSet();
const reveals = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    reveals.unobserve(entry.target);
    revealed.add(entry.target);
    if (!reducedMotion.matches) entry.target.classList.add('market-reveal-enter');
  }
}, { threshold: .06, rootMargin: '0px 0px -16px 0px' }) : null;
function observeReveals() {
  if (reducedMotion.matches) return;
  let cardOrder = 0;
  document.querySelectorAll('[data-market-reveal], .market-products .product-card').forEach((element) => {
    if (revealed.has(element)) return;
    if (element.classList.contains('product-card')) element.style.setProperty('--market-delay', `${cardOrder++ % 4 * 80}ms`);
    reveals?.observe(element);
  });
}
function clearGrid() {
  grid.querySelectorAll('.product-card').forEach(card => reveals?.unobserve(card));
  grid.replaceChildren();
}
observeReveals();
reducedMotion.addEventListener('change', () => {
  reveals?.disconnect();
  if (reducedMotion.matches) {
    document.querySelectorAll('.market-reveal-enter, .market-photo-ready').forEach(element => element.classList.remove('market-reveal-enter', 'market-photo-ready'));
  } else observeReveals();
});
window.addEventListener('pagehide', () => reveals?.disconnect());
window.addEventListener('pageshow', event => { if (event.persisted) observeReveals(); });
const editorial = document.querySelector('#market-editorial-image');
function editorialLoaded() {
  if (!editorial.naturalWidth || editorial.dataset.entranceComplete) return;
  editorial.dataset.entranceComplete = 'true';
  if (!reducedMotion.matches) editorial.closest('figure').classList.add('market-photo-ready');
}
function editorialFailed() {
  editorial.closest('picture').hidden = true;
  document.querySelector('.market-photo-fallback').hidden = false;
}
editorial.addEventListener('load', editorialLoaded, { once: true });
editorial.addEventListener('error', editorialFailed, { once: true });
if (editorial.complete) editorial.naturalWidth ? editorialLoaded() : editorialFailed();

function filterSummary() {
  selected.textContent = [current.category || 'All categories', current.q ? `Search: ${current.q}` : ''].filter(Boolean).join(' / ');
  resetFilters.hidden = !current.q && !current.category && current.page === 1;
}

function categoryOptions() {
  categories.replaceChildren();
  const names =
    current.category && !categoryNames.includes(current.category)
      ? [...categoryNames, current.category]
      : categoryNames;
  for (const [index, name] of names.entries()) {
    const label = document.createElement('label');
    label.className = 'category-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'category';
    input.value = index === 0 ? '' : name;
    input.checked = input.value === current.category;
    const text = document.createElement('span');
    text.textContent = name;
    label.append(input, text);
    categories.append(label);
  }
}
function updateUrl() {
  const params = new URLSearchParams();
  if (current.q) params.set('q', current.q);
  if (current.category) params.set('category', current.category);
  if (current.page > 1) params.set('page', String(current.page));
  const url = location.pathname + (params.size ? '?' + params.toString() : '');
  if (url !== location.pathname + location.search)
    history.pushState(null, '', url);
}
function errorState(error) {
  clearGrid();
  inventory.dataset.state = 'error';
  filterSummary();
  if (location.search) resetFilters.hidden = false;
  grid.setAttribute('aria-busy', 'false');
  empty.hidden = true;
  pagination.hidden = true;
  state.hidden = false;
  state.textContent =
    error.message || 'Unable to load the marketplace. Please retry.';
  retry.hidden = false;
  count.textContent = 'Marketplace unavailable';
}
async function load() {
  const version = ++generation;
  clearGrid();
  inventory.dataset.state = 'loading';
  filterSummary();
  grid.setAttribute('aria-busy', 'true');
  empty.hidden = true;
  retry.hidden = true;
  pagination.hidden = true;
  state.hidden = false;
  state.textContent = 'Loading published products...';
  count.textContent = 'Loading...';
  clear.hidden = !search.value;
  try {
    const route = productsQuery(current);
    const data = publicPage(await api.request('GET', route), current.page);
    if (version !== generation) return;
    grid.innerHTML = data.products
      .map((product) => productCard(product))
      .join('');
    imageFallbacks(grid);
    observeReveals();
    grid.setAttribute('aria-busy', 'false');
    state.hidden = true;
    empty.hidden = data.products.length > 0;
    inventory.dataset.state = data.products.length ? 'ready' : 'empty';
    const filtered = Boolean(current.q || current.category);
    emptyTitle.textContent = current.page > 1 ? 'No items on this page.' : filtered ? 'Nothing matches this edit.' : 'A new chapter is on its way.';
    emptyDescription.textContent = current.page > 1
      ? 'This page has no published items. Clear the current selection and return to the first page.'
      : filtered ? 'Try another search or category to discover more useful things.'
        : 'There are no published items available right now. Check back as Newpage adds acquired items for resale.';
    emptyReset.hidden = !filtered && current.page === 1;
    count.textContent = `${data.products.length} ${data.products.length === 1 ? 'item' : 'items'} on this page`;
    pageLabel.textContent = `Page ${current.page}`;
    previous.disabled = current.page === 1;
    next.disabled = !data.hasMore;
    pagination.hidden = current.page === 1 && !data.hasMore;
  } catch (error) {
    if (version === generation) errorState(error);
  }
}
function apply() {
  clearTimeout(searchTimer);
  current = {
    q: search.value.trim(),
    category: categories.querySelector('input:checked')?.value || '',
    page: 1,
  };
  updateUrl();
  load();
}
function reset() {
  clearTimeout(searchTimer);
  current = { q: '', category: '', page: 1 };
  search.value = '';
  categoryOptions();
  updateUrl();
  load();
}
categories.addEventListener('change', apply);
document.querySelector('#market-search').addEventListener('submit', (event) => {
  event.preventDefault();
  apply();
});
search.addEventListener('input', () => {
  clear.hidden = !search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(apply, 350);
});
clear.addEventListener('click', () => {
  search.value = '';
  apply();
  search.focus();
});
resetFilters.addEventListener('click', reset);
document.querySelector('#empty-reset').addEventListener('click', reset);
retry.addEventListener('click', restore);
previous.addEventListener('click', () => {
  clearTimeout(searchTimer);
  if (search.value.trim() !== current.q) {
    apply();
    return;
  }
  if (current.page > 1) {
    current = { ...current, page: current.page - 1 };
    updateUrl();
    load();
  }
});
next.addEventListener('click', () => {
  clearTimeout(searchTimer);
  if (search.value.trim() !== current.q) {
    apply();
    return;
  }
  current = { ...current, page: current.page + 1 };
  updateUrl();
  load();
});
window.addEventListener('popstate', restore);
window.addEventListener('pagehide', () => clearTimeout(searchTimer));
window.addEventListener('pageshow', (event) => {
  if (event.persisted) restore();
});
function restore() {
  clearTimeout(searchTimer);
  try {
    current = browseState(location.search);
    search.value = current.q;
    categoryOptions();
    load();
  } catch (error) {
    ++generation;
    categoryOptions();
    errorState(error);
  }
}
restore();
