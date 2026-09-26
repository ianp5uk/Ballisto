/*
 * Solver tests - run with:  node tests/ballistics.test.js   (Node 14+, no packages)
 *
 * Reference values were produced by py-ballisticcalc 2.3.1 (an independent
 * open-source point-mass solver, https://github.com/o-murphy/py-ballisticcalc)
 * using the same drag tables and ICAO atmosphere; see tools/compare_pyballisticcalc.py.
 * Ballisto is required to agree within 0.5 % (or 0.005 MRAD) out to 3000 m.
 */
'use strict';
var B = require('../web/ballistics.js');
var fails = 0, n = 0;
function check(name, got, want, tolRel, tolAbs) {
  n++;
  var ok = Math.abs(got - want) <= Math.max(Math.abs(want) * tolRel, tolAbs);
  if (!ok) { fails++; console.log('FAIL ' + name + ': got ' + got + ' want ' + want); }
}
function run(c, R, wind) {
  return B.solve({
    bc: c.bc, dragModel: c.drag, v0: c.v0, massKg: 0.00259, sightHeight: c.h, zeroRange: c.rz,
    clickUnit: 'MRAD', click: 0.1, twist: 0, twistDir: 'R', range: R, wind: { mode: 'wind', speed: wind || 0 }
  });
}

// py-ballisticcalc 2.3.1 reference: [range m, elevation change MRAD, drift cm in 4 m/s crosswind, velocity m/s, time s]
var REF = [
  { c: { bc: 0.112, drag: 'RA4', v0: 320, h: 0.05, rz: 22.86 }, rows: [
    [45.72, 0.090, 2.26, 297.0, 0.1485], [91.44, 2.086, 8.81, 277.8, 0.3078],
    [50, 0.224, 2.69, 295.1, 0.1630], [100, 2.542, 10.51, 274.4, 0.3388], [200, 8.842, 42.13, 238.3, 0.7304]] },
  { c: { bc: 0.475, drag: 'G1', v0: 850, h: 0.045, rz: 100 }, rows: [
    [200, 0.572, 7.89, 723.9, 0.2550], [300, 1.388, 18.48, 665.1, 0.3991],
    [500, 3.461, 55.97, 555.9, 0.7282], [1000, 11.997, 279.49, 352.3, 1.8753]] },
  { c: { bc: 0.300, drag: 'G7', v0: 820, h: 0.045, rz: 100 }, rows: [
    [300, 1.436, 15.13, 673.8, 0.4037], [600, 4.657, 67.10, 543.5, 0.8995], [1000, 10.996, 219.38, 390.0, 1.7681],
    [1500, 24.680, 588.92, 294.1, 3.3022], [2000, 45.676, 1077.09, 255.8, 5.1344], [3000, 108.950, 2397.54, 198.8, 9.6747]] }
];

REF.forEach(function (set) {
  set.rows.forEach(function (row) {
    var r = run(set.c, row[0], 4);
    var tag = set.c.drag + '@' + row[0] + 'm';
    if (!r.ok) { fails++; n++; console.log('FAIL ' + tag + ': ' + r.error); return; }
    check(tag + ' elevation', r.elevation.mrad, row[1], 0.005, 0.005);
    check(tag + ' drift', Math.abs(r.info.windDrift * 100), row[2], 0.005, 0.05);
    check(tag + ' velocity', r.info.velocity, row[3], 0.005, 0.2);
    check(tag + ' time', r.info.time, row[4], 0.005, 0.001);
  });
});

// Same range as zero -> no correction.
var same = run(REF[0].c, 22.86);
check('same range elevation', same.elevation.mrad, 0, 0, 1e-6);

// Unit relations: MOA = MRAD * 3.4377
var r100 = run(REF[0].c, 100);
check('MOA conversion', r100.elevation.moa, r100.elevation.mrad * 3.43774677, 1e-9, 1e-9);

// .22LR cannot reach 3000 m -> must report an error, not a number.
var far = run(REF[0].c, 3000);
n++; if (far.ok) { fails++; console.log('FAIL .22LR at 3000 m should be unreachable'); }

// Validation limits from the specification.
var bad = B.solve({ bc: 0.1, dragModel: 'G1', v0: 20, massKg: 0, sightHeight: 0.05, zeroRange: 50, clickUnit: 'MRAD', click: 0.1, twist: 0, twistDir: 'R', range: 100 });
n++; if (bad.ok) { fails++; console.log('FAIL muzzle velocity below 100 ft/s accepted'); }
var near = run(REF[0].c, 5);
n++; if (near.ok) { fails++; console.log('FAIL range below 10 yards accepted'); }

// Miss correction is purely geometric: 1 cm at 100 m = 0.1 MRAD.
var miss = B.solve({ bc: 0.112, dragModel: 'RA4', v0: 320, massKg: 0.00259, sightHeight: 0.05, zeroRange: 50, clickUnit: 'MRAD', click: 0.1, twist: 16, twistDir: 'R', range: 100, wind: { mode: 'miss', miss: 0.01 } });
check('miss 1cm@100m', miss.windage.mrad, 0.1, 1e-6, 1e-6);

// Wind L->R pushes the strike right, so the correction is LEFT (negative).
var w = run(REF[0].c, 100, 5);
n++; if (!(w.windage.mrad < 0)) { fails++; console.log('FAIL wind L->R should need a LEFT correction'); }

// Every drag model solves a typical case.
B.DRAG_MODELS.forEach(function (m) {
  var r = B.solve({ bc: 0.2, dragModel: m, v0: 800, massKg: 0.01, sightHeight: 0.04, zeroRange: 100, clickUnit: 'MOA', click: 0.25, twist: 10, twistDir: 'R', range: 300, wind: { mode: 'wind', speed: 3 } });
  n++; if (!r.ok || !(r.elevation.mrad > 0)) { fails++; console.log('FAIL drag model ' + m); }
});

console.log((n - fails) + '/' + n + ' checks passed');
process.exit(fails ? 1 : 0);
