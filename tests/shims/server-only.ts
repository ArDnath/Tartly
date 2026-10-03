// Vitest shim for Next.js's `server-only` marker package. In a real Next build
// the compiler aliases this import to a module that throws in a client bundle;
// under Node tests there is no client bundle, so an empty module lets pure
// server logic be imported directly.
export {};
