import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist-offline')
const outDir = join(process.cwd(), 'phone')
// A fresh artifact on every build, so the filename carries the brand like any
// other user-facing file. Nothing reads this path back, so there is no stored
// data tied to the old name.
const outFile = join(outDir, 'nvu-bus.html')

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const js = readFileSync(join(dist, 'app.js'), 'utf8')
const css = readFileSync(join(dist, 'app.css'), 'utf8')
const favicon = readFileSync(join(dist, 'favicon.svg'), 'utf8')

// A literal </script> or </style> inside the payload would close the tag early.
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1')

const faviconUri = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`

// NOTE: replacement values must go through a function. Passing a string makes
// String.replace expand `$&`, `$'` and `$` + backtick, and the bundle contains
// template literals, which would splice document fragments into the payload.
let out = html
out = out.replace(
  /<script\s+type="module"\s+crossorigin\s+src="\.\/app\.js"><\/script>/,
  () => `<script>${safe(js)}</script>`
)
out = out.replace(
  /<link\s+rel="stylesheet"\s+crossorigin\s+href="\.\/app\.css">/,
  () => `<style>${safe(css)}</style>`
)
out = out.replace(
  /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\.\/favicon\.svg"\s*\/?>/,
  () => `<link rel="icon" type="image/svg+xml" href="${faviconUri}" />`
)

// Fail loudly rather than shipping a file that still needs the network.
// The attribute scan runs on the document with the inlined payloads removed,
// otherwise it matches the app's own template-literal source text.
const shell = out
  .replace(/<script>[\s\S]*?<\/script>/g, '<script></script>')
  .replace(/<style>[\s\S]*?<\/style>/g, '<style></style>')

const leftovers = [...shell.matchAll(/(?:src|href)="(?!data:|#)([^"]+)"/g)].map((m) => m[1])
if (leftovers.length > 0) {
  console.error('STILL EXTERNAL:', leftovers)
  process.exit(1)
}

// Nothing may reach the network at runtime.
const networkCalls = [/\bfetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /@import/]
for (const re of networkCalls) {
  if (re.test(out)) {
    console.error(`OFFLINE UNSAFE: ${re} found in payload`)
    process.exit(1)
  }
}
// Any absolute http(s) reference outside SVG namespace declarations is a fetch.
const absUrls = [...out.matchAll(/(?:src|href)="(https?:|\/\/)[^"]*"/g)].map((m) => m[1])
if (absUrls.length > 0) {
  console.error('ABSOLUTE URLS:', absUrls.slice(0, 5))
  process.exit(1)
}

if (out.includes('type="module"')) {
  console.error('module script tag survived; Android blocks it on file://')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, out, 'utf8')

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`wrote ${outFile}`)
console.log(`  total  ${kb(Buffer.byteLength(out))}`)
console.log(`  js     ${kb(Buffer.byteLength(js))}`)
console.log(`  css    ${kb(Buffer.byteLength(css))}`)
console.log(`  icon   ${kb(Buffer.byteLength(favicon))} -> data uri`)
console.log('  external references: none')
