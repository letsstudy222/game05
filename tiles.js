// tiles.js — OPTIONAL: swap the procedural coast for real photogrammetry.
//
// Google publishes photorealistic 3D meshes of Vietnamese cities (Hà Nội,
// Nha Trang, Đà Nẵng, TP.HCM…) through the Map Tiles API. That is the only
// legitimate way to put "real Google Maps scenery" in a game — screenshotting
// Maps or Street View and baking it into textures breaks Google's terms.
//
// To turn it on:
//   1. console.cloud.google.com → create a project → enable "Map Tiles API"
//   2. create an API key, restrict it to your GitHub Pages domain
//      (e.g. https://yourname.github.io/*)
//   3. paste it below and reload
//
// Free tier is generous but not unlimited, and the key is visible in the page
// source, so the referrer restriction is what protects you. Attribution text
// returned by the tileset MUST stay visible — that is a licence condition.

export const GOOGLE_3D_TILES_KEY = '';   // '' = stay fully procedural

// Landmarks worth flying to once tiles are on.
export const PLACES = {
  hoanKiem:   { lat: 21.0287, lon: 105.8524, name: 'Hồ Hoàn Kiếm, Hà Nội' },
  phoCo:      { lat: 21.0345, lon: 105.8500, name: 'Phố cổ Hà Nội' },
  tranPhu:    { lat: 12.2388, lon: 109.1967, name: 'Đường Trần Phú, Nha Trang' },
  honChong:   { lat: 12.2680, lon: 109.2070, name: 'Hòn Chồng, Nha Trang' },
  myKhe:      { lat: 16.0596, lon: 108.2470, name: 'Biển Mỹ Khê, Đà Nẵng' },
  langCo:     { lat: 16.2333, lon: 108.0833, name: 'Đèo Hải Vân — Lăng Cô' },
};

let tiles = null;

export async function attachGoogleTiles(scene, camera, renderer, place = PLACES.tranPhu) {
  if (!GOOGLE_3D_TILES_KEY) return null;

  // Loaded from a CDN so the project still needs no build step.
  const { GoogleTilesRenderer } = await import(
    'https://esm.sh/3d-tiles-renderer@0.3.38?external=three'
  );

  tiles = new GoogleTilesRenderer(GOOGLE_3D_TILES_KEY);
  tiles.setLatLonToYUp(place.lat * Math.PI / 180, place.lon * Math.PI / 180);
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = 24;            // raise for speed, lower for detail
  scene.add(tiles.group);

  // Licence condition: keep the credit string on screen.
  const credit = document.createElement('div');
  credit.style.cssText =
    'position:fixed;left:50%;bottom:4px;transform:translateX(-50%);z-index:20;' +
    'font:300 10px/1.4 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;' +
    'pointer-events:none;max-width:90vw;text-align:center';
  document.body.appendChild(credit);

  tiles.addEventListener('load-tile-set', () => {
    credit.textContent = tiles.getAttributions().map((a) => a.value).join(' · ');
  });

  return {
    tiles,
    update() {
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
    },
  };
}

export function updateTiles() { if (tiles) tiles.update(); }
