# Ballisto – a basic ballistic computer for target shooting (Android 10+)

Ballisto tells you how many clicks to move your sight when you change range
from the distance the rifle is zeroed at, and estimates the windage correction
either from where the last shot missed or from a crosswind speed.

- Android 10 (API 29) and later, including GrapheneOS and LineageOS.
- Completely offline: the APK requests **no permissions at all** (no INTERNET,
  no sensors, no storage), so it cannot connect outside the device.
- Free, no ads, no Google libraries, no third-party code: only the Android
  framework and the Kotlin standard library (Apache-2.0).
- Designed for 10–100 m smallbore; solves to 3000 m (with falling accuracy
  beyond ~500 m – see `ALGORITHMS.md`).

The ballistic algorithms and the source of every drag table are documented in
**[ALGORITHMS.md](ALGORITHMS.md)**.

## Project layout

```
web/                  the whole app: HTML/CSS/JS (shared with a future iOS build)
  index.html          screens: Welcome, Ammo, Rifle, Compute, Edit Database
  style.css           TweetDelete palette, light/dark follows the phone setting
  app.js              screen logic, validation, database handling
  ballistics.js       the solver (pure JS, no dependencies)
  dragtables.js       G1 G2 G5 G6 G7 G8 GI GL RA4 tables (generated)
  storage.js          file-storage bridge (Android / iOS / browser)
app/                  Android shell (Kotlin, one Activity + WebView)
tests/ballistics.test.js   solver checks against py-ballisticcalc (node)
tools/                drag-table generator, raw source tables, comparison script
ios/README-iOS.md     how to wrap web/ for iOS later
keystore/             signing key used for the supplied APK (see below)
```

`app/build.gradle.kts` packages `web/` directly as the APK's assets, so there
is one copy of the UI and solver.

## Building

Same toolchain as TweetDelete: JDK 17, Android SDK platform 34, Gradle 8.7
(wrapper included), AGP 8.5.2, Kotlin 1.9.24.

```bash
./gradlew :app:assembleRelease
# -> app/build/outputs/apk/release/app-release.apk  (~65 KB)
```

If the project sits on a `noexec` mount (e.g. the NAS), run it as
`bash ./gradlew :app:assembleRelease` or build from a local copy.

Signing: the release build is signed with `keystore/ballisto-release.keystore`
(alias `ballisto`, store/key password `ballisto`, overridable with the
`BALLISTO_KEYSTORE_PASSWORD` / `BALLISTO_KEY_PASSWORD` environment variables).
Keep this file: Android only lets you install an update over an existing copy
if it is signed with the same key. It is listed in `.gitignore` so it will not
go to a public repository by accident. For F-Droid, their build server signs
with its own key.

Solver tests (needs only Node.js):

```bash
node tests/ballistics.test.js
```

To see the UI on a desktop, open `web/index.html` in a browser (it then stores
the database in the browser's localStorage instead of a file).

## Installing the APK

Copy `Ballisto-1.0.0.apk` to the phone and open it, allowing "Install unknown
apps" for the file manager when prompted, or `adb install Ballisto-1.0.0.apk`.

## Using it

1. **Welcome** – read and tap Next. Exiting here leaves no trace.
2. **Ammo** – name, bullet weight, muzzle velocity are required. BC (default
   0.112) and drag model (default RA4) can be left; you are told when defaults
   are saved. Grey text = default or example.
3. **Rifle** – name, click value (default 0.1 MRAD / 0.25 MOA), sight height
   and zero range are required; twist rate and direction default to 16 / right.
4. **Compute** – pick rifle and ammo, enter the range you want (shown red while
   it is still the zero range), choose Miss correction or Crosswind, and tap
   Compute. The last inputs and result are kept. The rifle remembers the ammo
   last used with it.
5. **Edit Database** – spreadsheet view of ammo or rifles; Edit (overwrites,
   name shown with a grey EDIT: prefix), Copy (new record from a template, name
   prefixed COPY:), Del, and Delete All, all with warnings.

The database is one plain-text JSON file, `ballisto_db.json`, in the app's
private storage (a `.bak` of the previous version is kept on every save). It
is included in Android backup / device transfer.

## Known limitations (honest list)

- No weather input: ICAO standard sea-level atmosphere (15 °C, 1013 hPa).
- No Coriolis, aerodynamic jump, slope angle or head/tail wind.
- Spin drift is a rough estimate (nominal stability Sg = 1.5), applied in
  Crosswind mode only; twist *rate* is stored but does not affect it, because
  the bullet length and calibre needed for a real stability figure are not
  collected.
- GL drag table is derived from Lowry's 1965 retardation data (see
  ALGORITHMS.md §3).
- Bullet weight only affects the energy figure; with a G-model BC the path does
  not depend on it.
- Not yet tested on a physical device by the author of this build – please
  report anything that looks wrong on your phone's WebView version.

## Licence

MIT (see `LICENSE`). Drag-function data are published reference data from the
US Army BRL / E. D. Lowry via JBM Ballistics, credited in ALGORITHMS.md.
