// Regression test for the security posture: both BrowserWindow configs must
// run with sandbox: true, and the preloads must only require modules that
// remain available inside a sandboxed renderer (electron, events, timers,
// url). These are static-source checks — running them in CI catches a
// regression that would otherwise only surface when packaging the app.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const MAIN_JS = path.join(REPO_ROOT, 'src', 'main.js');
const PRELOAD_MAIN = path.join(REPO_ROOT, 'src', 'preload.js');
const PRELOAD_TRAY = path.join(REPO_ROOT, 'src', 'tray-preload.js');

test('main imports normalizeSchedule before compare persistence uses it', () => {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  const jobModelImport = source.match(/const\s*\{([\s\S]*?)\}\s*=\s*require\('\.\/main\/job-model'\)/);
  assert.ok(jobModelImport, 'job-model destructuring import should exist');
  assert.match(jobModelImport[1], /\bnormalizeSchedule\b/);
});

test('main.js disables sandbox: false in every BrowserWindow webPreferences block', () => {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  // Allow only sandbox: true inside webPreferences blocks. We do a structural
  // scan so the test stays valid even if more windows are added later.
  const matches = source.match(/sandbox:\s*(true|false)/g) || [];
  assert.ok(matches.length > 0, 'expected at least one sandbox declaration');
  for (const m of matches) {
    assert.equal(m, 'sandbox: true', `sandbox flag regression: ${m}`);
  }
});

test('preload scripts only require modules available in sandboxed renderers', () => {
  // In sandbox: true mode, the preload can only `require('electron')` and
  // a small set of Node built-ins (events, timers, url). Anything else
  // (fs, path, child_process, etc.) throws at load time.
  const allowed = new Set(['electron', 'events', 'timers', 'url']);
  for (const file of [PRELOAD_MAIN, PRELOAD_TRAY]) {
    const source = fs.readFileSync(file, 'utf8');
    const required = Array.from(source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)).map((m) => m[1]);
    for (const mod of required) {
      assert.ok(allowed.has(mod), `${path.basename(file)} requires "${mod}" which is not available in a sandboxed renderer`);
    }
  }
});

test('preload scripts do not enable nodeIntegration or disable contextIsolation', () => {
  for (const file of [PRELOAD_MAIN, PRELOAD_TRAY]) {
    const source = fs.readFileSync(file, 'utf8');
    // These would be wrong if introduced — the renderer should always be
    // isolated and node-free.
    assert.equal(/\bnodeIntegration:\s*true\b/.test(source), false, `${path.basename(file)} must not enable nodeIntegration`);
    assert.equal(/\bcontextIsolation:\s*false\b/.test(source), false, `${path.basename(file)} must not disable contextIsolation`);
  }
});

test('main HTML has no inline style attributes (CSP style-src cleanup)', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  // Strip HTML comments first — those can legitimately mention `style="..."`
  // in their prose without it being an attribute on an element.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const lines = stripped.split(/\r?\n/);
  for (const line of lines) {
    if (/\bstyle\s*=/.test(line)) {
      assert.fail(`inline style attribute found in index.html: ${line.trim()}`);
    }
  }
});

test('CSP style-src drops unsafe-inline on both renderer windows', () => {
  // Regression test for the CSP cleanup: with the run and tray progress bars
  // converted to SVG <rect>, no inline-style writes remain in the renderer, so
  // we can ship style-src 'self' instead of style-src 'self' 'unsafe-inline'.
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const trayHtml = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'tray.html'), 'utf8');

  for (const [name, html] of [['index.html', indexHtml], ['tray.html', trayHtml]]) {
    const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]+)"/);
    assert.ok(cspMatch, `${name} should declare a Content-Security-Policy meta tag`);
    const csp = cspMatch[1];
    const styleSrcMatch = csp.match(/style-src\s+([^;]+)/);
    assert.ok(styleSrcMatch, `${name} CSP should contain a style-src directive`);
    const styleSrc = styleSrcMatch[1].trim();
    assert.equal(
      styleSrc.includes("'unsafe-inline'"),
      false,
      `${name} style-src must not include 'unsafe-inline' — found: ${styleSrc}`
    );
    // Sanity check: 'self' is still required so stylesheet loads keep working.
    assert.ok(
      styleSrc.includes("'self'"),
      `${name} style-src should still allow 'self' so stylesheet loads keep working`
    );
  }
});

test('progress fills in both renderer windows are SVG <rect> (CSP-friendly)', () => {
  // The run overlay and the tray window both expose a fill element driven by
  // JS width updates. After the CSP cleanup those fills must be SVG <rect>
  // elements so JS can drive the width with setAttribute('width', ...), which
  // is an SVG presentation attribute write (allowed by style-src 'self'),
  // not an inline style assignment (which would force 'unsafe-inline').
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const trayHtml = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'tray.html'), 'utf8');

  // index.html: #runFill must be the SVG element wrapping a <rect id="runFillBar">.
  assert.match(
    indexHtml,
    /<svg[^>]*\bid="runFill"[\s\S]*?<rect[^>]*\bid="runFillBar"/,
    'index.html must define #runFill as an <svg> containing a <rect id="runFillBar">'
  );

  // tray.html: #progressFill must be the SVG element wrapping a <rect id="progressFillBar">.
  assert.match(
    trayHtml,
    /<svg[^>]*\bid="progressFill"[\s\S]*?<rect[^>]*\bid="progressFillBar"/,
    'tray.html must define #progressFill as an <svg> containing a <rect id="progressFillBar">'
  );
});

test('renderer JS does not write style.width on the progress fill elements', () => {
  // Width updates must go through setAttribute('width', ...) on the <rect>
  // bar element. Any stray `style.width =` write on the fill elements would
  // resurrect the inline-style requirement and force 'unsafe-inline' back in.
  const appJs = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  const trayJs = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'tray.js'), 'utf8');

  // Scan only the progress-fill writes — other code paths may legitimately
  // set inline styles elsewhere (we are scoped to the CSP cleanup surface).
  const banned = [
    /runFill\.style\.width\s*=/,
    /runFillBar\.style\.width\s*=/,
    /progressFill\.style\.width\s*=/,
    /progressFillBar\.style\.width\s*=/,
  ];
  for (const pattern of banned) {
    assert.equal(pattern.test(appJs), false, `app.js must not write style.width via ${pattern}`);
    assert.equal(pattern.test(trayJs), false, `tray.js must not write style.width via ${pattern}`);
  }
});

test('main renderer updates SVG progress classes through attributes', () => {
  const appJs = fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'app.js'), 'utf8');

  assert.equal(
    /runFill\.className\s*=/.test(appJs),
    false,
    'SVG #runFill must use setAttribute for class updates so indeterminate animation can be removed'
  );
  assert.match(
    appJs,
    /runFill\.setAttribute\(['"]class['"],/,
    'app.js should update the SVG progress class with setAttribute'
  );
});
