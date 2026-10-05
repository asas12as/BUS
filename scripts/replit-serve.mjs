import { spawn } from 'node:child_process'

/**
 * Replit entrypoint. Replit sets PORT and expects the server bound to 0.0.0.0
 * so its proxy can reach it. A node wrapper keeps the port defaulting
 * cross-platform, since `${PORT:-5173}` is shell syntax and would break on
 * Windows.
 */
const port = process.env.PORT ?? '5173'

const vite = 'node_modules/vite/bin/vite.js'

const child = spawn(process.execPath, [vite, '--host', '0.0.0.0', '--port', port, '--strictPort'], {
  stdio: 'inherit'
})

child.on('exit', (code) => process.exit(code ?? 0))
