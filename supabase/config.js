// Project Settings > API. These values are safe for browser use only with the
// RLS policies in supabase-v2/schema.sql applied. Never place service_role here.
import { businessContact } from '../js/contact-config.js';

export const supabaseConfig = {
  url: 'https://kkapmavskmmpaoucmyin.supabase.co',
  publishableKey: 'sb_publishable_iYyywzDekAwsqB8PN1Vj3Q_J56ajril',
  storageBucket: 'product-images',
  adminWhatsAppNumber: businessContact.whatsAppNumber,
};

export function isSupabaseConfigured() {
  try {
    const url = new URL(supabaseConfig.url);
    return (
      url.protocol === 'https:' &&
      /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      typeof supabaseConfig.publishableKey === 'string' &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseConfig.publishableKey)
    );
  } catch {
    return false;
  }
}
