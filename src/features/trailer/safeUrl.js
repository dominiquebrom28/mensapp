// URL-safety guard for anything the trailer might hand to an <img>/preloader.
// Technical spec §11 (A03 / URL handling). Applied by the App.jsx adapter
// before data ever enters this feature, and re-applied defensively inside
// buildBeats.js -- belt and suspenders, cheap and worth it.
//
// `data:` and `blob:` are rejected. Neither is script-executable in an
// <img src>, but rejecting them removes a class of surprise for zero cost.
export function isSafeImageUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}
