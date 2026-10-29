import { api } from './api-client.js';
import { account, subscribeAccount } from './auth.js';
import {
  productsQuery,
  publicPage,
  productCard,
  imageFallbacks,
} from './public-products.js';

const grid = document.querySelector('#product-grid');
const state = document.querySelector('#home-products-state');
const retry = document.querySelector('#home-products-retry');
let loading = false;

// Presentation subscribes to the existing account manager; no account request,
// permission, session, redirect or authentication behavior is changed here.
function sellerLinks(snapshot) {
  const seller =
    snapshot.status === 'authenticated' &&
    snapshot.profile?.role === 'seller' &&
    snapshot.profile.status === 'active';
  document.querySelectorAll('[data-home-seller]').forEach((link) => {
    link.hidden = !seller;
  });
}
subscribeAccount(sellerLinks);
sellerLinks(account.snapshot());

// Editorial photographs never enter inventory or its product-image fallbacks.
// Keep an explicit failure message if the approved external image host is offline.
document.querySelectorAll('[data-home-editorial-image]').forEach((image) => {
  const unavailable = () => {
    image.hidden = true;
    const frame = image.closest('[data-editorial-frame]');
    frame?.classList.add('is-image-unavailable');
    const message = frame?.querySelector('[data-image-error]');
    if (message) message.hidden = false;
  };
  image.addEventListener('error', unavailable, { once: true });
  if (image.complete && image.naturalWidth === 0) unavailable();
});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionSeen = new WeakSet();
const motionPending = new Map();
const motionObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const element = entry.target;
            motionObserver.unobserve(element);
            const className = motionPending.get(element);
            motionPending.delete(element);
            motionSeen.add(element);
            if (!reducedMotion.matches && className)
              element.classList.add(className);
          }
        },
        { threshold: 0.06, rootMargin: '0px 0px -16px 0px' },
      )
    : null;

// Resting content is always visible. Classes start finite entrance animations;
// there is no hidden/pending state that depends on an observer firing later.
function observeMotion(element, className = 'edit-reveal-enter') {
  if (!element || motionSeen.has(element) || !motionObserver) return;
  motionPending.set(element, className);
  if (!reducedMotion.matches) motionObserver.observe(element);
}

const revealTargets = document.querySelectorAll(
  '.edit-section-heading > div, .edit-category-copy, ' +
    '.edit-process-heading > div, .home-steps li, .edit-story-heading, ' +
    '.edit-story-copy, [data-editorial-frame]:not(.edit-hero-scene), ' +
    '.edit-closing-top, .home-closing h2, .edit-closing-bottom, ' +
    '.home-contact .contact-copy, .home-contact .contact-form, ' +
    '.edit-footer [data-footer-reveal]',
);
revealTargets.forEach((element) => observeMotion(element));
document.querySelectorAll('.home-actions').forEach((element) => {
  observeMotion(element, 'edit-cta-enter');
});
document.querySelectorAll('.home-steps li').forEach((element, index) => {
  element.style.setProperty('--edit-reveal-delay', `${(index % 2) * 80}ms`);
});

function revealCards() {
  // A retry replaces the cards. Drop detached targets rather than retaining
  // their DOM nodes while observing the new public inventory.
  for (const element of motionPending.keys()) {
    if (!element.isConnected) {
      motionObserver?.unobserve(element);
      motionPending.delete(element);
    }
  }
  grid.querySelectorAll('.product-card').forEach((card, index) => {
    card.style.setProperty('--card-order', String(Math.min(index, 3)));
    observeMotion(card, 'home-card-enter');
  });
}

// Start the image entrance on a successful load, including a warm-cache load.
// The picture stays visible if this module, the image or animation support fails.
const heroImage = document.querySelector('#edit-hero-image');
const heroScene = document.querySelector('.edit-hero-scene');
function revealHeroImage() {
  if (!heroImage?.naturalWidth || !heroScene || heroScene.dataset.entranceComplete) return;
  heroScene.dataset.entranceComplete = 'true';
  if (!reducedMotion.matches) heroScene.classList.add('edit-hero-ready');
}
heroImage?.addEventListener('load', revealHeroImage, { once: true });
if (heroImage?.complete) revealHeroImage();

// app.js/auth-ui.js remain the menu owners. Observe their existing expanded
// state only so closing links leave the keyboard order immediately, while the
// visual menu finishes fading. No account/session state is read here.
const motionMenu = document.querySelector('#nav-links');
const motionToggle = document.querySelector('.menu-toggle');
const mobileMenu = window.matchMedia('(max-width: 63.999rem)');
function syncMenuAccess() {
  if (!motionMenu || !motionToggle) return;
  motionMenu.inert =
    mobileMenu.matches &&
    motionMenu.dataset.navigationReady === 'true' &&
    motionToggle.getAttribute('aria-expanded') !== 'true';
}
const menuObserver = new MutationObserver(syncMenuAccess);
function observeMenuAccess() {
  if (!motionMenu || !motionToggle) return;
  menuObserver.observe(motionToggle, {
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  menuObserver.observe(motionMenu, {
    attributes: true,
    attributeFilter: ['data-navigation-ready'],
  });
  syncMenuAccess();
}
observeMenuAccess();
mobileMenu.addEventListener('change', syncMenuAccess);

reducedMotion.addEventListener('change', () => {
  motionObserver?.disconnect();
  if (reducedMotion.matches) {
    document
      .querySelectorAll(
        '.edit-reveal-enter, .home-card-enter, .edit-cta-enter, .edit-hero-ready',
      )
      .forEach((element) => {
        element.classList.remove(
          'edit-reveal-enter', 'home-card-enter', 'edit-cta-enter', 'edit-hero-ready',
        );
      });
  } else {
    motionPending.forEach((_, element) => motionObserver?.observe(element));
  }
});
window.addEventListener('pagehide', () => {
  motionObserver?.disconnect();
  menuObserver.disconnect();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  observeMenuAccess();
  if (!reducedMotion.matches)
    motionPending.forEach((_, element) => motionObserver?.observe(element));
});

async function loadFeatured() {
  if (loading) return;
  loading = true;
  retry.hidden = true;
  grid.setAttribute('aria-busy', 'true');
  state.textContent = 'Loading published items...';
  state.hidden = false;
  try {
    const result = publicPage(
      await api.request('GET', productsQuery({ page: 1 }, 4)),
      1,
    );
    grid.innerHTML = result.products
      .map((product) => productCard(product, true))
      .join('');
    imageFallbacks(grid);
    revealCards();
    state.hidden = result.products.length > 0;
    state.textContent =
      'No published items are available yet. Browse the marketplace again soon.';
  } catch {
    grid.replaceChildren();
    state.textContent =
      'Items could not be loaded. Please retry or open the marketplace.';
    state.hidden = false;
    retry.hidden = false;
  } finally {
    loading = false;
    grid.setAttribute('aria-busy', 'false');
  }
}
retry.addEventListener('click', loadFeatured);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) loadFeatured();
});
loadFeatured();
