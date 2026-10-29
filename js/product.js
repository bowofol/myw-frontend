import { api } from './api-client.js';
import { mountProductEnquiry } from './enquiries.js';
import { productWhatsAppUrl } from './business-contact.js';
import {
  productId,
  publicProduct,
  publicPage,
  productsQuery,
  productCard,
  escapeText as text,
  formatRate,
  placeholder,
  imageFallbacks,
  setupPublicNavigation,
} from './public-products.js';

setupPublicNavigation();
const content = document.querySelector('#product-content');
const missing = document.querySelector('#product-not-found');
const related = document.querySelector('#related-products');
const state = document.querySelector('#product-state');
const retry = document.querySelector('#product-retry');
let generation = 0;
let enquiryCleanup = () => {};

function showMissing() {
  content.hidden = true;
  content.replaceChildren();
  related.hidden = true;
  related.replaceChildren();
  state.hidden = true;
  retry.hidden = true;
  missing.hidden = false;
  document.title = 'Item not found — Newpage Material Managers';
}
function render(product) {
  const images = product.images;
  const main = images.length
    ? `<img id="main-product-image" crossorigin="use-credentials" src="${text(images[0].url)}" alt="${text(product.title)}" decoding="async">`
    : placeholder(product.title, true);
  const thumbs =
    images.length > 1
      ? `<div class="detail-thumbnails" role="group" aria-label="More item images">${images.map((image, index) => `<button type="button" class="thumbnail${index === 0 ? ' is-active' : ''}" data-image-index="${index}" aria-label="Show item photo ${index + 1}" aria-pressed="${index === 0}"><img crossorigin="use-credentials" src="${text(image.url)}" alt="" loading="lazy"></button>`).join('')}</div>`
      : '';
  const reference = 'NMM-' + String(product.id).padStart(4, '0');
  const whatsapp = productWhatsAppUrl(product);
  content.innerHTML = `
    <div class="detail-gallery${images.length > 1 ? ' has-thumbnails' : ''}">
      <div class="detail-main-image">${main}</div>
      ${thumbs}
      <div class="detail-gallery-caption"><p id="detail-photo-state" role="status">${images.length ? `Photo 1 of ${images.length}` : 'No product photo available'}</p><span>ITEM PHOTOGRAPHY</span><p class="listing-reference">REF. <strong>${text(reference)}</strong></p></div>
    </div>
    <div class="detail-copy">
      <div class="detail-title"><p class="eyebrow">${text(product.category)}${product.location.trim() ? ` <span aria-hidden="true">/</span> ${text(product.location)}` : ''}</p><h1>${text(product.title)}</h1></div>
      <section class="detail-enquiry" aria-label="Enquire with Newpage about this item">
        <p class="detail-rate"><small>Public rate</small>${text(formatRate(product.public_rate))}</p>
        <span class="detail-availability availability-available">Available</span>
        <button class="button enquiry-toggle" id="show-enquiry" type="button" disabled>Enquire about this item <span aria-hidden="true">↗</span></button>
        ${whatsapp ? `<a class="button product-whatsapp" data-product-whatsapp href="${text(whatsapp)}" target="_blank" rel="noopener noreferrer">Chat on WhatsApp <span aria-hidden="true">↗</span></a>` : ''}
        <p class="form-note" data-enquiry-notice role="status">Checking enquiry access...</p>
        <form class="enquiry-form" id="enquiry-form" hidden novalidate>
          <p class="form-note">Send your question privately to the Newpage team about this product. Read our <a href="privacy-policy.html">draft Privacy Policy</a>.</p>
          <div class="field"><label for="buyer-name">Full name</label><input id="buyer-name" name="name" autocomplete="name" maxlength="200" required disabled></div>
          <div class="field"><label for="buyer-phone">Phone number</label><input id="buyer-phone" name="phone" type="tel" autocomplete="tel" maxlength="32" required disabled></div>
          <div class="field"><label for="buyer-message">Message</label><textarea id="buyer-message" name="message" rows="4" maxlength="2000" required placeholder="Ask about this item..." disabled></textarea></div>
          <button class="button" type="submit" disabled>Send enquiry <span aria-hidden="true">↗</span></button><p class="enquiry-feedback" id="enquiry-feedback" aria-live="polite"></p>
        </form>
      </section>
      <dl class="detail-facts"><div><dt>Condition</dt><dd>${text(product.condition)}</dd></div><div><dt>Category</dt><dd>${text(product.category)}</dd></div>${product.location.trim() ? `<div><dt>Location</dt><dd>${text(product.location)}</dd></div>` : ''}</dl>
      <section class="detail-description" aria-labelledby="detail-description-title"><h2 id="detail-description-title">About this item</h2><p>${text(product.description)}</p></section>
      <div class="detail-contact"><a class="detail-contact-link" href="index.html#contact">Other ways to contact Newpage <span aria-hidden="true">↗</span></a><p class="detail-delivery-note">You buy directly from Newpage. Collection or delivery is arranged with our team; any delivery charge is confirmed before purchase.</p></div>
    </div>`;
  content.hidden = false;
  missing.hidden = true;
  state.hidden = true;
  retry.hidden = true;
  document.title = product.title + ' — Newpage Material Managers';
  imageFallbacks(content.querySelector('.detail-gallery'), true);
  function photoState(index) {
    const caption = content.querySelector('#detail-photo-state');
    const image = content.querySelector('#main-product-image');
    if (!image) return;
    caption.textContent = `Photo ${index + 1} of ${images.length}`;
    image.addEventListener('error', () => {
      caption.textContent = `Photo ${index + 1} of ${images.length} unavailable`;
    }, { once: true });
  }
  photoState(0);
  content.querySelectorAll('.thumbnail').forEach((button) =>
    button.addEventListener('click', () => {
      const image = images[Number(button.dataset.imageIndex)];
      if (!image) return;
      const frame = content.querySelector('.detail-main-image');
      frame.innerHTML = `<img id="main-product-image" crossorigin="use-credentials" src="${text(image.url)}" alt="${text(product.title)}">`;
      imageFallbacks(frame, true);
      photoState(Number(button.dataset.imageIndex));
      content.querySelectorAll('.thumbnail').forEach((thumb) => {
        const active = thumb === button;
        thumb.classList.toggle('is-active', active);
        thumb.setAttribute('aria-pressed', String(active));
      });
    }),
  );
  enquiryCleanup = mountProductEnquiry(
    content.querySelector('#enquiry-form'),
    content.querySelector('#show-enquiry'),
    product,
  );
}
async function loadRelated(product, version) {
  try {
    const data = publicPage(
      await api.request(
        'GET',
        productsQuery({ category: product.category, page: 1 }, 4),
      ),
      1,
    );
    if (version !== generation) return;
    const options = data.products
      .filter((item) => item.id !== product.id)
      .slice(0, 3);
    related.innerHTML = options.length
      ? `<div class="related-heading"><div><p class="eyebrow">THE AVAILABLE EDIT</p><h2>More to discover.</h2></div><a class="detail-contact-link" href="marketplace.html">Explore marketplace <span aria-hidden="true">↗</span></a></div><div class="product-grid related-grid">${options.map((item) => productCard(item, true)).join('')}</div>`
      : '';
    related.hidden = !options.length;
    imageFallbacks(related);
  } catch {
    if (version !== generation) return;
    related.hidden = false;
    related.replaceChildren();
    const note = document.createElement('p');
    note.className = 'form-note';
    note.textContent = 'Other items could not be loaded. ';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-outline button-small';
    button.textContent = 'Retry related items';
    button.addEventListener('click', () => {
      button.disabled = true;
      loadRelated(product, version);
    });
    related.append(note, button);
  }
}
async function load() {
  const version = ++generation;
  enquiryCleanup();
  enquiryCleanup = () => {};
  const ids = new URLSearchParams(location.search).getAll('id');
  const id = ids.length === 1 ? productId(ids[0]) : null;
  if (!id) {
    showMissing();
    return;
  }
  content.hidden = true;
  content.replaceChildren();
  missing.hidden = true;
  related.hidden = true;
  related.replaceChildren();
  state.hidden = false;
  state.textContent = 'Loading product details...';
  retry.hidden = true;
  try {
    const data = await api.request('GET', `/products/${id}`);
    if (version !== generation) return;
    const product = publicProduct(data.product);
    if (!product || product.id !== id) {
      showMissing();
      return;
    }
    render(product);
    loadRelated(product, version);
  } catch (error) {
    if (version !== generation) return;
    if (error.status === 404) {
      showMissing();
      return;
    }
    state.hidden = false;
    state.textContent =
      error.message || 'Unable to load product details. Please retry.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', load);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) load();
});
load();
