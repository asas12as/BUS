import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const f = 'phone/nvu-bus.html'
const out = readFileSync(f, 'utf8')
let pass = 0
let fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log(`PASS  ${l}`) } else { fail++; console.log(`FAIL  ${l} ${e}`) } }

/**
 * The document holds more than one inline script: the app bundle plus the tiny
 * theme bootstrap that runs before it to avoid a flash of the wrong palette.
 * Pick the largest payload rather than the first, so adding a bootstrap script
 * cannot silently make this file verify the wrong thing.
 */
const scripts = [...out.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const appScript = scripts.reduce((a, b) => (b.length > a.length ? b : a), '')
const bootstrap = scripts.filter((s) => s !== appScript)

console.log('--- self contained ---')
const shell = out.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>').replace(/<style>[\s\S]*?<\/style>/g, '<style></style>')
const attrs = [...shell.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1])
ok(attrs.every((a) => a.startsWith('data:') || a === '#'), 'no external src/href in the document shell', JSON.stringify(attrs.filter((a) => !a.startsWith('data:'))))
ok(attrs.length === 1 && attrs[0].startsWith('data:image/svg+xml'), 'only the inlined favicon remains', JSON.stringify(attrs))
ok(!/type="module"/.test(out), 'no module script tag (Android blocks it on file://)')
ok(appScript.length >= 100000, 'js is inlined in a classic script tag', String(appScript.length))
ok(scripts.length >= 1, 'there is an inline script', String(scripts.length))
// The theme bootstrap must run before the app, or the saved palette is applied
// after first paint and the user sees a flash.
const bootstrapFirst = out.indexOf('projectbus.theme') < out.indexOf('createPortal')
ok(bootstrapFirst, 'the theme bootstrap runs before the app bundle')
ok(/<style>[\s\S]{10000,}<\/style>/.test(out), 'css is inlined in a style tag')
ok(!/<link[^>]+rel="stylesheet"/.test(out), 'no external stylesheet link')
ok(!/\bsrc\s*=\s*["']\.\//.test(out), 'no relative file references')

console.log('--- nothing reaches the network at runtime ---')
for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /@import/, /navigator\.geolocation/]) {
  ok(!re.test(out), `no ${re.source}`)
}
const abs = [...out.matchAll(/(?:src|href)="(?:https?:)?\/\/[^"]*"/g)]
ok(abs.length === 0, 'no absolute http(s) subresources', String(abs.length))

console.log('--- payloads were not corrupted by the $ substitution bug ---')
const script = appScript
const css = /<style>([\s\S]*?)<\/style>/.exec(out)[1]
ok(!script.includes('<div id="root">'), 'html head was not spliced into the js payload')
ok(!script.includes('rel="icon"'), 'favicon link was not duplicated into the js payload')
ok((script.match(/<\/script/gi) ?? []).length === 0, 'payload cannot close its own script tag', String((script.match(/<\/script/gi) ?? []).length))
// Every inline script must be balanced: the number of closing tags has to match
// the number of opening ones, or the document is truncated at parse time.
// Counted on the shell, not the raw document, because the bundle's own source
// contains the literal string "<script" in a template or regex.
const opens = (shell.match(/<script\b/gi) ?? []).length
const closes = (shell.match(/<\/script>/gi) ?? []).length
ok(opens === closes, 'script tags are balanced', `${opens} open, ${closes} close`)
ok(scripts.length === closes, 'every closing tag pairs with a real payload', `${scripts.length} payloads, ${closes} closes`)
ok((out.match(/<\/style>/gi) ?? []).length === 1, 'document has exactly one closing style tag', String((out.match(/<\/style>/gi) ?? []).length))
ok(!/<script[^>]*\ssrc=/.test(out), 'no script tag has a src attribute')
ok((out.match(/favicon\.svg/g) ?? []).length === 0, 'favicon.svg is never referenced as a file')
ok(css.includes('--brand'), 'css payload looks intact')
ok(script.includes('createPortal'), 'expected app code is present in the payload')
ok(
  script.includes('projectbus.data.v1'),
  'storage key present and unchanged, so saved data is not orphaned'
)
ok(script.includes('projectbus.theme'), 'theme key present and unchanged')
ok(script.includes('initialsOf') || script.includes('avatar--letter'), 'the avatar feature is in this build')
// The subscription window must survive into the standalone build, otherwise
// the phone copy would let anyone subscribe whenever it happened to open.
ok(script.includes('windowClosed'), 'the subscription window feature is in this build')
// The prices are quoted to riders, so the figures and their labels have to be
// in the standalone copy or the phone build would quote the wrong amount.
ok(script.includes('extraDayPrice'), 'the price breakdown is in this build')
ok(/160/.test(script) && /40/.test(script), 'the 160 and 40 EGP figures are in the payload')
// Tapping subscribe from any week must land on the open week. Assert on the
// translation key rather than the resolver's name, because minification
// renames the function but keeps the string literal a rider would see.
ok(script.includes('openWeekIs'), 'the "open for the week of" copy is in this build')
// The QR pass is the rider's ticket, so the payload marker and the field labels
// must survive into the standalone copy or the phone build shows a code that
// no longer identifies itself. Assert on string literals, not on function or
// variable names, since minification renames those.
ok(script.includes('NVU-BUS'), 'the QR payload marker is in the payload')
// The pre-rename spelling has to survive too, or a pass printed before the
// rename stops scanning on this build. Its presence in the bundle is what keeps
// that decode path alive.
ok(
  script.includes('ProjectBus'),
  'the pre-rename QR marker is still accepted, so older printed passes scan'
)
// The brand itself. The title lives in the document head, so it is checked
// against the whole file rather than the extracted script, where it can never
// appear.
ok(/<title>NVU-BUS - Bus subscription organizer<\/title>/.test(out), 'the document title is renamed')
// The labels are concatenated with their separators at runtime, so only the
// words themselves survive minification.
ok(script.includes('Payment') && script.includes('Pickup'), 'the QR field labels are in this build')
ok(script.includes('Not subscribed'), 'the QR payment wording is in this build')
ok(script.includes('myQr'), 'the QR button label is in this build')
ok(script.includes('weeklyId'), 'the QR detail rows are in this build')

// Weekly numbers run 1-1000 and then lettered (1A, 1B, ...). Both halves live in
// the scanner and the ticket, and the lettered form is the one that breaks: a
// digits-only assumption anywhere in that path shows a pass as "no match" while
// still looking correct here. The regex literals survive minification, so they
// are what the check can actually see.
ok(
  script.includes('[A-Z]{1,2}'),
  'the weekly number parser accepts a lettered form'
)
// The bundle carries plenty of unrelated 999s (XML namespaces, the PNG encoder
// palette limit), so the ceiling is checked in the source that sets it.
const storageSrc = readFileSync('src/lib/weeklyNumber.ts', 'utf8')
ok(
  /MAX_WEEKLY_NUMBER\s*=\s*PLAIN_MAX\s*\+\s*MAX_BLOCKS\s*\*\s*PER_BLOCK/.test(storageSrc) &&
    !/=\s*999\b/.test(storageSrc),
  'the weekly number ceiling is derived from the scheme, not hardcoded to 999'
)
ok(!/inputMode="numeric"/.test(script), 'the manual number box is not digits-only')
// The code is drawn as one merged svg path; without it the panel would render
// an empty box on the phone build.
ok(script.includes('crispEdges'), 'the QR svg path renderer is in this build')

// The saved-ticket image and the scanner are the two newest features, and both
// are easy to lose from the standalone copy without any build error: the ticket
// is pure string building and the scanner is a route behind an admin guard. A
// rider on the phone build would find a dead button and no way to spot it here.
ok(
  script.includes('http://www.w3.org/2000/svg') && script.includes('aria-label'),
  'the saved-ticket image builder is in this build'
)
// The ticket carries its own font stack; without it the saved image silently
// falls back to the renderer's default face instead of the app's.
ok(script.includes('Segoe UI'), 'the saved ticket asks for the app font')
ok(script.includes('toBlob'), 'the save-as-image path is in this build')
ok(script.includes('getUserMedia'), 'the camera scanner is in this build')
ok(
  script.includes('canShare') || script.includes('navigator.share') || script.includes('share'),
  'the save/share action is in this build'
)
// The header shows an admin-only link to the panel. It is the one route reached
// from the chrome rather than the footer nav, so nothing else here would catch
// it going missing from the phone build.
ok(script.includes('/admin'), 'the admin panel route is in this build')
ok(
  script.includes('Admin panel'),
  'the header admin button is labelled, so it is not an unlabelled icon'
)
// Minification strips the literal 16:30, so assert on the copy a reader sees:
// both languages' window labels have to survive, or the phone build shows an
// English-only or Arabic-only explanation.
for (const label of ['Wednesday 4:30 PM', 'الأربعاء']) {
  ok(script.includes(label), `window copy is present: ${label}`)
}
// The bootstrap must be defensive: if localStorage throws, the page must still
// render rather than dying before React mounts.
ok(
  bootstrap.every((b) => !b.trim() || /try|catch/.test(b)),
  'theme bootstrap guards its storage access',
  JSON.stringify(bootstrap.map((b) => b.slice(0, 40)))
)

console.log('--- the inlined js is syntactically valid on its own ---')
ok(script.startsWith('(function'), 'bundle is an IIFE, safe as a classic script', script.slice(0, 40))
// Syntax-check the extracted bundle without leaving a file in the project root.
const tmp = join(mkdtempSync(join(tmpdir(), 'pb-')), 'app.js')
writeFileSync(tmp, script)
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
  ok(true, 'node --check accepts the extracted bundle')
} catch (e) {
  ok(false, 'node --check accepts the extracted bundle', String(e.stderr ?? e))
} finally {
  unlinkSync(tmp)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
