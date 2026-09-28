/*
 * Ballisto - user interface logic.
 * Plain ES5-style JavaScript (no build step, no libraries) so it runs on old
 * Android System WebViews as well as current ones, and unchanged on iOS.
 */
(function () {
  'use strict';

  var VERSION = '1.0.2';
  var B = window.Ballistics, S = window.BallistoStorage, U = B.units;
  var DEF = { bc: '0.112', drag: 'RA4', clickMRAD: '0.1', clickMOA: '0.25', twist: '16' };

  var loaded = S.load();
  var db = loaded.db;
  var history = [];
  var current = null;
  var sessionRecent = { ammo: [], rifle: [] };
  var ammoMode = { kind: 'new', id: null, origName: '' };   // kind: new | edit | copy
  var rifleMode = { kind: 'new', id: null, origName: '' };
  var dbTab = 'ammo';

  function $(id) { return document.getElementById(id); }
  function persist() {
    if (!S.save(db)) toast('Warning: could not write the database file.', true);
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(s) {
    s = String(s == null ? '' : s).trim().replace(',', '.');
    if (s === '' || !/^[-+]?\d*\.?\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function round(x, dp) { var f = Math.pow(10, dp); return Math.round(x * f) / f; }
  function fixed(x, dp) { return (Math.abs(x) < 0.5 / Math.pow(10, dp) ? 0 : x).toFixed(dp); }

  // ---------------------------------------------------------------- toast / modal
  var toastTimer = null;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, isError ? 4200 : 2600);
  }
  function confirmBox(title, text, okLabel, onOk) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalOk').textContent = okLabel || 'OK';
    $('modal').className = 'modal';
    $('modalOk').onclick = function () { $('modal').className = 'modal hidden'; onOk(); };
    $('modalCancel').onclick = function () { $('modal').className = 'modal hidden'; };
  }

  // ---------------------------------------------------------------- navigation
  function go(name, noHistory) {
    closeMenu();
    if (name === 'exit') return exitApp();
    if (name !== 'welcome' && !db.state.welcomeDone) { db.state.welcomeDone = true; persist(); }
    if ((name === 'rifle' || name === 'compute' || name === 'db') && db.ammo.length === 0) {
      toast('Please enter an ammo specification first.');
      name = 'ammo';
    }
    if (name === 'compute' && db.rifles.length === 0) {
      toast('Please enter a rifle before computing.');
      name = 'rifle';
    }
    if (current && current !== name && !noHistory) history.push(current);
    current = name;
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.add('hidden');
    $('screen-' + name).classList.remove('hidden');
    if (name === 'ammo') renderRecent('ammo');
    if (name === 'rifle') renderRecent('rifle');
    if (name === 'compute') enterCompute();
    if (name === 'db') renderDb();
    window.scrollTo(0, 0);
  }
  function exitApp() {
    if (!S.exitApp()) toast('Ballisto can be closed now (close this browser tab).');
  }
  // Called by the Android back button. Returns true if handled.
  window.BallistoBack = function () {
    if (!$('modal').classList.contains('hidden')) { $('modal').className = 'modal hidden'; return true; }
    if (!$('menu').classList.contains('hidden')) { closeMenu(); return true; }
    if (history.length) { go(history.pop(), true); return true; }
    return false;
  };

  function closeMenu() { $('menu').classList.add('hidden'); $('menuBtn').setAttribute('aria-expanded', 'false'); }
  $('menuBtn').onclick = function (e) {
    e.stopPropagation();
    var m = $('menu'), open = m.classList.contains('hidden');
    m.classList.toggle('hidden', !open);
    $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-go]') : null;
    if (t) { go(t.getAttribute('data-go')); return; }
    if (!$('menu').contains(e.target)) closeMenu();
  });

  // ---------------------------------------------------------------- "default" (grey) handling
  function setDefault(el, value) { el.value = value; el.classList.add('default'); el.setAttribute('data-default', '1'); }
  function setUser(el, value) { el.value = value; el.classList.remove('default'); el.removeAttribute('data-default'); }
  function isDefault(el) { return el.getAttribute('data-default') === '1'; }
  function watchDefault(el) {
    var clear = function () { el.classList.remove('default'); el.removeAttribute('data-default'); el.classList.remove('invalid'); };
    el.addEventListener('input', clear);
    el.addEventListener('change', clear);
    // Selecting a grey default on focus makes it easy to type straight over it.
    if (el.tagName === 'INPUT') el.addEventListener('focus', function () { if (isDefault(el)) { try { el.select(); } catch (e) { /* ignore */ } } });
  }
  function markInvalid(ids) {
    for (var i = 0; i < ids.length; i++) $(ids[i]).classList.add('invalid');
    if (ids.length) $(ids[0]).focus();
  }
  function uniqueName(list, name, exceptId) {
    var n = name.trim().toLowerCase();
    for (var i = 0; i < list.length; i++) if (list[i].id !== exceptId && list[i].name.trim().toLowerCase() === n) return false;
    return true;
  }

  // ================================================================ AMMO
  var dragSel = $('aDrag');
  B.DRAG_MODELS.forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; dragSel.appendChild(o); });
  ['aName', 'aWeight', 'aMv', 'aBc', 'aDrag', 'aWeightUnit', 'aMvUnit'].forEach(function (id) { watchDefault($(id)); });
  $('aName').addEventListener('input', function () { $('aName').classList.remove('invalid'); });

  function resetAmmoForm() {
    ammoMode = { kind: 'new', id: null, origName: '' };
    setUser($('aName'), ''); setUser($('aWeight'), ''); setUser($('aMv'), '');
    setDefault($('aWeightUnit'), 'grain'); setDefault($('aMvUnit'), 'fps');
    setDefault($('aBc'), DEF.bc); setDefault($('aDrag'), DEF.drag);
    ['aName', 'aWeight', 'aMv', 'aBc'].forEach(function (id) { $(id).classList.remove('invalid'); });
    showMode('ammo');
  }
  function ammoPristine() {
    return !$('aName').value.trim() && !$('aWeight').value.trim() && !$('aMv').value.trim() &&
      isDefault($('aBc')) && isDefault($('aDrag')) && ammoMode.kind === 'new';
  }
  function loadAmmoIntoForm(a, kind) {
    setUser($('aName'), kind === 'copy' ? ('COPY: ' + a.name).slice(0, 32) : a.name);
    setUser($('aWeight'), String(a.weight)); setUser($('aWeightUnit'), a.weightUnit);
    setUser($('aMv'), String(a.mv)); setUser($('aMvUnit'), a.mvUnit);
    setUser($('aBc'), String(a.bc)); setUser($('aDrag'), a.drag);
    ammoMode = { kind: kind, id: a.id, origName: a.name };
    showMode('ammo');
  }

  // Returns true if saved.
  function saveAmmo() {
    var name = $('aName').value.trim(), w = num($('aWeight').value), mv = num($('aMv').value), bc = num($('aBc').value);
    var missing = [];
    if (!name) missing.push('aName');
    if (!(w > 0 && w <= 1000)) missing.push('aWeight');
    if (!(mv > 0 && mv <= 5000 && Math.round(mv) === mv)) missing.push('aMv');
    if (missing.length) {
      markInvalid(missing);
      toast('Please complete: ' + missing.map(function (id) { return { aName: 'name', aWeight: 'bullet weight (0 - 1000)', aMv: 'muzzle velocity (whole number, 1 - 5000)' }[id]; }).join(', ') + '.', true);
      return false;
    }
    if (!(bc > 0 && bc <= 2)) { markInvalid(['aBc']); toast('Ballistic coefficient must be between 0 and 2.', true); return false; }
    if (ammoMode.kind === 'copy' && name.toLowerCase() === ammoMode.origName.trim().toLowerCase()) {
      markInvalid(['aName']);
      toast('You chose Copy, which requires a new name. To overwrite "' + ammoMode.origName + '" use Edit instead.', true);
      return false;
    }
    var selfId = ammoMode.kind === 'edit' ? ammoMode.id : null;
    if (!uniqueName(db.ammo, name, selfId)) { markInvalid(['aName']); toast('An ammo set called "' + name + '" already exists. Choose another name, or use Edit Database to change it.', true); return false; }
    var usedDefaults = [];
    if (isDefault($('aBc'))) usedDefaults.push('BC ' + DEF.bc);
    if (isDefault($('aDrag'))) usedDefaults.push('drag model ' + DEF.drag);
    if (isDefault($('aWeightUnit'))) usedDefaults.push('grains');
    if (isDefault($('aMvUnit'))) usedDefaults.push('ft/s');
    var rec = {
      name: name, weight: round(w, 2), weightUnit: $('aWeightUnit').value,
      mv: Math.round(mv), mvUnit: $('aMvUnit').value, bc: round(bc, 3), drag: $('aDrag').value
    };
    if (selfId) {
      var a = byId(db.ammo, selfId);
      for (var k in rec) a[k] = rec[k];
    } else {
      rec.id = 'a' + (db.nextId++);
      db.ammo.push(rec);
    }
    persist();
    sessionRecent.ammo.unshift(name);
    renderRecent('ammo');
    if (usedDefaults.length) toast('Saving with defaults: ' + usedDefaults.join(', ') + '.');
    else toast((selfId ? 'Updated "' : 'Saved "') + name + '".');
    resetAmmoForm();
    return true;
  }
  $('aSave').onclick = saveAmmo;
  $('aNext').onclick = function () {
    if (ammoPristine()) {
      if (db.ammo.length === 0) { toast('Please enter an ammo specification first.', true); markInvalid(['aName', 'aWeight', 'aMv']); return; }
      go('rifle'); return;
    }
    if (saveAmmo()) go('rifle');
  };
  $('aCancel').onclick = function () { resetAmmoForm(); toast('Entry cleared.'); };

  // ================================================================ RIFLE
  ['rName', 'rClick', 'rSight', 'rZero', 'rTwist', 'rClickUnit', 'rSightUnit', 'rZeroUnit', 'rTwistDir'].forEach(function (id) { watchDefault($(id)); });
  $('rClickUnit').addEventListener('change', function () {
    if (isDefault($('rClick')) || $('rClick').value.trim() === '') setDefault($('rClick'), $('rClickUnit').value === 'MOA' ? DEF.clickMOA : DEF.clickMRAD);
  });

  function resetRifleForm() {
    rifleMode = { kind: 'new', id: null, origName: '' };
    setUser($('rName'), ''); setUser($('rSight'), ''); setUser($('rZero'), '');
    setDefault($('rClickUnit'), 'MRAD'); setDefault($('rClick'), DEF.clickMRAD);
    setDefault($('rSightUnit'), 'cm'); setDefault($('rZeroUnit'), 'yard');
    setDefault($('rTwist'), DEF.twist); setDefault($('rTwistDir'), 'R');
    ['rName', 'rClick', 'rSight', 'rZero', 'rTwist'].forEach(function (id) { $(id).classList.remove('invalid'); });
    showMode('rifle');
  }
  function riflePristine() {
    return !$('rName').value.trim() && !$('rSight').value.trim() && !$('rZero').value.trim() &&
      isDefault($('rClick')) && isDefault($('rTwist')) && rifleMode.kind === 'new';
  }
  function loadRifleIntoForm(r, kind) {
    setUser($('rName'), kind === 'copy' ? ('COPY: ' + r.name).slice(0, 32) : r.name);
    setUser($('rClickUnit'), r.clickUnit); setUser($('rClick'), String(r.click));
    setUser($('rSight'), String(r.sight)); setUser($('rSightUnit'), r.sightUnit);
    setUser($('rZero'), String(r.zero)); setUser($('rZeroUnit'), r.zeroUnit);
    setUser($('rTwist'), String(r.twist)); setUser($('rTwistDir'), r.twistDir);
    rifleMode = { kind: kind, id: r.id, origName: r.name };
    showMode('rifle');
  }
  function saveRifle() {
    var name = $('rName').value.trim(), click = num($('rClick').value), sight = num($('rSight').value);
    var zero = num($('rZero').value), twist = num($('rTwist').value);
    var missing = [];
    if (!name) missing.push('rName');
    if (!(click > 0 && click <= 1)) missing.push('rClick');
    if (!(sight > 0 && sight <= 10)) missing.push('rSight');
    if (!(zero > 0 && zero <= 5000 && Math.round(zero) === zero)) missing.push('rZero');
    if (missing.length) {
      markInvalid(missing);
      toast('Please complete: ' + missing.map(function (id) { return { rName: 'name', rClick: 'click increment (0 - 1)', rSight: 'sight height (0 - 10)', rZero: 'zero range (whole number, 1 - 5000)' }[id]; }).join(', ') + '.', true);
      return false;
    }
    if ($('rTwist').value.trim() === '') { setDefault($('rTwist'), DEF.twist); twist = 16; }
    if (!(twist >= 0 && twist <= 50)) { markInvalid(['rTwist']); toast('Bore twist rate must be between 0 and 50 (0 = no rifling).', true); return false; }
    if (rifleMode.kind === 'copy' && name.toLowerCase() === rifleMode.origName.trim().toLowerCase()) {
      markInvalid(['rName']);
      toast('You chose Copy, which requires a new name. To overwrite "' + rifleMode.origName + '" use Edit instead.', true);
      return false;
    }
    var selfId = rifleMode.kind === 'edit' ? rifleMode.id : null;
    if (!uniqueName(db.rifles, name, selfId)) { markInvalid(['rName']); toast('A rifle called "' + name + '" already exists. Choose another name, or use Edit Database to change it.', true); return false; }
    var usedDefaults = [];
    if (isDefault($('rClick'))) usedDefaults.push('click ' + $('rClick').value + ' ' + $('rClickUnit').value);
    else if (isDefault($('rClickUnit'))) usedDefaults.push('MRAD');
    if (isDefault($('rSightUnit'))) usedDefaults.push('cm');
    if (isDefault($('rZeroUnit'))) usedDefaults.push('yards');
    if (isDefault($('rTwist'))) usedDefaults.push('twist 16');
    if (isDefault($('rTwistDir'))) usedDefaults.push('right-hand twist');
    var rec = {
      name: name, clickUnit: $('rClickUnit').value, click: round(click, 2),
      sight: round(sight, 2), sightUnit: $('rSightUnit').value,
      zero: Math.round(zero), zeroUnit: $('rZeroUnit').value,
      twist: round(twist, 1), twistDir: $('rTwistDir').value
    };
    if (selfId) {
      var r = byId(db.rifles, selfId);
      for (var k in rec) r[k] = rec[k];
    } else {
      rec.id = 'r' + (db.nextId++);
      rec.ammoId = null;
      db.rifles.push(rec);
    }
    persist();
    sessionRecent.rifle.unshift(name);
    renderRecent('rifle');
    if (usedDefaults.length) toast('Saving with defaults: ' + usedDefaults.join(', ') + '.');
    else toast((selfId ? 'Updated "' : 'Saved "') + name + '".');
    resetRifleForm();
    return true;
  }
  $('rSave').onclick = saveRifle;
  $('rNext').onclick = function () {
    if (riflePristine()) {
      if (db.rifles.length === 0) { toast('Please enter a rifle first.', true); markInvalid(['rName', 'rSight', 'rZero']); return; }
      go('compute'); return;
    }
    if (saveRifle()) go('compute');
  };
  $('rCancel').onclick = function () { resetRifleForm(); toast('Entry cleared.'); };

  function showMode(which) {
    var mode = which === 'ammo' ? ammoMode : rifleMode;
    var banner = $(which === 'ammo' ? 'ammoMode' : 'rifleMode');
    var prefix = $(which === 'ammo' ? 'aEditPrefix' : 'rEditPrefix');
    prefix.classList.toggle('hidden', mode.kind !== 'edit');
    if (mode.kind === 'new') { banner.className = 'mode-banner hidden'; return; }
    banner.className = 'mode-banner';
    banner.textContent = mode.kind === 'edit'
      ? 'Editing "' + mode.origName + '". Save will overwrite it. Cancel to abandon.'
      : 'Copy of "' + mode.origName + '". Give it a new name, then Save.';
  }

  function renderRecent(which) {
    var list = sessionRecent[which], box = $(which === 'ammo' ? 'aRecent' : 'rRecent');
    box.innerHTML = list.length ? list.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('')
      : '<div class="muted">Nothing saved yet this session.</div>';
  }

  // ================================================================ COMPUTE
  var cState = db.state.compute || {};
  function fillSelect(sel, list, selectedId, blankLabel) {
    var html = '<option value="">' + esc(blankLabel) + '</option>';
    list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (x) {
      html += '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = selectedId && byId(list, selectedId) ? selectedId : '';
  }
  function unitLabel(u) { return { yard: 'yds', m: 'm', cm: 'cm', inch: 'in', fps: 'ft/s', mps: 'm/s', mph: 'mph', grain: 'gr', gram: 'g' }[u] || u; }

  function enterCompute() {
    fillSelect($('cRifle'), db.rifles, cState.rifleId, '- select rifle -');
    fillSelect($('cAmmo'), db.ammo, cState.ammoId, '- select ammo -');
    $('cWindMode').value = cState.windMode || 'miss';
    $('cMissDir').value = cState.missDir || 'L';
    $('cMissUnit').value = cState.missUnit || 'cm';
    $('cWindDir').value = cState.windDir || 'LR';
    $('cWindUnit').value = cState.windUnit || 'mps';
    $('cWindVal').value = cState.windVal != null ? cState.windVal : '0';
    rifleChanged(true);
    windModeChanged();
    if (cState.result && cState.rifleId && byId(db.rifles, cState.rifleId)) showResult(cState.result);
    else hideResult();
  }

  function rifleChanged(restoring) {
    var r = byId(db.rifles, $('cRifle').value);
    if (!r) {
      $('cZero').textContent = '-'; $('cZeroUnit').textContent = '';
      $('cRange').value = ''; $('cRange').classList.remove('unchanged');
      return;
    }
    $('cZero').textContent = r.zero; $('cZeroUnit').textContent = r.zeroUnit === 'yard' ? 'Yards' : 'Metres';
    if (!restoring && r.ammoId && byId(db.ammo, r.ammoId)) $('cAmmo').value = r.ammoId;
    if (!restoring && r.ammoId === null) $('cAmmo').value = '';
    if (restoring && cState.rangeTouched && cState.rifleId === r.id) {
      $('cRange').value = cState.range; $('cRangeUnit').value = cState.rangeUnit;
      $('cRange').classList.remove('unchanged');
    } else {
      setRangeDefault(r);
    }
  }
  function setRangeDefault(r) {
    $('cRange').value = r.zero; $('cRangeUnit').value = r.zeroUnit;
    $('cRange').classList.add('unchanged');
  }
  function rangeTouched() { return !$('cRange').classList.contains('unchanged'); }
  $('cRifle').addEventListener('change', function () { rifleChanged(false); hideResult(); });
  $('cAmmo').addEventListener('change', hideResult);
  $('cRange').addEventListener('input', function () { $('cRange').classList.remove('unchanged'); });
  $('cRangeUnit').addEventListener('change', function () { $('cRange').classList.remove('unchanged'); });

  function windModeChanged() {
    var miss = $('cWindMode').value === 'miss';
    $('cMissDir').classList.toggle('hidden', !miss); $('cMissUnit').classList.toggle('hidden', !miss);
    $('cWindDir').classList.toggle('hidden', miss); $('cWindUnit').classList.toggle('hidden', miss);
    $('cWindValLabel').textContent = miss ? 'Miss distance:' : 'Crosswind speed:';
  }
  $('cWindMode').addEventListener('change', windModeChanged);

  function hideResult() { $('cResult').classList.add('hidden'); $('cError').classList.add('hidden'); }
  function showError(msg) {
    $('cResult').classList.add('hidden');
    $('cError').textContent = msg; $('cError').classList.remove('hidden');
  }

  $('cCompute').onclick = function () {
    var r = byId(db.rifles, $('cRifle').value), a = byId(db.ammo, $('cAmmo').value);
    if (!r) return showError('No rifle selected.');
    if (!a) return showError('No ammo selected. Choose the ammunition to use with "' + r.name + '".');
    var range = num($('cRange').value);
    if (!(range > 0) || Math.round(range) !== range) return showError('Please enter the required range as a whole number.');
    var wv = num($('cWindVal').value || '0');
    if (!(wv >= 0 && wv <= 100)) return showError('Windage value must be between 0 and 100.');
    wv = round(wv, 2);
    var mode = $('cWindMode').value;
    var wind = mode === 'miss'
      ? { mode: 'miss', miss: wv * U[$('cMissUnit').value] * ($('cMissDir').value === 'R' ? 1 : -1) }
      : { mode: 'wind', speed: wv * U[$('cWindUnit').value] * ($('cWindDir').value === 'LR' ? 1 : -1) };
    var input = {
      bc: a.bc, dragModel: a.drag, v0: a.mv * U[a.mvUnit], massKg: a.weight * U[a.weightUnit],
      sightHeight: r.sight * U[r.sightUnit], zeroRange: r.zero * U[r.zeroUnit],
      clickUnit: r.clickUnit, click: r.click, twist: r.twist, twistDir: r.twistDir,
      range: range * U[$('cRangeUnit').value], wind: wind
    };
    var res = B.solve(input);
    cState = {
      rifleId: r.id, ammoId: a.id, range: range, rangeUnit: $('cRangeUnit').value, rangeTouched: rangeTouched(),
      windMode: mode, missDir: $('cMissDir').value, missUnit: $('cMissUnit').value,
      windDir: $('cWindDir').value, windUnit: $('cWindUnit').value, windVal: String(wv), result: null
    };
    if (!res.ok) { db.state.compute = cState; persist(); return showError(res.error); }
    r.ammoId = a.id; // remember this rifle's ammunition
    cState.result = packResult(res, r, a, range, $('cRangeUnit').value);
    db.state.compute = cState;
    persist();
    showResult(cState.result);
  };

  // Store only display-ready numbers so the screen can be restored exactly.
  function packResult(res, r, a, range, rangeUnit) {
    var imperial = rangeUnit === 'yard';
    var i = res.info;
    return {
      rifleName: r.name, ammoName: a.name, clickUnit: r.clickUnit, click: r.click,
      range: range, rangeUnit: rangeUnit, imperial: imperial,
      el: { mrad: res.elevation.mrad, moa: res.elevation.moa },
      wd: { mrad: res.windage.mrad, moa: res.windage.moa },
      impact: i.impactBeforeAdjust, v: i.velocity, t: i.time, e: i.energy,
      windDrift: i.windDrift, spin: i.spinDrift, mode: cState.windMode,
      transonic: i.transonic, longRange: i.longRange
    };
  }

  function clickRow(dirWord, unit, value, clickSize, own) {
    var n = Math.round(Math.abs(value) / clickSize);
    var clicksTxt = n + (n === 1 ? ' click' : ' clicks');
    if (n === 0 && Math.abs(value) > 0.0005) clicksTxt = '0 clicks (&lt; &frac12;)';
    var dir = n === 0 && Math.abs(value) < clickSize / 2 ? 'None' : dirWord;
    return '<tr class="' + (own ? 'own' : 'other') + '"><td class="dir">' + dir + '</td><td>' + unit + '</td><td class="val">' +
      fixed(Math.abs(value), 2) + '</td><td class="clicks">' + clicksTxt + '</td><td class="inc">' + clickSize + (own ? '' : '*') + '</td></tr>';
  }

  function showResult(p) {
    $('cError').classList.add('hidden');
    var mradClick = p.clickUnit === 'MRAD' ? p.click : 0.1;
    var moaClick = p.clickUnit === 'MOA' ? p.click : 0.25;
    var up = p.el.mrad >= 0 ? 'Up' : 'Down';
    var right = p.wd.mrad >= 0 ? 'Right' : 'Left';
    var rowsV = [clickRow(up, 'MRAD', p.el.mrad, mradClick, p.clickUnit === 'MRAD'), clickRow(up, 'MOA', p.el.moa, moaClick, p.clickUnit === 'MOA')];
    var rowsH = [clickRow(right, 'MRAD', p.wd.mrad, mradClick, p.clickUnit === 'MRAD'), clickRow(right, 'MOA', p.wd.moa, moaClick, p.clickUnit === 'MOA')];
    if (p.clickUnit === 'MOA') { rowsV.reverse(); rowsH.reverse(); }
    $('cVert').innerHTML = rowsV.join('');
    $('cHoriz').innerHTML = rowsH.join('');
    $('cSolNote').textContent = 'Last column = sight increment per click. Your sight: ' + p.click + ' ' + p.clickUnit +
      '. * ' + (p.clickUnit === 'MRAD' ? 'MOA row assumes 0.25 MOA clicks.' : 'MRAD row assumes 0.1 MRAD clicks.');

    var small = p.imperial ? function (m) { return fixed(m / U.inch, 1) + ' in'; } : function (m) { return fixed(m * 100, 1) + ' cm'; };
    var vel = p.imperial ? Math.round(p.v / U.fps) + ' ft/s' : Math.round(p.v) + ' m/s';
    var en = isNaN(p.e) ? '' : (p.imperial ? Math.round(p.e * 0.737562) + ' ft-lbf' : Math.round(p.e) + ' J');
    var parts = [];
    parts.push('For ' + esc(p.rifleName) + ' with ' + esc(p.ammoName) + ' at ' + p.range + ' ' + unitLabel(p.rangeUnit) + ':');
    if (Math.abs(p.impact) >= 0.0005) parts.push('without adjustment the shot lands ' + small(Math.abs(p.impact)) + (p.impact > 0 ? ' high' : ' low') + '.');
    else parts.push('no elevation change is needed.');
    parts.push('Velocity at target ' + vel + (en ? ', energy ' + en : '') + ', time of flight ' + p.t.toFixed(3) + ' s.');
    if (p.mode === 'wind') {
      parts.push('Wind drift ' + small(Math.abs(p.windDrift)) + (Math.abs(p.windDrift) >= 0.0005 ? (p.windDrift > 0 ? ' right' : ' left') : '') +
        '; estimated spin drift change from zero ' + small(Math.abs(p.spin)) + (Math.abs(p.spin) >= 0.0005 ? (p.spin > 0 ? ' right' : ' left') : '') + '.');
    }
    $('cInfo').innerHTML = parts.join(' ');
    var warn = [];
    if (p.transonic) warn.push('The bullet slows through the speed of sound before the target - expect larger dispersion and less reliable predictions.');
    if (p.longRange) warn.push('Beyond 500 m the result is an estimate only: no weather, Coriolis or aerodynamic jump corrections are applied.');
    $('cWarn').textContent = warn.join(' ');
    $('cResult').classList.remove('hidden');
  }

  // ================================================================ DATABASE
  $('dbTabAmmo').onclick = function () { dbTab = 'ammo'; renderDb(); };
  $('dbTabRifle').onclick = function () { dbTab = 'rifle'; renderDb(); };

  function renderDb() {
    $('dbTabAmmo').classList.toggle('active', dbTab === 'ammo');
    $('dbTabRifle').classList.toggle('active', dbTab === 'rifle');
    var html = '', rows;
    var act = function (id) {
      return '<td class="act"><button type="button" class="link" data-act="edit" data-id="' + id + '">Edit</button>' +
        '<button type="button" class="link" data-act="copy" data-id="' + id + '">Copy</button>' +
        '<button type="button" class="link del" data-act="del" data-id="' + id + '">Del</button></td>';
    };
    if (dbTab === 'ammo') {
      html = '<thead><tr><th class="l">Name</th><th>Bullet<br>weight</th><th class="l">Unit</th><th>Muzzle<br>velocity</th><th class="l">Unit</th><th>Coeff</th><th class="l">Drag</th><th class="act">Action</th></tr></thead><tbody>';
      rows = db.ammo.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      rows.forEach(function (a) {
        html += '<tr><td class="l name">' + esc(a.name) + '</td><td>' + a.weight + '</td><td class="l">' + unitLabel(a.weightUnit) + '</td><td>' + a.mv +
          '</td><td class="l">' + unitLabel(a.mvUnit) + '</td><td>' + a.bc.toFixed(3) + '</td><td class="l">' + a.drag + '</td>' + act(a.id) + '</tr>';
      });
    } else {
      html = '<thead><tr><th class="l">Name</th><th>Sight<br>adj</th><th class="l">Inc</th><th>Sight<br>height</th><th class="l">Unit</th><th>Zero</th><th class="l">Unit</th><th>Twist</th><th class="l">Direction</th><th class="l">Ammo</th><th class="act">Action</th></tr></thead><tbody>';
      rows = db.rifles.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      rows.forEach(function (r) {
        var am = r.ammoId ? byId(db.ammo, r.ammoId) : null;
        html += '<tr><td class="l name">' + esc(r.name) + '</td><td>' + r.click + '</td><td class="l">' + r.clickUnit + '</td><td>' + r.sight + '</td><td class="l">' +
          (r.sightUnit === 'inch' ? 'inches' : 'cm') + '</td><td>' + r.zero + '</td><td class="l">' + (r.zeroUnit === 'yard' ? 'Yards' : 'Metres') + '</td><td>' + r.twist +
          '</td><td class="l">' + (r.twistDir === 'L' ? 'Left' : 'Right') + '</td><td class="l">' + (am ? esc(am.name) : '<span class="muted">none</span>') + '</td>' + act(r.id) + '</tr>';
      });
    }
    if (!rows.length) html += '<tr><td class="l muted" colspan="12">No ' + (dbTab === 'ammo' ? 'ammo' : 'rifles') + ' saved yet.</td></tr>';
    // A few blank ruled rows give the spreadsheet look.
    for (var i = rows.length; i < 8; i++) html += '<tr class="blank"><td colspan="12">&nbsp;</td></tr>';
    $('dbTable').innerHTML = html + '</tbody>';
  }

  $('dbTable').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
    if (dbTab === 'ammo') {
      var a = byId(db.ammo, id); if (!a) return;
      if (act === 'del') {
        var users = db.rifles.filter(function (r) { return r.ammoId === id; }).map(function (r) { return r.name; });
        confirmBox('Delete ammo?', 'Delete "' + a.name + '"? This cannot be undone.' + (users.length ? ' It is linked to: ' + users.join(', ') + ' - they will have no ammo selected.' : ''), 'Delete', function () {
          db.ammo = db.ammo.filter(function (x) { return x.id !== id; });
          db.rifles.forEach(function (r) { if (r.ammoId === id) r.ammoId = null; });
          if (cState.ammoId === id) { cState.ammoId = null; cState.result = null; db.state.compute = cState; }
          persist(); renderDb(); toast('Deleted "' + a.name + '".');
        });
        return;
      }
      go('ammo'); loadAmmoIntoForm(a, act);
    } else {
      var r = byId(db.rifles, id); if (!r) return;
      if (act === 'del') {
        confirmBox('Delete rifle?', 'Delete "' + r.name + '"? This cannot be undone.', 'Delete', function () {
          db.rifles = db.rifles.filter(function (x) { return x.id !== id; });
          if (cState.rifleId === id) { cState.rifleId = null; cState.result = null; db.state.compute = cState; }
          persist(); renderDb(); toast('Deleted "' + r.name + '".');
        });
        return;
      }
      go('rifle'); loadRifleIntoForm(r, act);
    }
  });

  $('dbDeleteAll').onclick = function () {
    confirmBox('Delete everything?', 'This permanently deletes ALL ammo and ALL rifles, and clears the compute screen. This cannot be undone.', 'Delete all', function () {
      db.ammo = []; db.rifles = []; cState = {}; db.state.compute = null;
      persist(); toast('Database cleared.');
      history = []; go('ammo', true);
    });
  };
  $('dbExit').onclick = exitApp;

  // ================================================================ WELCOME + start-up
  $('welcomeNext').onclick = function () { go('ammo'); };
  $('welcomeExit').onclick = exitApp;
  $('version').textContent = 'v' + VERSION;

  resetAmmoForm();
  resetRifleForm();
  if (loaded.corrupt) toast('The database file could not be read and has been reset. A backup copy was kept.', true);
  if (!db.state.welcomeDone) go('welcome', true);
  else if (db.ammo.length === 0) go('ammo', true);
  else if (db.rifles.length === 0) go('rifle', true);
  else go('compute', true);
})();
