/**
 * React shim — re-export React.createElement as `React` for tsx files.
 *
 * At build time, tsup replaces JSX with React.createElement calls.
 * At runtime in the Cordis client sandbox, `React` is a global.
 * This module gives tsx files a clean `import React from '../react'`.
 */

// React is a global in the Cordis client sandbox — just re-export it.
export default (globalThis as any).React as typeof import('react')
