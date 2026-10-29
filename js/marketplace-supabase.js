import {
  isSupabaseConfigured,
  supabase,
  supabaseConfig,
} from './legacy-public-client.js';

async function imageUrls(paths) {
  return Promise.all(
    (paths || []).map(async (path) => {
      const { data, error } = await supabase.storage
        .from(supabaseConfig.storageBucket)
        .createSignedUrl(path, 3600);
      if (error) {
        console.warn('Could not load marketplace image:', error);
        return '';
      }
      return data.signedUrl;
    }),
  );
}

async function loadMarketplace() {
  if (!isSupabaseConfigured() || !supabase) return;
  try {
    const { data: listings, error: listingError } = await supabase
      .from('public_marketplace_listings')
      .select('*')
      .order('created_at', { ascending: false });
    if (listingError) throw listingError;

    const ids = (listings || []).map((listing) => listing.id);
    let imageRows = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from('listing_images')
        .select('listing_id, storage_path, sort_order')
        .in('listing_id', ids)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      imageRows = data || [];
    }
    const imageMap = new Map();
    imageRows.forEach((image) =>
      imageMap.set(image.listing_id, [
        ...(imageMap.get(image.listing_id) || []),
        image.storage_path,
      ]),
    );
    const products = await Promise.all(
      (listings || []).map(async (listing) => ({
        id: listing.id,
        title: listing.title,
        description: listing.description,
        category: listing.category,
        condition: listing.condition,
        location: listing.location,
        rate: Number(listing.admin_rate),
        availability:
          listing.status === 'published' ? 'available' : listing.status,
        visibility: 'public',
        createdAt: listing.created_at,
        images: (await imageUrls(imageMap.get(listing.id))).filter(Boolean),
        source: 'supabase',
      })),
    );
    window.newpageSetMarketplaceProducts?.(products);
    const notice = document.querySelector('[data-marketplace-notice]');
    if (notice)
      notice.innerHTML =
        '<span class="demo-dot"></span><strong>CURATED MARKETPLACE</strong><span class="demo-divider">·</span> Reviewed listings from Newpage Material Managers.';
  } catch (error) {
    console.warn(
      'Could not load Supabase marketplace products; showing local demonstration data.',
      error,
    );
  }
}

if (window.newpageSetMarketplaceProducts) loadMarketplace();
else
  window.addEventListener('newpage:marketplace-ready', loadMarketplace, {
    once: true,
  });
