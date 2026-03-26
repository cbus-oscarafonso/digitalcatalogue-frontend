const BASE =
  "https://ytwwcrhtcsdpqeualnsx.supabase.co/storage/v1/object/public/catalogs";

export function getMainAssemblySvgPath(paiCode) {
  return `${BASE}/${paiCode}/pai_${paiCode}.svg`;
}

export function getSubAssemblySvgPath(paiCode, componentCode) {
  return `${BASE}/${paiCode}/svg/${componentCode}.svg`;
}

export function getSubAssemblyThumbPath(paiCode, componentCode) {
  return `${BASE}/${paiCode}/thumb/${componentCode}.jpg`;
}

export function getDefaultThumbPath() {
  return `${BASE}/thumb_default.jpg`;
}

export function getSearchIndexPath(paiCode) {
  return `${BASE}/${paiCode}/search-index.json`;
}