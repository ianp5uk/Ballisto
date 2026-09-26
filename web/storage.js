/*
 * Ballisto storage layer.
 *
 * The database is a single plain-text (JSON) file. Where it lives depends on
 * the host, so the web app only talks to this small interface:
 *
 *   Android : window.BallistoNative.loadDb() / saveDb(text) / exitApp()
 *             (a @JavascriptInterface in MainActivity.kt, writes
 *             <app files dir>/ballisto_db.json)
 *   iOS     : a native WKWebView host can inject the file's text as
 *             window.__BALLISTO_DB__ at document start and receive saves via
 *             window.webkit.messageHandlers.ballisto.postMessage({op, text})
 *   Browser : falls back to localStorage (for development/testing only)
 */
(function (root) {
  'use strict';
  var KEY = 'ballisto_db';

  function native() { return root.BallistoNative || null; }
  function ios() {
    return root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.ballisto
      ? root.webkit.messageHandlers.ballisto : null;
  }

  function loadText() {
    try {
      if (native()) return native().loadDb() || '';
      if (typeof root.__BALLISTO_DB__ === 'string') return root.__BALLISTO_DB__;
      return root.localStorage ? (root.localStorage.getItem(KEY) || '') : '';
    } catch (e) { return ''; }
  }

  function saveText(text) {
    try {
      if (native()) return !!native().saveDb(text);
      if (ios()) { ios().postMessage({ op: 'save', text: text }); root.__BALLISTO_DB__ = text; return true; }
      if (root.localStorage) { root.localStorage.setItem(KEY, text); return true; }
    } catch (e) { /* fall through */ }
    return false;
  }

  function exitApp() {
    if (native()) { native().exitApp(); return true; }
    if (ios()) { ios().postMessage({ op: 'exit' }); return true; }
    return false;
  }

  function emptyDb() {
    return { format: 'ballisto-db', version: 1, nextId: 1, ammo: [], rifles: [], state: { welcomeDone: false, compute: null } };
  }

  function load() {
    var text = loadText();
    if (!text) return { db: emptyDb(), fresh: true };
    try {
      var db = JSON.parse(text);
      if (!db || db.format !== 'ballisto-db') throw new Error('bad format');
      db.ammo = db.ammo || []; db.rifles = db.rifles || [];
      db.state = db.state || { welcomeDone: true, compute: null };
      db.nextId = db.nextId || 1;
      return { db: db, fresh: false };
    } catch (e) {
      return { db: emptyDb(), fresh: true, corrupt: true };
    }
  }

  function save(db) { return saveText(JSON.stringify(db, null, 2)); }

  root.BallistoStorage = { load: load, save: save, exitApp: exitApp, emptyDb: emptyDb };
})(typeof window !== 'undefined' ? window : globalThis);
