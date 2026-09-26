"""Reference numbers for tests/ballistics.test.js.
Requires: pip install py-ballisticcalc==2.3.1   (LGPL-3.0, used only as an external check)
Usage:    python3 tools/compare_pyballisticcalc.py
"""
import json, os
from py_ballisticcalc import *
from py_ballisticcalc.drag_tables import *
cases = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'compare_cases.json')))
tabs = {'G1':TableG1,'G7':TableG7,'RA4':TableRA4,'G5':TableG5}
out=[]
for c in cases:
    dm = DragModel(c['bc'], tabs[c['drag']])
    ammo = Ammo(dm, Velocity.MPS(c['v0']))
    atmo = Atmo.icao()
    weapon = Weapon(sight_height=Distance.Meter(c['h']))
    calc = Calculator()
    thz = calc.set_weapon_zero(Shot(weapon=weapon, ammo=ammo, atmo=atmo), Distance.Meter(c['rz'])) >> Unit.Radian
    res={}
    for R in c['ranges']:
        th = calc.barrel_elevation_for_target(Shot(weapon=weapon, ammo=ammo, atmo=atmo), Distance.Meter(R)) >> Unit.Radian
        wshot = Shot(weapon=weapon, ammo=ammo, atmo=atmo, winds=[Wind(Velocity.MPS(c['wind']), Angular.OClock(9))])
        wshot.weapon.zero_elevation = Angular.Radian(th)
        tr = calc.fire(wshot, Distance.Meter(R), Distance.Meter(R))
        p = tr.get_at('distance', Distance.Meter(R))
        res[R]={'dmrad':(th-thz)*1000, 'drift_cm': (p.windage>>Unit.Centimeter), 'v': p.velocity>>Unit.MPS, 't':p.time}
    out.append(res)
print(json.dumps(out, indent=0))
