// Test shim for Next's `server-only` marker.
//
// Next aliases `server-only` to its own implementation at build time. Plain
// `tsx` (used by the onboarding smoke test) has no such alias, so this empty
// module is placed on NODE_PATH to satisfy the import.
module.exports = {};
