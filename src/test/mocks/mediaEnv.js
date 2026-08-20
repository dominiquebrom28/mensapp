// Shared, OPT-IN media/browser environment mock for trailer tests.
//
// NOT installed in src/test/setup.js -- import and call `installMediaEnv()`
// explicitly at the top of a test file, and call the returned `restore()`
// in `afterEach`. This keeps zero risk to the existing (159-and-counting)
// non-trailer tests, none of which import this file.
//
// Stubs, per docs/trailer-technical-spec.md §8:
//  - window.matchMedia (controllable `prefers-reduced-motion` response)
//  - HTMLMediaElement play()/pause()/currentTime (jsdom's real
//    `HTMLMediaElement.prototype.play` throws "Not implemented" -- this
//    replaces it with a controllable fake)
//  - Image (decode() + onload/onerror, driven manually -- jsdom never
//    actually fetches a `src`, so nothing fires on its own)
//  - navigator.connection (optional; only installed when `connection` is passed)
export function installMediaEnv({ reducedMotion = false, connection = null } = {}) {
  const originals = {};
  const registry = new Map(); // src -> mock Image instance

  // --- window.matchMedia -------------------------------------------------
  originals.matchMedia = window.matchMedia;
  let currentReducedMotion = reducedMotion;
  window.matchMedia = (query) => ({
    matches: /prefers-reduced-motion:\s*reduce/.test(query) ? currentReducedMotion : false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });

  // --- HTMLMediaElement (shared by <audio>/<video>) ----------------------
  originals.play = window.HTMLMediaElement?.prototype.play;
  originals.pause = window.HTMLMediaElement?.prototype.pause;
  originals.currentTimeDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLMediaElement?.prototype || {},
    'currentTime',
  );
  originals.pausedDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLMediaElement?.prototype || {},
    'paused',
  );
  let playResultMode = 'resolve'; // 'resolve' | 'reject'
  if (window.HTMLMediaElement) {
    // jsdom's real `paused` is a getter-only accessor -- redefine it as a
    // plain read/write mock property so `play()`/`pause()` can flip it.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return this._mockPaused ?? true; },
      set(v) { this._mockPaused = v; },
    });
    window.HTMLMediaElement.prototype.play = function mockPlay() {
      this.paused = false;
      return playResultMode === 'resolve'
        ? Promise.resolve()
        : Promise.reject(new Error('play() rejected (mediaEnv mock)'));
    };
    window.HTMLMediaElement.prototype.pause = function mockPause() {
      this.paused = true;
    };
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return this._mockCurrentTime ?? 0; },
      set(v) { this._mockCurrentTime = v; },
    });
  }

  // --- Image (decode / onload / onerror) ----------------------------------
  originals.Image = window.Image;
  class MockImage {
    constructor() {
      this._src = '';
      this.onload = null;
      this.onerror = null;
      this.decoding = 'async';
      this._decodeResolve = null;
      this._decodeReject = null;
      this._decodePromise = null;
    }

    set src(v) {
      this._src = v;
      registry.set(v, this);
    }

    get src() { return this._src; }

    decode() {
      if (!this._decodePromise) {
        this._decodePromise = new Promise((resolve, reject) => {
          this._decodeResolve = resolve;
          this._decodeReject = reject;
        });
      }
      return this._decodePromise;
    }
  }
  window.Image = MockImage;

  // --- navigator.connection (optional) -------------------------------------
  let connDescriptor = null;
  let connInstalled = false;
  if (connection) {
    connDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'connection');
    Object.defineProperty(window.navigator, 'connection', { configurable: true, value: connection });
    connInstalled = true;
  }

  function restore() {
    window.matchMedia = originals.matchMedia;
    if (window.HTMLMediaElement) {
      if (originals.play) window.HTMLMediaElement.prototype.play = originals.play;
      if (originals.pause) window.HTMLMediaElement.prototype.pause = originals.pause;
      if (originals.currentTimeDescriptor) {
        Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', originals.currentTimeDescriptor);
      }
      if (originals.pausedDescriptor) {
        Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', originals.pausedDescriptor);
      }
    }
    window.Image = originals.Image;
    if (connInstalled) {
      if (connDescriptor) Object.defineProperty(window.navigator, 'connection', connDescriptor);
      else delete window.navigator.connection;
    }
    registry.clear();
  }

  return {
    restore,
    setReducedMotion(v) { currentReducedMotion = v; },
    setPlayResult(mode) { playResultMode = mode; }, // 'resolve' | 'reject'
    /** Simulate a successful network load + decode for `url`. */
    resolveImage(url) {
      const img = registry.get(url);
      if (!img) return;
      if (typeof img.onload === 'function') img.onload();
      if (img._decodeResolve) img._decodeResolve();
    },
    /** Simulate a network error (or timeout-equivalent) for `url`. */
    rejectImage(url) {
      const img = registry.get(url);
      if (!img) return;
      if (typeof img.onerror === 'function') img.onerror(new Error('mediaEnv mock: image error'));
      if (img._decodeReject) img._decodeReject(new Error('mediaEnv mock: decode error'));
    },
    /** Simulate `decode()` rejecting while the image still loads fine via onload. */
    rejectDecodeOnly(url) {
      const img = registry.get(url);
      if (!img) return;
      img.decode(); // ensure the promise exists
      img._decodeReject(new Error('mediaEnv mock: decode-only rejection'));
    },
    /** Direct access, for assertions like "was an Image ever constructed for this URL". */
    getImage(url) { return registry.get(url) || null; },
  };
}
