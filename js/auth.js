import { api } from './api-client.js';
import { createAccountManager, accountDestination } from './account-state.js';
export {
  profileName,
  accountDestination,
  dashboardAllowed,
} from './account-state.js';

export const account = createAccountManager(api);
export const getCurrentAccount = (options) => account.restore(options);
export const getCurrentUser = async () => (await account.restore()).user;
export const getCurrentProfile = async () => (await account.restore()).profile;
export const subscribeAccount = (listener) => account.subscribe(listener);
export const login = (values) => account.login(values);
export const register = (values) => account.register(values);
export const logout = () => account.logout();

// Compatibility for preserved, inactive legacy modules. No SDK auth listener.
export const subscribeAuthChange = (callback) =>
  account.subscribe((state) =>
    callback(
      state.status === 'guest' ? 'SIGNED_OUT' : 'ACCOUNT_UPDATED',
      state,
    ),
  );
export async function requireRole(role) {
  const state = await account.restore();
  if (!state.user) {
    window.location.replace('login.html');
    return null;
  }
  if (state.profile.role !== role) {
    window.location.replace(accountDestination(state.profile));
    return null;
  }
  return state;
}
