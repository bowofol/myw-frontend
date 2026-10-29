// Reuse the existing public business contact configuration only; no SDK client.
import { businessContact } from './contact-config.js';

export function productWhatsAppUrl(product, number = businessContact.whatsAppNumber) {
  // Missing or malformed configuration must never create a fallback recipient.
  if (typeof number !== 'string' || !/^[1-9][0-9]{6,14}$/.test(number)) return null;
  if (!Number.isSafeInteger(product?.id) || product.id < 1 ||
      product.id > 4294967295 || product.status !== 'published' ||
      typeof product.title !== 'string' || !product.title.trim()) return null;
  const reference = 'NMM-' + String(product.id).padStart(4, '0');
  const message = `Hello Newpage Material Managers, I am interested in ${product.title} (${reference}, product ID ${product.id}). Is it still available?`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
