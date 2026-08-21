/**
 * React shim — provides `React` to the tsx files.
 *
 * In static-bundle mode the client bundle is a `__ModuleLoader__.load` factory
 * that receives a synchronous `require`. esbuild leaves `react` external, so
 * the emitted code calls `require('react')`, resolved by the DSH client module
 * system's seed. tsx files import React from here.
 */

import React from 'react'
export default React
