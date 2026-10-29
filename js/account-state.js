export function profileName(profile, user) {
  return (
    [profile?.first_name, profile?.last_name]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ') ||
    profile?.email ||
    user?.email ||
    'User'
  );
}

export function accountDestination(profile) {
  if (profile?.status !== 'active') return 'marketplace.html';
  if (profile.role === 'admin') return 'admin-dashboard.html';
  if (profile.role === 'seller') return 'seller-dashboard.html';
  return 'marketplace.html';
}

export function dashboardAllowed(role, user, profile) {
  return Boolean(user && profile?.status === 'active' && profile.role === role);
}

function verifiedProfile(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    value.status !== 'active' ||
    !['admin', 'seller', 'buyer'].includes(value.role)
  ) {
    throw new Error(
      'The backend did not confirm an active account. Please retry.',
    );
  }
  const fields = [
    'id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'role',
    'status',
    'created_at',
    'updated_at',
  ];
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

// One instance per page, shared by forms, navigation, and the dashboard guard.
// Only in-memory safe profile data is cached. The browser owns the HttpOnly cookie.
export function createAccountManager(client) {
  let state = { status: 'unknown', user: null, profile: null, error: null };
  let pending = null;
  let generation = 0;
  const listeners = new Set();
  const snapshot = () => ({ ...state });
  function update(next) {
    state = next;
    for (const listener of listeners) listener(snapshot());
  }

  async function restore({ force = false } = {}) {
    if (pending) return pending;
    if (!force && ['authenticated', 'guest'].includes(state.status))
      return snapshot();
    const version = generation;
    update({ ...state, status: 'checking', error: null });
    const work = (async () => {
      try {
        const data = await client.request('GET', '/auth/me');
        if (version !== generation) return snapshot();
        const profile = verifiedProfile(data.user);
        update({
          status: 'authenticated',
          user: profile,
          profile,
          error: null,
        });
      } catch (error) {
        if (version !== generation) return snapshot();
        if (
          error.code === 'HTTP' &&
          (error.status === 401 ||
            (error.status === 403 &&
              error.message === 'Account is unavailable.'))
        ) {
          client.clearCsrf();
          update({ status: 'guest', user: null, profile: null, error: null });
        } else {
          // An outage is unknown authorization, never an instruction to log out.
          update({ ...state, status: 'error', error });
          throw error;
        }
      }
      return snapshot();
    })();
    pending = work;
    try {
      return await work;
    } finally {
      if (pending === work) pending = null;
    }
  }

  return {
    snapshot,
    restore,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async login(values) {
      const data = await client.request('POST', '/auth/login', values);
      const profile = verifiedProfile(data.user);
      generation++;
      pending = null;
      update({ status: 'authenticated', user: profile, profile, error: null });
      return snapshot();
    },
    async register(values) {
      if (!['seller', 'buyer'].includes(values.account_type))
        throw new Error('Choose a seller or buyer account.');
      const data = await client.request('POST', '/auth/register', values);
      const profile = verifiedProfile(data.user);
      if (profile.role !== values.account_type)
        throw new Error(
          'Account creation could not be confirmed. Please retry or sign in.',
        );
      return profile;
    },
    async logout() {
      await client.request('POST', '/auth/logout', {});
      generation++;
      pending = null;
      update({ status: 'guest', user: null, profile: null, error: null });
    },
  };
}
