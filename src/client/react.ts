/**
 * React shim — re-export React.createElement as `React` for tsx files.
 *
 * At build time, tsup replaces JSX with React.createElement calls.
 * At runtime in the Cordis client sandbox, `React` is passed as a closure
 * parameter by the client runner's evaluateClientHalf (first positional arg).
 * It is NOT a global, so `globalThis.React` is undefined and crashes at render.
 * This module gives tsx files a clean `import React from '../react'`.
 */

// React is injected as a closure parameter by the Cordis client runner.
// Reference it as a free variable so the bundler keeps the bare identifier.
declare const React: typeof import('react')
export default React
