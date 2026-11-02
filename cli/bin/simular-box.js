#!/usr/bin/env node
import { main } from '../src/cli.js'

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`simular-box: ${err.message}\n`)
    process.exit(1)
  },
)
