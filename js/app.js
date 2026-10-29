// Homepage navigation, marketplace search and an explicit WhatsApp draft handoff.
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
function closeMenu() {
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open navigation');
  navLinks?.classList.remove('is-open');
}
menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute(
    'aria-label',
    open ? 'Close navigation' : 'Open navigation',
  );
  navLinks?.classList.toggle('is-open', open);
});
if (menuToggle && navLinks) navLinks.dataset.navigationReady = 'true';
navLinks?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    menuToggle?.getAttribute('aria-expanded') === 'true' &&
    !navLinks?.querySelector('details[open]')
  ) {
    closeMenu();
    menuToggle.focus();
  }
});

document.querySelector('#search-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = document.querySelector('#search-input')?.value.trim() || '';
  window.location.href = `marketplace.html${query ? `?q=${encodeURIComponent(query)}` : ''}`;
});

document.querySelector('#contact-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const name = form.elements.name.value.trim(),
    phone = form.elements.phone.value.trim(),
    message = form.elements.message.value.trim();
  const feedback = document.querySelector('#form-feedback');
  feedback.replaceChildren();
  if (
    !name ||
    !message ||
    !/^\+?[0-9 ()-]{7,32}$/.test(phone) ||
    phone.replace(/\D/g, '').length < 7 ||
    phone.replace(/\D/g, '').length > 15
  ) {
    feedback.textContent =
      'Enter your name, a valid phone number and a message.';
    return;
  }
  // Reuse the owner-confirmed contact link. Nothing is sent by this form.
  const draft = new URL(document.querySelector('.contact-whatsapp').href);
  draft.searchParams.set(
    'text',
    `Hello Newpage Material Managers,\n\nName: ${name}\nPhone: ${phone}\n\n${message}`,
  );
  const link = document.createElement('a');
  link.href = draft.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'text-link';
  link.textContent = 'Open WhatsApp draft ↗';
  feedback.append(
    'Draft prepared. Open WhatsApp to review and send your message. ',
    link,
  );
});
