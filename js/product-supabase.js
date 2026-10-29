import {
  isSupabaseConfigured,
  supabase,
  supabaseConfig,
} from './legacy-public-client.js';

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value || '',
  );

async function signedImageUrls(paths) {
  return Promise.all(
    (paths || []).map(async (path) => {
      const { data, error } = await supabase.storage
        .from(supabaseConfig.storageBucket)
        .createSignedUrl(path, 3600);
      if (error) {
        console.warn('Could not load product image:', error);
        return '';
      }
      return data.signedUrl;
    }),
  );
}

async function recordEnquiry({ productId, buyerName, buyerPhone, message }) {
  if (!isSupabaseConfigured() || !isUuid(productId)) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from('enquiries').insert({
      listing_id: productId,
      buyer_id: user?.id || null,
      contact_name: buyerName,
      contact_phone: buyerPhone,
      message,
      status: 'new',
    });
    if (error) throw error;
  } catch (error) {
    // The buyer can still review and send the intended WhatsApp message.
    console.warn('Could not record buyer enquiry:', error);
  }
}

window.addEventListener('newpage:buyer-enquiry', (event) => {
  const enquiry = event.detail;
  const message = `Hello Newpage Material Managers, I'm interested in ${enquiry.productTitle} (${enquiry.reference}). Is it still available?\n\nMy name: ${enquiry.buyerName}\nPhone: ${enquiry.buyerPhone}\nMessage: ${enquiry.message}`;
  window.open(
    `https://wa.me/${supabaseConfig.adminWhatsAppNumber}?text=${encodeURIComponent(message)}`,
    '_blank',
    'noopener,noreferrer',
  );
  recordEnquiry(enquiry);
});

async function loadProduct() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!isSupabaseConfigured() || !isUuid(id)) return;
  try {
    const { data: listing, error: listingError } = await supabase
      .from('public_marketplace_listings')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing) {
      window.newpageShowProductNotFound?.();
      return;
    }
    const { data: relatedListings, error: relatedError } = await supabase
      .from('public_marketplace_listings')
      .select('*')
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(3);
    if (relatedError) throw relatedError;
    const marketplaceListings = [listing, ...(relatedListings || [])];
    const { data: imageRows, error: imageError } = await supabase
      .from('listing_images')
      .select('listing_id, storage_path, sort_order')
      .in(
        'listing_id',
        marketplaceListings.map((item) => item.id),
      )
      .order('sort_order', { ascending: true });
    if (imageError) throw imageError;
    const pathsByListing = new Map();
    (imageRows || []).forEach((image) =>
      pathsByListing.set(image.listing_id, [
        ...(pathsByListing.get(image.listing_id) || []),
        image.storage_path,
      ]),
    );
    const products = await Promise.all(
      marketplaceListings.map(async (item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        condition: item.condition,
        location: item.location,
        rate: Number(item.admin_rate),
        availability: item.status === 'published' ? 'available' : item.status,
        visibility: 'public',
        createdAt: item.created_at,
        images: (await signedImageUrls(pathsByListing.get(item.id))).filter(
          Boolean,
        ),
        source: 'supabase',
      })),
    );
    window.marketplaceProducts = products;
    window.newpageRenderProduct?.(products[0]);
  } catch (error) {
    console.warn('Could not load Supabase product:', error);
    window.newpageShowProductNotFound?.();
  }
}

if (window.newpageRenderProduct) loadProduct();
else
  window.addEventListener('newpage:product-ready', loadProduct, { once: true });
