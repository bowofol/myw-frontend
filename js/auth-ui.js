// Shared navigation renderer and the sole active dashboard guard.
(() => {
  const nav = document.querySelector('.nav-links');
  if (!nav || nav.dataset.authUiStarted) return;
  nav.dataset.authUiStarted = 'true';
  const guests = [...document.querySelectorAll('[data-auth-guest]')];
  const main = document.querySelector('[data-auth-protected]');
  const control = document.createElement('span');
  control.className = 'account-controls';
  control.setAttribute('role', 'status');
  control.setAttribute('aria-live', 'polite');
  control.textContent = 'Checking account...';
  nav.append(control);
  let auth;
  let redirected = false;
  let explicitLogout = false;

  // Data modules own their controls; this remains the sole dashboard guard.

  if (
    main ||
    ['login', 'register'].includes(document.body.dataset.sellerPage)
  ) {
    document
      .querySelector('.menu-toggle')
      ?.addEventListener('click', (event) => {
        const button = event.currentTarget;
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        button.setAttribute(
          'aria-label',
          open ? 'Open navigation' : 'Close navigation',
        );
        nav.classList.toggle('is-open', !open);
      });
    if (document.querySelector('.menu-toggle'))
      nav.dataset.navigationReady = 'true';
  }

  function redirect(destination) {
    if (redirected) return;
    redirected = true;
    if (main) main.hidden = true;
    window.location.replace(destination);
  }
  function showFailure(error) {
    const message = document.createElement('span');
    message.textContent =
      error?.message || 'Unable to check your account. Please retry.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'account-logout';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => (auth ? refresh() : initialize()));
    control.append(message, retry);
  }
  function fillProfile(profile) {
    const name = auth.profileName(profile);
    for (const [selector, value] of Object.entries({
      '[data-seller-name]': name,
      '[data-profile-name]': name,
      '[data-profile-email]': profile.email || 'Not provided',
      '[data-profile-phone]': profile.phone || 'Not provided',
      '[data-admin-name]': profile.email || name,
    })) {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    }
    const identity = document.querySelector('[data-admin-identity]');
    if (identity) identity.hidden = false;
    const notice = document.querySelector(
      '[data-admin-notice], [data-backend-notice]',
    );
    if (main && notice) {
      notice.textContent = 'Account access confirmed.';
      notice.className = 'backend-notice is-success';
    }
  }
  function render(state) {
    control.replaceChildren();
    guests.forEach((link) => {
      link.hidden = state.status !== 'guest';
    });
    if (main) main.hidden = true;
    if (state.status === 'unknown' || state.status === 'checking') {
      control.textContent = 'Checking account...';
      return;
    }
    if (state.status === 'guest') {
      if (main && !explicitLogout) redirect('login.html');
      return;
    }
    const profile = state.profile;
    if (profile) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Account';
      const panel = document.createElement('div');
      panel.className = 'account-panel';
      const name = document.createElement('strong');
      name.textContent = auth.profileName(profile, state.user);
      panel.append(name);
      for (const field of ['email', 'phone', 'role', 'status']) {
        const value = document.createElement('span');
        value.textContent = field + ': ' + (profile[field] || 'Not provided');
        panel.append(value);
      }
      const destination = document.createElement('a');
      destination.href = auth.accountDestination(profile);
      destination.textContent =
        profile.role === 'admin'
          ? 'Admin Dashboard'
          : profile.role === 'seller'
            ? 'Seller Dashboard'
            : 'Marketplace';
      panel.append(destination);
      details.append(summary, panel);
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'account-logout';
      logout.textContent = 'Logout';
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        explicitLogout = true;
        try {
          await auth.logout();
          redirect('index.html');
        } catch (error) {
          explicitLogout = false;
          logout.disabled = false;
          showFailure(error);
        }
      });
      control.append(details, logout);
    }
    if (state.status === 'error') {
      showFailure(state.error);
      return;
    }
    if (main) {
      if (
        !auth.dashboardAllowed(main.dataset.authProtected, state.user, profile)
      ) {
        redirect(auth.accountDestination(profile));
        return;
      }
      fillProfile(profile);
      main.hidden = false;
    }
  }
  async function refresh() {
    if (!auth || redirected) return;
    try {
      await auth.getCurrentAccount({ force: true });
    } catch {
      /* Rendered by the shared manager; never log out on failure. */
    }
  }
  async function initialize() {
    try {
      auth = await import('./auth.js');
      auth.subscribeAccount(render);
      render(auth.account.snapshot());
      await auth.getCurrentAccount();
    } catch (error) {
      if (!auth) {
        control.replaceChildren();
        showFailure(error);
      }
    }
  }
  window.addEventListener('pagehide', (event) => {
    if (event.persisted && main) main.hidden = true;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  initialize();
})();

// Optional shared presentation only. Existing page owners retain their toggle
// click handlers; this block never reads or changes authentication or API state.
(() => {
  const nav = document.querySelector('.nav-links');
  const toggle = document.querySelector('.menu-toggle');
  if (!nav || !toggle || nav.dataset.presentationReady) return;
  nav.dataset.presentationReady = 'true';
  const closeNavigation = (returnFocus = false) => {
    const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('is-open');
    if (wasOpen && returnFocus) toggle.focus();
  };
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeNavigation();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const account = nav.querySelector('details[open]');
    if (account) {
      account.open = false;
      account.querySelector('summary')?.focus();
      return;
    }
    if (toggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      closeNavigation(true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!nav.contains(event.target) && !toggle.contains(event.target))
      closeNavigation();
  });
  const desktop = window.matchMedia('(min-width: 64rem)');
  desktop.addEventListener('change', () => {
    const focusInside = nav.contains(document.activeElement);
    const toggleFocused = document.activeElement === toggle;
    closeNavigation();
    if (!desktop.matches && focusInside) toggle.focus();
    if (desktop.matches && toggleFocused)
      nav.querySelector('a:not([hidden])')?.focus();
  });

  // Future pages may opt in with data-reveal. Resting content is always visible,
  // including when this module or the observer is unavailable.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (!reducedMotion.matches) entry.target.classList.add('motion-enter');
      }
    },
    { threshold: 0.1 },
  );
  document.querySelectorAll('[data-reveal]').forEach((element) => {
    observer.observe(element);
  });
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    observer.disconnect();
    document.querySelectorAll('.motion-enter').forEach((element) => {
      element.classList.remove('motion-enter');
    });
  });
  window.addEventListener('pagehide', () => observer.disconnect());
})();
