// Ambient `ImportMeta`/`ImportMetaEnv` augmentation for the tests/
// TypeScript project.
//
// The client apps (`apps/moderator`, `apps/participant`) pull `vite/client`
// into their own tsconfig via `"types": ["vite/client"]`, which augments
// `ImportMeta` with an `env` property (`DEV`, `MODE`, ...). When a tests/
// step file imports from one of those client packages (e.g. a graph
// selector that internally type-imports a Zustand store, which in turn
// imports a Vite-gated devtools helper), the transitive type-check runs
// under `tests/tsconfig.json` — where `vite/client` is not in scope.
//
// Declaring the same augmentation here keeps the `import.meta.env.X` reads
// in client code well-typed when reached through the tests project,
// without depending on `vite/client` being resolvable from `tests/`.
// Mirrors the subset of `vite/client.d.ts` reached by app code today.

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
