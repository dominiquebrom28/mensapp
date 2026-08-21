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
//  - Fullscreen: Element.requestFullscreen/document.exitFullscreen/
//    document.fullscreenElement (standard) + document.webkitExitFullscreen/
//    document.webkitFullscreenElement (older desktop Safari/Chrome) +
//    video.webkitExitFullscreen/video.webkitDisplayingFullscreen (iOS
//    Safari's separate, video-element-specific API) -- jsdom implements
//    none of it. Added for EventTrailer.jsx's fullscreen-exit bugfix (see
//    its own module docblock's "FULLSCREEN TRAP" note).
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
  let playResultMode = 'resolve'; // 'resolve' | 'reject' | 'defer'
  // `defer`-mode play() calls, in call order -- each entry's `resolve`/
  // `reject` is exposed to the test so it can settle a *specific* call
  // whenever it chooses, independent of any later call. This exists to
  // reproduce the real-world "unlock play() is still buffering when the
  // countdown finishes and a second, real play() call also fires" race
  // (see EventTrailer.jsx's own docblock on the "keeps starting over" bug)
  // -- a mock that always resolves instantly cannot exercise that ordering
  // at all, no matter how the test is written around it.
  const pendingPlays = [];
  if (window.HTMLMediaElement) {
    // jsdom's real `paused` is a getter-only accessor -- redefine it as a
    // plain read/write mock property so `play()`/`pause()` can flip it.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return this._mockPaused ?? true; },
      set(v) { this._mockPaused = v; },
    });
    window.HTMLMediaElement.prototype.play = function mockPlay() {
      // Per spec, `paused` flips to false synchronously the instant play()
      // is *called* -- independent of when/whether its returned promise
      // settles. True for all three modes below, deferred included.
      this.paused = false;
      if (playResultMode === 'defer') {
        let resolveFn;
        let rejectFn;
        const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
        pendingPlays.push({ resolve: resolveFn, reject: rejectFn });
        return promise;
      }
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

  // --- Fullscreen APIs (standard + iOS Safari's video-specific webkit
  // variant) -- jsdom implements none of this. EventTrailer.jsx's
  // fullscreen-exit bugfix (see its own module docblock's "FULLSCREEN
  // TRAP" note) needs both kinds, so this mock covers both:
  //  - the standard Fullscreen API, driven realistically -- mocked
  //    `Element.prototype.requestFullscreen` sets `document.
  //    fullscreenElement` (and the older `webkitFullscreenElement`) to
  //    that element, `document.exitFullscreen()`/`webkitExitFullscreen()`
  //    clear it back to null. `setExitFullscreenMode('reject'|'throw')`
  //    lets a test simulate a failed exit (e.g. called outside a
  //    user-gesture context, which some browsers enforce).
  //  - iOS's own `video.webkitExitFullscreen()` + `video.
  //    webkitDisplayingFullscreen` -- entirely separate from the above (no
  //    document.fullscreenElement involved at all on iOS). A real exit
  //    flips `webkitDisplayingFullscreen` back to false and fires
  //    `webkitendfullscreen` on the element, same as the real API;
  //    `setVideoWebkitExitFullscreenMode('throw')` simulates a failure.
  originals.requestFullscreen = window.Element?.prototype.requestFullscreen;
  originals.documentExitFullscreen = document.exitFullscreen;
  originals.documentWebkitExitFullscreen = document.webkitExitFullscreen;
  originals.fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  originals.webkitFullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, 'webkitFullscreenElement');
  originals.videoWebkitExitFullscreen = window.HTMLMediaElement?.prototype.webkitExitFullscreen;
  originals.webkitDisplayingFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLMediaElement?.prototype || {},
    'webkitDisplayingFullscreen',
  );

  let fullscreenElement = null;
  let exitFullscreenMode = 'resolve'; // 'resolve' | 'reject' | 'throw'
  let videoWebkitExitFullscreenMode = 'resolve'; // 'resolve' | 'throw'

  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => fullscreenElement });

  if (window.Element) {
    window.Element.prototype.requestFullscreen = function mockRequestFullscreen() {
      fullscreenElement = this;
      return Promise.resolve();
    };
  }
  document.exitFullscreen = function mockExitFullscreen() {
    if (exitFullscreenMode === 'throw') throw new Error('exitFullscreen() threw (mediaEnv mock)');
    fullscreenElement = null;
    return exitFullscreenMode === 'reject'
      ? Promise.reject(new Error('exitFullscreen() rejected (mediaEnv mock)'))
      : Promise.resolve();
  };
  document.webkitExitFullscreen = function mockDocumentWebkitExitFullscreen() {
    if (exitFullscreenMode === 'throw') throw new Error('webkitExitFullscreen() threw (mediaEnv mock)');
    fullscreenElement = null;
  };

  if (window.HTMLMediaElement) {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'webkitDisplayingFullscreen', {
      configurable: true,
      get() { return this._mockWebkitDisplayingFullscreen ?? false; },
      set(v) { this._mockWebkitDisplayingFullscreen = v; },
    });
    window.HTMLMediaElement.prototype.webkitExitFullscreen = function mockVideoWebkitExitFullscreen() {
      if (videoWebkitExitFullscreenMode === 'throw') {
        throw new Error('video.webkitExitFullscreen() threw (mediaEnv mock)');
      }
      this._mockWebkitDisplayingFullscreen = false;
      this.dispatchEvent(new Event('webkitendfullscreen'));
    };
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
      if (originals.videoWebkitExitFullscreen) {
        window.HTMLMediaElement.prototype.webkitExitFullscreen = originals.videoWebkitExitFullscreen;
      } else {
        delete window.HTMLMediaElement.prototype.webkitExitFullscreen;
      }
      if (originals.webkitDisplayingFullscreenDescriptor) {
        Object.defineProperty(
          window.HTMLMediaElement.prototype,
          'webkitDisplayingFullscreen',
          originals.webkitDisplayingFullscreenDescriptor,
        );
      } else {
        delete window.HTMLMediaElement.prototype.webkitDisplayingFullscreen;
      }
    }
    if (window.Element) {
      if (originals.requestFullscreen) window.Element.prototype.requestFullscreen = originals.requestFullscreen;
      else delete window.Element.prototype.requestFullscreen;
    }
    if (originals.documentExitFullscreen) document.exitFullscreen = originals.documentExitFullscreen;
    else delete document.exitFullscreen;
    if (originals.documentWebkitExitFullscreen) document.webkitExitFullscreen = originals.documentWebkitExitFullscreen;
    else delete document.webkitExitFullscreen;
    if (originals.fullscreenElementDescriptor) {
      Object.defineProperty(document, 'fullscreenElement', originals.fullscreenElementDescriptor);
    } else {
      delete document.fullscreenElement;
    }
    if (originals.webkitFullscreenElementDescriptor) {
      Object.defineProperty(document, 'webkitFullscreenElement', originals.webkitFullscreenElementDescriptor);
    } else {
      delete document.webkitFullscreenElement;
    }
    window.Image = originals.Image;
    if (connInstalled) {
      if (connDescriptor) Object.defineProperty(window.navigator, 'connection', connDescriptor);
      else delete window.navigator.connection;
    }
    registry.clear();
    pendingPlays.length = 0;
  }

  return {
    restore,
    setReducedMotion(v) { currentReducedMotion = v; },
    setPlayResult(mode) { playResultMode = mode; }, // 'resolve' | 'reject' | 'defer'
    /**
     * Settle a specific `defer`-mode play() call by its call order (0 =
     * first play() invoked while in `defer` mode, independent of any
     * `resolve`/`reject` calls made in between on other modes). Lets a test
     * assert real-world orderings like "call #1 is still pending when call
     * #2 resolves" -- see EventTrailer.render.test.jsx's "keeps starting
     * over" regression test.
     */
    resolveNextDeferredPlay(index = 0) { pendingPlays[index]?.resolve(); },
    rejectNextDeferredPlay(index = 0) { pendingPlays[index]?.reject(new Error('play() rejected (mediaEnv mock, deferred)')); },
    /** How many `defer`-mode play() calls are outstanding right now. */
    pendingPlayCount() { return pendingPlays.length; },
    /**
     * 'resolve' (default) | 'reject' | 'throw' -- controls BOTH
     * `document.exitFullscreen()` (rejects) and `document.
     * webkitExitFullscreen()` (throws synchronously, since the real API is
     * void/non-Promise) when set to a failing mode.
     */
    setExitFullscreenMode(mode) { exitFullscreenMode = mode; },
    /** 'resolve' (default) | 'throw' -- for iOS's `video.webkitExitFullscreen()`. */
    setVideoWebkitExitFullscreenMode(mode) { videoWebkitExitFullscreenMode = mode; },
    /**
     * Direct override for `document.fullscreenElement`/
     * `webkitFullscreenElement` -- mainly for simulating an unrelated
     * element being fullscreened (to assert our exit logic leaves it
     * alone). Prefer `await el.requestFullscreen()` (also mocked) for the
     * common "our video is fullscreened" case -- more realistic, and it's
     * what production code actually triggers via native `<video
     * controls>`.
     */
    setFullscreenElement(el) { fullscreenElement = el; },
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
