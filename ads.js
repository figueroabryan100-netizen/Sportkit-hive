// Owner-controlled ad slots: Google AdSense (only when a publisher ID is set) and house/partner banners.
import { esc, track } from "/js/app.js?v=6";

let loaded = false;
function loadAdSense(client) {
  if (loaded || !/^ca-pub-\d{6,}$/.test(client)) return false;
  loaded = true;
  const sc = document.createElement("script");
  sc.async = true; sc.crossOrigin = "anonymous";
  sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  document.head.append(sc);
  return true;
}
const houseFor = (ads, place) => ads.house.map((h, i) => ({ ...h, i })).filter((h) => !h.placement || h.placement === "any" || h.placement === place);

// Returns HTML for one ad slot, or "" when nothing should show here.
export function adSlot(store, place, n = 0) {
  const ads = store.ads || {};
  if (!(ads.placements || []).includes(place)) return "";
  const house = houseFor(ads, place);
  if (house.length && (!ads.adsense_client || n % 2 === 1)) {
    const h = house[n % house.length];
    return `<a class="ad-slot ad-house" href="/go/${h.i}" rel="sponsored noopener" target="_blank" data-ad="house-${h.i}"><img src="${esc(h.image)}" alt="${esc(h.title || "Sponsored")}" loading="lazy"><span class="ad-label">Sponsored</span></a>`;
  }
  if (loadAdSense(ads.adsense_client) || loaded) {
    return `<div class="ad-slot ad-google"><span class="ad-label">Advertisement</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ads.adsense_client)}" ${ads.adsense_slot ? `data-ad-slot="${esc(ads.adsense_slot)}"` : ""} data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
  }
  return "";
}
// Call after inserting slots into the page.
export function fillAds(root = document) {
  for (const ins of root.querySelectorAll("ins.adsbygoogle:not([data-done])")) {
    ins.dataset.done = 1;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }
  for (const a of root.querySelectorAll("[data-ad]:not([data-seen])")) { a.dataset.seen = 1; track("ad_view", { slug: a.dataset.ad }); }
}
