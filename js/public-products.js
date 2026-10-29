import { api } from './api-client.js';

export const escapeText = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );
const validId = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= 4294967295;

export function productId(value) {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !/^[1-9]\d{0,9}$/.test(value) ||
    value.length > 10 ||
    Number(value) > 4294967295
  )
    return null;
  return Number(value);
}

// An explicit public projection: unexpected private fields never enter the UI's
// model, even if a future server response accidentally includes them.
export function publicProduct(row) {
  if (
    !row ||
    !validId(row.id) ||
    row.status !== 'published' ||
    !Array.isArray(row.images) ||
    String(row.public_rate) !== String(row.public_rate).trim() ||
    !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(row.public_rate)) ||
    Number(row.public_rate) <= 0 ||
    ['title', 'description', 'category', 'condition', 'location'].some(
      (field) => typeof row[field] !== 'string',
    )
  )
    return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    location: row.location,
    public_rate: String(row.public_rate),
    status: 'published',
    created_at: row.created_at,
    images: row.images
      .filter((image) => validId(image?.id))
      .map((image) => ({
        id: image.id,
        url: api.url(`/product-images/${image.id}`),
      })),
  };
}

export function publicPage(data, page) {
  if (
    !Array.isArray(data.products) ||
    data.pagination?.page !== page ||
    typeof data.pagination.has_more !== 'boolean'
  )
    throw new Error(
      'The backend returned unexpected marketplace results. Please retry.',
    );
  const products = data.products.map(publicProduct);
  if (products.some((product) => !product))
    throw new Error(
      'The backend returned an unavailable marketplace product. Please retry.',
    );
  return { products, hasMore: data.pagination.has_more };
}

export function browseState(search = '') {
  const params = new URLSearchParams(search);
  const page = params.get('page') || '1';
  if (
    page !== page.trim() ||
    !/^[1-9]\d{0,6}$/.test(page) ||
    Number(page) > 1000000
  )
    throw new Error(
      'Invalid marketplace page. Clear search and filters to continue.',
    );
  const state = {
    q: (params.get('q') || '').trim(),
    category: (params.get('category') || '').trim(),
    page: Number(page),
  };
  for (const value of [state.q, state.category])
    if (Array.from(value).length > 100 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error(
        'Search and category must contain at most 100 valid characters.',
      );
  return state;
}

export function productsQuery(state, limit = 12) {
  const checked = browseState(
    new URLSearchParams({
      q: state.q || '',
      category: state.category || '',
      page: String(state.page || 1),
    }).toString(),
  );
  const params = new URLSearchParams({
    page: String(checked.page),
    limit: String(limit),
  });
  if (checked.q) params.set('q', checked.q);
  if (checked.category) params.set('category', checked.category);
  return '/products?' + params.toString();
}

export const formatRate = (value) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    Number(value),
  );
export const placeholder = (title, detail = false) =>
  `<div class="image-placeholder${detail ? ' detail-placeholder' : ''}" role="img" aria-label="No photo available for ${escapeText(title)}"><span class="placeholder-mark" aria-hidden="true">↗</span><span>Photo unavailable</span></div>`;

export function productCard(product, related = false) {
  if (product.status !== 'published' || !validId(product.id))
    throw new Error('Only published products can be displayed.');
  const href = `product.html?id=${product.id}`;
  const image = product.images[0];
  return `<article class="product-card" data-product-id="${product.id}"><a class="product-image" href="${href}">${image ? `<img src="${escapeText(image.url)}" crossorigin="use-credentials" alt="${escapeText(product.title)}" loading="lazy">` : placeholder(product.title)}<span class="condition-tag">${escapeText(product.condition)}</span><span class="availability-tag availability-available">Available</span></a><div class="product-info"><div class="product-meta"><span>${escapeText(product.category)}</span><span>${escapeText(product.location)}</span></div><h3>${escapeText(product.title)}</h3><div class="product-bottom"><strong><small class="rate-label">Rate</small>${escapeText(formatRate(product.public_rate))}</strong><a href="${href}" class="${related ? 'view-link' : 'button view-details'}">${related ? 'View item' : 'View details'} <span>↗</span></a></div></div></article>`;
}

export function imageFallbacks(root, detail = false) {
  root.querySelectorAll('img').forEach((image) =>
    image.addEventListener(
      'error',
      () => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = placeholder(image.alt, detail);
        image.replaceWith(wrapper.firstElementChild);
      },
      { once: true },
    ),
  );
}

// Page navigation only. auth-ui.js continues to own all account/session behavior.
export function setupPublicNavigation() {
  const nav = document.querySelector('.nav-links');
  if (!nav || nav.dataset.publicNavigationReady) return;
  nav.dataset.publicNavigationReady = 'true';
  const toggle = document.querySelector('.menu-toggle');
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute(
      'aria-label',
      open ? 'Close navigation' : 'Open navigation',
    );
    nav.classList.toggle('is-open', open);
  });
  if (toggle) nav.dataset.navigationReady = 'true';
  nav.querySelectorAll('a').forEach((link) =>
    link.addEventListener('click', () => {
      toggle?.setAttribute('aria-expanded', 'false');
      nav.classList.remove('is-open');
    }),
  );
}
