// State schema migrations (CFG-2), applied in order by scripts/lib/state.mjs.
// Each entry is { from, to, name, up(state) => state } with to === from + 1.
// Schema 1 is the first; the list grows with every schema change.
export const migrations = [];
