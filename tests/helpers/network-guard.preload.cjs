'use strict';
// Ponto de entrada do `--require` nos workers do Vitest (ver vitest.config.ts).
require('./network-guard.cjs').install({ scope: 'worker' });
