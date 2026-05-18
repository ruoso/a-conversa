# @a-conversa/audience

Audience surface frontend (React).

Builds as a Vite library-mode bundle that exports the `@a-conversa/shell` `mount(props): UnmountFn` contract, loaded by the root host through `/_surfaces/manifest.json`. See `tasks/refinements/audience/aud_app_skeleton.md` for the skeleton contract and ADR 0026 for the micro-frontend pivot. Real audience routes (graph rendering, segment markers, OBS sizing) land with the `aud_graph_rendering.*`, `aud_animations.*`, `aud_obs_integration.*`, and `aud_segment_markers.*` subgroups. The replay viewer / test-mode surface (originally sketched as `apps/replay`) is deferred — it will either land here or as its own workspace once the replay refinement settles.
