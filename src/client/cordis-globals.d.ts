/**
 * Ambient declarations for symbols injected by the Cordis client runner.
 *
 * The client runner's `evaluateClientHalf` wraps the bundle as:
 *   new Function('React', 'console', 'styles', 'host', 'harness', ..., 'process', 'Buffer',
 *                `return (async () => { <bundle> })()`)
 * These are CLOSURE PARAMETERS, not globals. The bundle must reference them
 * as free identifiers so the bundler preserves them instead of replacing
 * with `globalThis.X` (which is undefined in the vm sandbox).
 */
declare const host: {
  call(method: string, args?: unknown): Promise<any>
}

declare const styles: {
  insert(css: string): () => void
}
