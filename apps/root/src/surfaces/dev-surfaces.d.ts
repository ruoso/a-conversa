// Ambient module declarations for the surface apps, consumed ONLY by the
// dev-source loader (`devSurfaces.ts`).
//
// The surfaces are apps, not published packages — they have no `exports`
// map — so without these declarations tsc cannot type the
// `import('@a-conversa/<surface>')` calls in `devSurfaces.ts`. At runtime the
// root Vite dev server resolves those specifiers to each surface's
// `src/main.tsx` via the alias in `vite.config.ts` (`serve` branch). Each
// surface entry exposes the same shape as a built surface bundle: a default
// `SurfaceModule` plus the named `mount`.

declare module '@a-conversa/moderator' {
  const surface: import('@a-conversa/shell').SurfaceModule;
  export const mount: import('@a-conversa/shell').MountFn;
  export default surface;
}

declare module '@a-conversa/participant' {
  const surface: import('@a-conversa/shell').SurfaceModule;
  export const mount: import('@a-conversa/shell').MountFn;
  export default surface;
}

declare module '@a-conversa/audience' {
  const surface: import('@a-conversa/shell').SurfaceModule;
  export const mount: import('@a-conversa/shell').MountFn;
  export default surface;
}

declare module '@a-conversa/test-mode' {
  const surface: import('@a-conversa/shell').SurfaceModule;
  export const mount: import('@a-conversa/shell').MountFn;
  export default surface;
}
