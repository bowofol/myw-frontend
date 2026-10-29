import { supabase, supabaseConfig } from '../supabase/client.js';
import { backendError } from './backend-errors.js';

export const PUBLIC_PRODUCT_COLUMNS =
  'id,title,description,category,condition,location,public_rate,status,created_at,updated_at';
export const IMAGE_COLUMNS = 'id,product_id,storage_path,sort_order';
export const SIGNED_IMAGE_SECONDS = 60;
export const PRODUCT_CATEGORIES = [
  'Electronics',
  'Furniture',
  'Home & Kitchen',
  'Clothing',
  'Books',
  'Other Items',
];
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

export function formatRate(amount) {
  const number = Number(amount);
  return amount !== null &&
    amount !== '' &&
    Number.isFinite(number) &&
    number > 0
    ? `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(number)}`
    : 'Rate not set';
}

function configured(client, category) {
  if (!client)
    throw backendError(
      category,
      'Supabase is not configured. Check supabase/config.js.',
    );
  return client;
}

// Never spread a database row into the public model. Even unexpected extra fields
// from a mock, changed view, or future query cannot reach the public renderer.
export function publicProduct(row) {
  if (
    !row ||
    row.status !== 'published' ||
    !UUID_PATTERN.test(String(row.id)) ||
    !Number.isFinite(Number(row.public_rate)) ||
    Number(row.public_rate) <= 0
  )
    return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    location: row.location,
    public_rate: Number(row.public_rate),
    status: 'published',
    created_at: row.created_at,
    updated_at: row.updated_at,
    images: [],
  };
}

export async function getProductImages(productIds, client = supabase) {
  const ids = [...new Set(productIds)].filter((id) =>
    UUID_PATTERN.test(String(id)),
  );
  const groups = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return groups;
  configured(client, 'IMAGE_UPLOAD');
  const result = await client
    .from('product_images')
    .select(IMAGE_COLUMNS)
    .in('product_id', ids)
    .order('sort_order', { ascending: true });
  if (result.error)
    throw backendError(
      'IMAGE_UPLOAD',
      'Failed to load product image records.',
      result.error,
    );
  const rows = result.data || [];
  if (!rows.length) return groups;
  const paths = rows.map((row) => row.storage_path);
  const signed = await client.storage
    .from(supabaseConfig.storageBucket)
    .createSignedUrls(paths, SIGNED_IMAGE_SECONDS);
  if (signed.error)
    throw backendError(
      'IMAGE_UPLOAD',
      'Failed to load product photos.',
      signed.error,
    );
  const urls = new Map();
  for (const item of signed.data || []) {
    if (item.error || !item.signedUrl)
      throw backendError(
        'IMAGE_UPLOAD',
        'A product photo could not be loaded.',
        typeof item.error === 'string' ? { message: item.error } : item.error,
      );
    urls.set(item.path, item.signedUrl);
  }
  for (const row of rows) {
    if (!groups.has(row.product_id)) continue;
    const url = urls.get(row.storage_path);
    if (!url)
      throw backendError(
        'IMAGE_UPLOAD',
        'A product photo URL is missing. Retry loading the page.',
      );
    groups.get(row.product_id).push({
      id: row.id,
      product_id: row.product_id,
      storage_path: row.storage_path,
      sort_order: row.sort_order,
      url,
    });
  }
  return groups;
}

async function withPublicImages(rows, client) {
  const products = rows.map(publicProduct).filter(Boolean);
  try {
    const images = await getProductImages(
      products.map((product) => product.id),
      client,
    );
    products.forEach((product) => {
      product.images = images.get(product.id) || [];
    });
    return products;
  } catch (error) {
    throw backendError(
      'MARKETPLACE',
      'Failed to load published product photos.',
      error,
    );
  }
}

export async function getPublicProducts(
  { limit, excludeId } = {},
  client = supabase,
) {
  configured(client, 'MARKETPLACE');
  try {
    let query = client
      .from('public_products')
      .select(PUBLIC_PRODUCT_COLUMNS)
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if (excludeId) query = query.neq('id', excludeId);
    if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return await withPublicImages(data || [], client);
  } catch (error) {
    if (error.category === 'MARKETPLACE') throw error;
    throw backendError(
      'MARKETPLACE',
      'Failed to load published products. Confirm the V2 schema is applied.',
      error,
    );
  }
}

export async function getPublicProduct(id, client = supabase) {
  if (!UUID_PATTERN.test(String(id))) return null;
  configured(client, 'MARKETPLACE');
  try {
    const { data, error } = await client
      .from('public_products')
      .select(PUBLIC_PRODUCT_COLUMNS)
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw error;
    const products = await withPublicImages(data ? [data] : [], client);
    return products[0] || null;
  } catch (error) {
    if (error.category === 'MARKETPLACE') throw error;
    throw backendError(
      'MARKETPLACE',
      'Failed to load this product. Confirm the V2 schema is applied.',
      error,
    );
  }
}

export function validateEnquiry(values) {
  const cleaned = {
    name: String(values.name || '').trim(),
    phone: String(values.phone || '').trim(),
    message: String(values.message || '').trim(),
  };
  if (cleaned.name.length < 2 || cleaned.name.length > 120)
    throw backendError('ENQUIRY', 'Enter a name between 2 and 120 characters.');
  if (cleaned.phone.length < 7 || cleaned.phone.length > 40)
    throw backendError(
      'ENQUIRY',
      'Enter a phone number between 7 and 40 characters.',
    );
  if (!cleaned.message || cleaned.message.length > 2000)
    throw backendError('ENQUIRY', 'Enter a message of up to 2,000 characters.');
  return cleaned;
}

export async function submitEnquiry(
  productId,
  values,
  account = null,
  client = supabase,
) {
  configured(client, 'ENQUIRY');
  if (!UUID_PATTERN.test(String(productId)))
    throw backendError('ENQUIRY', 'This product link is invalid.');
  const buyerId =
    account?.profile?.role === 'buyer' &&
    account.profile.status === 'active' &&
    account.user?.id === account.profile.id
      ? account.user.id
      : null;
  const payload = {
    product_id: productId,
    buyer_id: buyerId,
    ...validateEnquiry(values),
  };
  try {
    // INSERT only: visitors cannot SELECT/RETURNING private enquiries.
    const { error } = await client.from('enquiries').insert(payload);
    if (error) throw error;
    return payload;
  } catch (error) {
    throw backendError(
      'ENQUIRY',
      'Failed to save your enquiry. Please retry.',
      error,
    );
  }
}

export function whatsappUrl(product, values = {}) {
  const message =
    `Hello Newpage Material Managers, I am interested in ${product.title} (${product.id}).\n${values.name || ''}\n${values.phone || ''}\n${values.message || ''}`.trim();
  return `https://wa.me/${supabaseConfig.adminWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}

export function productCard(product, { button = false } = {}) {
  const text = escapeHtml;
  const image = product.images?.[0]?.url;
  const href = `product.html?id=${encodeURIComponent(product.id)}`;
  const photo = image
    ? `<img src="${text(image)}" alt="${text(product.title)}" loading="lazy">`
    : '<div class="image-placeholder" role="img" aria-label="Product photo unavailable"><span class="placeholder-mark" aria-hidden="true">↗</span><span>Photo unavailable</span></div>';
  return `<article class="product-card"><a class="product-image" href="${href}">${photo}<span class="condition-tag">${text(product.condition)}</span><span class="availability-tag availability-available">Available</span></a><div class="product-info"><div class="product-meta"><span>${text(product.category)}</span><span>${text(product.location)}</span></div><h3>${text(product.title)}</h3><div class="product-bottom"><strong><small class="rate-label">Rate</small>${formatRate(product.public_rate)}</strong><a href="${href}" class="${button ? 'button view-details' : 'view-link'}">View ${button ? 'details' : 'item'} <span>↗</span></a></div></div></article>`;
}

export function bindImageFallbacks(container) {
  container.querySelectorAll('img').forEach((image) =>
    image.addEventListener(
      'error',
      () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute(
          'aria-label',
          `Photo unavailable for ${image.alt || 'this product'}`,
        );
        placeholder.textContent =
          'Photo unavailable. Reload to refresh the image.';
        image.replaceWith(placeholder);
      },
      { once: true },
    ),
  );
}
