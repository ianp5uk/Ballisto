/*
 * Ballisto - ballistic solver (pure JavaScript, no dependencies).
 *
 * Point-mass (3-degree-of-freedom) trajectory model as described in
 * R. L. McCoy, "Modern Exterior Ballistics", Schiffer, 1999 (ch. 5), using
 * standard G-function drag tables and a ballistic coefficient (BC).
 * Full references are in ALGORITHMS.md at the project root.
 *
 * All internal values are SI: metres, seconds, kilograms, radians.
 * The same file runs in the Android WebView, a desktop browser, an iOS
 * WKWebView and in Node (for the unit tests).
 */
(function (root) {
  'use strict';

  var Tables = root.BallistoDragTables ||
    (typeof require !== 'undefined' ? require('./dragtables.js') : null);

  // ---- Constants -----------------------------------------------------------
  var G = 9.80665;                 // standard gravity, m/s^2
  var RHO = 1.2250;                // ICAO sea-level air density, kg/m^3 (15 C, 1013.25 hPa)
  var SOUND = 340.294;             // ICAO sea-level speed of sound, m/s
  var T0 = 288.15, LAPSE = 0.0065; // ICAO sea-level temperature (K) and lapse rate (K/m)
  var LB_IN2_TO_KG_M2 = 703.0695796; // BC unit conversion (lb/in^2 -> kg/m^2)
  var MOA_PER_RAD = 180 / Math.PI * 60; // true minutes of angle per radian
  var LITZ_SG_NOMINAL = 1.5;       // nominal gyroscopic stability for spin-drift estimate

  var U = {
    grain: 6.479891e-5, gram: 1e-3,            // -> kg
    fps: 0.3048, mps: 1, mph: 0.44704,         // -> m/s
    inch: 0.0254, cm: 0.01, yard: 0.9144, m: 1 // -> m
  };

  // ---- Drag -----------------------------------------------------------------
  // Linear interpolation of CD vs Mach, clamped to the ends of the table.
  function makeCd(model) {
    var t = Tables[model];
    if (!t) throw new Error('Unknown drag model ' + model);
    var n = t.length / 2, mach = new Float64Array(n), cd = new Float64Array(n);
    for (var i = 0; i < n; i++) { mach[i] = t[2 * i]; cd[i] = t[2 * i + 1]; }
    return function (m) {
      if (m <= mach[0]) return cd[0];
      if (m >= mach[n - 1]) return cd[n - 1];
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (mach[mid] > m) hi = mid; else lo = mid; }
      var f = (m - mach[lo]) / (mach[hi] - mach[lo]);
      return cd[lo] + f * (cd[hi] - cd[lo]);
    };
  }

  /*
   * Integrate one trajectory with classical 4th-order Runge-Kutta.
   *   Axes: x downrange, y up, z to the shooter's right. Origin at the bore.
   *   Line of sight is level, at height h above the bore.
   *   Drag deceleration (McCoy eq. 5.x, G-function form):
   *        a = - (rho * pi / (8 * BC)) * CD_G(M) * |v_r| * v_r
   *   where v_r is velocity relative to the air (crosswind subtracted) and BC
   *   is in kg/m^2. This follows from a = rho v^2 CD A / (2m) with
   *   BC = m / (d^2 i) and CD = i * CD_G.
   * Returns the state interpolated at x = X, or null if the bullet never gets
   * there (stalls, or exceeds the time limit).
   */
  function fly(p, theta, X, wind) {
    var k = RHO * Math.PI / (8 * p.bcSI), cdf = p.cdf;
    var x = 0, y = 0, z = 0, t = 0;
    var vx = p.v0 * Math.cos(theta), vy = p.v0 * Math.sin(theta), vz = 0;
    var dt = Math.min(0.002, Math.max(2e-5, X / p.v0 / 400));
    var tMax = 120, minMachSeen = p.v0 / SOUND;

    // Air density and speed of sound follow the ICAO standard atmosphere
    // with height above the muzzle (only matters for long, high-angle shots).
    var atmY = 0, kY = k, cY = SOUND;
    function atmosphere(yy) {
      if (Math.abs(yy - atmY) < 1) return;
      atmY = yy;
      var T = T0 - LAPSE * yy;
      kY = k * Math.pow(T / T0, 4.2559); // rho/rho0 for the troposphere
      cY = SOUND * Math.sqrt(T / T0);
    }
    function acc(vx, vy, vz, out) {
      var rx = vx, ry = vy, rz = vz - wind;
      var v = Math.sqrt(rx * rx + ry * ry + rz * rz);
      var a = kY * cdf(v / cY) * v;
      out[0] = -a * rx; out[1] = -a * ry - G; out[2] = -a * rz;
    }
    var a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];

    while (t < tMax) {
      if (vx <= 0.5) return null;
      atmosphere(y);
      acc(vx, vy, vz, a1);
      var h2 = dt / 2;
      acc(vx + h2 * a1[0], vy + h2 * a1[1], vz + h2 * a1[2], a2);
      acc(vx + h2 * a2[0], vy + h2 * a2[1], vz + h2 * a2[2], a3);
      acc(vx + dt * a3[0], vy + dt * a3[1], vz + dt * a3[2], a4);
      var nx = x + dt * (vx + dt / 6 * (a1[0] + a2[0] + a3[0]));
      var ny = y + dt * (vy + dt / 6 * (a1[1] + a2[1] + a3[1]));
      var nz = z + dt * (vz + dt / 6 * (a1[2] + a2[2] + a3[2]));
      var nvx = vx + dt / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
      var nvy = vy + dt / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
      var nvz = vz + dt / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
      if (nx >= X) {
        var f = (X - x) / (nx - x);
        var ivx = vx + f * (nvx - vx), ivy = vy + f * (nvy - vy), ivz = vz + f * (nvz - vz);
        var vv = Math.sqrt(ivx * ivx + ivy * ivy + ivz * ivz);
        return {
          y: y + f * (ny - y), z: z + f * (nz - z), t: t + f * dt,
          v: vv, minMach: Math.min(minMachSeen, vv / SOUND)
        };
      }
      x = nx; y = ny; z = nz; vx = nvx; vy = nvy; vz = nvz; t += dt;
      var sp = Math.sqrt(vx * vx + vy * vy + vz * vz) / cY;
      if (sp < minMachSeen) minMachSeen = sp;
    }
    return null;
  }

  // Height of the bullet above the line of sight at range X for bore angle theta.
  function heightAboveLos(p, theta, X) {
    var r = fly(p, theta, X, 0);
    return r ? r.y - p.h : -Infinity;
  }

  /*
   * Bore elevation (radians, relative to the level line of sight) that puts
   * the bullet on the line of sight at range X. Brackets the root on a
   * geometric grid of angles (so very long, high-angle shots are handled
   * correctly), then refines by bisection. Returns NaN if no angle reaches.
   */
  function zeroAngle(p, X) {
    var prevT = 0, prevF = heightAboveLos(p, 0, X);
    if (prevF >= 0) return 0; // cannot happen with h > 0, kept for safety
    var grid = [], th = 0.0005;
    while (th < 0.8) { grid.push(th); th *= 2; }
    grid.push(0.8);
    var fs = [], lo = NaN, hi = NaN;
    for (var i = 0; i < grid.length; i++) {
      var f = heightAboveLos(p, grid[i], X);
      fs.push(f);
      if (f >= 0) { lo = i === 0 ? prevT : grid[i - 1]; hi = grid[i]; break; }
    }
    if (isNaN(hi)) {
      // No grid point reached: look for an interior maximum by golden section.
      var best = 0;
      for (var j = 1; j < fs.length; j++) if (fs[j] > fs[best]) best = j;
      var a = best > 0 ? grid[best - 1] : 0, b = best < grid.length - 1 ? grid[best + 1] : 0.8;
      var gr = 0.6180339887, c = b - gr * (b - a), d = a + gr * (b - a);
      var fc = heightAboveLos(p, c, X), fd = heightAboveLos(p, d, X);
      for (var it = 0; it < 60 && fc < 0 && fd < 0; it++) {
        if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = heightAboveLos(p, c, X); }
        else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = heightAboveLos(p, d, X); }
      }
      if (fc >= 0) { hi = c; lo = a; } else if (fd >= 0) { hi = d; lo = a; } else return NaN;
    }
    for (var k = 0; k < 80; k++) {
      var m = (lo + hi) / 2;
      if (heightAboveLos(p, m, X) >= 0) hi = m; else lo = m;
      if (hi - lo < 1e-11) break;
    }
    return (lo + hi) / 2;
  }

  // Litz empirical spin-drift estimate, returns metres (+ = right-hand twist direction).
  function spinDrift(t, sg) { return 1.25 * (sg + 1.2) * Math.pow(t, 1.83) * U.inch; }

  /*
   * Main entry point.
   * input = {
   *   bc, dragModel, v0 (m/s), massKg,
   *   sightHeight (m), zeroRange (m), clickUnit 'MRAD'|'MOA', click,
   *   twist (inches per turn, 0 = none), twistDir 'R'|'L',
   *   range (m),
   *   wind: { mode: 'miss'|'wind', miss (m, + = move strike right), speed (m/s, + = blowing L->R) }
   * }
   * Returns { ok:true, ... } or { ok:false, error:'message' }.
   */
  function solve(input) {
    var err = validate(input);
    if (err) return { ok: false, error: err };
    var p = {
      v0: input.v0, h: input.sightHeight,
      bcSI: input.bc * LB_IN2_TO_KG_M2, cdf: makeCd(input.dragModel)
    };
    var Rz = input.zeroRange, R = input.range;

    var thZ = zeroAngle(p, Rz);
    if (isNaN(thZ)) return { ok: false, error: 'The bullet cannot reach the zero range (' + fmtRange(Rz) + ') with this ammunition. Check the muzzle velocity and ballistic coefficient.' };
    var thR = zeroAngle(p, R);
    if (isNaN(thR)) return { ok: false, error: 'The bullet cannot reach ' + fmtRange(R) + ' with this ammunition - the target is beyond its maximum range.' };

    var dTheta = thR - thZ; // + = raise point of impact (dial UP)
    var atZeroTraj = fly(p, thZ, R, 0);
    var atR = fly(p, thR, R, 0);
    var zR = fly(p, thZ, Rz, 0);

    // ---- Windage -----------------------------------------------------------
    var wAngle = 0, windDrift = 0, spinRel = 0, missUsed = 0;
    if (input.wind && input.wind.mode === 'miss') {
      missUsed = input.wind.miss || 0;          // + = strike must move right
      wAngle = Math.atan2(missUsed, R);
    } else if (input.wind && input.wind.mode === 'wind') {
      var w = input.wind.speed || 0;
      if (w !== 0) {
        var withWind = fly(p, thR, R, w);
        if (!withWind) return { ok: false, error: 'The bullet cannot reach the target in this wind.' };
        windDrift = withWind.z;                 // + = pushed right
      }
      if (input.twist > 0) {
        // Zeroing at Rz already absorbed the spin drift at Rz as an angle, so
        // only the difference from that angle is a correction at range R.
        var sign = input.twistDir === 'L' ? -1 : 1;
        spinRel = sign * (spinDrift(atR.t, LITZ_SG_NOMINAL) - spinDrift(zR.t, LITZ_SG_NOMINAL) * R / Rz);
      }
      wAngle = -Math.atan2(windDrift + spinRel, R); // move strike opposite to the drift
    }

    return {
      ok: true,
      elevation: angleOut(dTheta),
      windage: angleOut(wAngle),
      info: {
        range: R, zeroRange: Rz,
        impactBeforeAdjust: atZeroTraj ? atZeroTraj.y - p.h : NaN, // + = high
        velocity: atR.v, time: atR.t,
        energy: input.massKg > 0 ? 0.5 * input.massKg * atR.v * atR.v : NaN,
        windDrift: windDrift, spinDrift: spinRel, miss: missUsed,
        transonic: (p.v0 / SOUND > 1.0) && (atR.minMach < 1.0),
        subsonicStart: p.v0 / SOUND < 1.0,
        longRange: R > 500
      }
    };
  }

  function angleOut(rad) {
    return { rad: rad, mrad: rad * 1000, moa: rad * MOA_PER_RAD };
  }

  function fmtRange(m) { return Math.round(m) + ' m'; }

  function validate(i) {
    if (!(i.v0 >= 100 * U.fps && i.v0 <= 6000 * U.fps)) return 'Muzzle velocity must be between 100 and 6000 ft/s (30 - 1829 m/s).';
    if (!(i.bc > 0 && i.bc <= 2)) return 'Ballistic coefficient must be greater than 0 and no more than 2.';
    if (!Tables[i.dragModel]) return 'Unknown drag model "' + i.dragModel + '".';
    if (!(i.sightHeight > 0 && i.sightHeight <= 0.254)) return 'Sight height must be greater than 0 and no more than 10 inches (25.4 cm).';
    var minR = 10 * U.yard, maxR = 10000 * U.yard;
    if (!(i.zeroRange >= minR && i.zeroRange <= maxR)) return 'Zero range must be between 10 and 10,000 yards.';
    if (!(i.range >= minR && i.range <= maxR)) return 'Required range must be between 10 and 10,000 yards.';
    if (!(i.click > 0 && i.click <= 1)) return 'Click value must be greater than 0 and no more than 1.';
    return null;
  }

  var api = {
    solve: solve, units: U, MOA_PER_RAD: MOA_PER_RAD,
    DRAG_MODELS: ['G1', 'G2', 'G5', 'G6', 'G7', 'G8', 'GI', 'GL', 'RA4'],
    _internal: { fly: fly, zeroAngle: zeroAngle, makeCd: makeCd, spinDrift: spinDrift, LB_IN2_TO_KG_M2: LB_IN2_TO_KG_M2 }
  };
  root.Ballistics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
