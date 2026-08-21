// URL-safety guard for anything the trailer might hand to an <img>/<video>.
// Technical spec §11 (A03 / URL handling). Applied by the App.jsx adapter
// before data ever enters this feature.
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

// Sibling check for the trailer's own video source (event-reveal-trailer
// direction change, 2026-08-21: a real video, uploaded or linked, replaces
// the generated beat sequence). Same generic http(s)-only protocol guard as
// `isSafeImageUrl` above, plus a file-extension check -- the exact regex
// `PresentationMode` already uses at its own video-vs-image branch
// (src/App.jsx, `isVideo=media&&/\.(mp4|webm|mov|ogg)(\?|$)/i.test(media)`)
// duplicated here on purpose rather than imported, so `PresentationMode`
// stays byte-identical and untouched.
const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogg)(\?|$)/i;
export function isSafeVideoUrl(u) {
  return isSafeImageUrl(u) && VIDEO_EXT_RE.test(u);
}
