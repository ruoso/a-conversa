# Amend `aud_session_url` refinement: unconditional `window.__aConversaWsStore` assignment

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_url_routing.aud_session_url_refine_amend` (lines 393-404).

**Effort estimate**: 0.1d (doc-hygiene amendment to a single refinement file; no runtime change).

**Inherited dependencies**:

- `!audience.aud_url_routing.aud_session_url` (settled — shipped 2026-05-27. The Status block at [`tasks/refinements/audience/aud_session_url.md:371-383`](aud_session_url.md#L371) records the divergence in the line `apps/audience/src/main.tsx — window.__aConversaWsStore = audienceWsStore made unconditional (DEV gate dropped; matches participant precedent at apps/participant/src/main.tsx:42-50; tree-shaking in the compose production build eliminated the gated assignment — see attempt 5).` That Status-block note is the historical record naming this follow-up as the redress path).
- Prose-only context (NOT a `.tji` edge): `participant-ui.part_ws_client` (settled — Decision §3 prose + the comment block at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) are the canonical precedent the audience now mirrors; the participant landed the unconditional assignment first, with the tree-shaking rationale spelled out inline. The audience post-ship code follows that pattern verbatim).

## What this task is

An **amendment pass** in the same shape as the `docs/adr/README.md:16-22` ADR-amendment rule, applied to a refinement document. The prior `aud_session_url` refinement prescribes — in multiple places — a DEV-gated (`import.meta.env.DEV === true`) exposure of `window.__aConversaWsStore`. The shipped code at [`apps/audience/src/main.tsx:72-73`](../../../apps/audience/src/main.tsx#L72) drops the gate: the assignment is **unconditional**, matching the participant precedent at [`apps/participant/src/main.tsx:50`](../../../apps/participant/src/main.tsx#L50). The reason was discovered during the implementer's fixer attempt 5 — the compose stack's production-mode Vite build tree-shakes DEV-gated branches and would silently strip the seed entry point in CI. The runtime is correct (the unconditional assignment matches the participant + moderator pattern); the refinement-doc body still narrates the wrong (DEV-gated) shape. This task rewrites that narration in place so the next reader of `aud_session_url.md` doesn't reproduce the wrong claim.

Scope is **one file, doc-only**:

1. `tasks/refinements/audience/aud_session_url.md` — replace every body occurrence of the DEV-gating claim with the correct claim (unconditional assignment; tree-shaking rationale spelled out inline; reference the participant comment-block precedent at `apps/participant/src/main.tsx:36-50`). The `## Status` block at the bottom (lines 371-383) already records the correction and the divergence — **do not touch it**; it is the historical record of how the prior task landed and per `tasks/refinements/README.md:36` Status sections are write-once.

## Why it needs to be done

Refinement-as-spec authority. Subsequent audience-tier sub-agents and the orchestrator's pick-task pass read `aud_session_url.md` as the **prescriptive** document for the audience surface's window-seam contract. The body's DEV-gated prescription is now actively wrong: if a future implementer reads Decision §3 and re-introduces the `if (import.meta.env.DEV) { ... }` gate (e.g. during a refactor, a security review, or a `code-review` pass that flags the "exposing internal state on `window` in prod" pattern as a concern), they will silently break the Playwright spec that depends on the assignment landing in the compose stack's production-mode build. The Status block at the bottom of the file flags the divergence in prose, but Status blocks are read-once-on-pickup and easy to skip when scanning the Decisions section in isolation — the body-level Decision text wins by default. Bringing the body into agreement with shipped reality eliminates the trap.

The same logic underwrites the ADR amendment-pass rule (`docs/adr/README.md:16-22`): when a downstream artifact discovers that an upstream document's operational text is stale relative to canonical authority, the upstream document is amended in place. This task is the refinement-tier analogue of that pass — the canonical authority here is the shipped audience runtime + the participant comment-block precedent it mirrors.

## Inputs / context

**Canonical sources for the corrected claim (the Implementer cites these in the rewritten text):**

- [`apps/audience/src/main.tsx:56-73`](../../../apps/audience/src/main.tsx#L56) — the shipped audience runtime. The `mount(props)` body's first statement is the unconditional `(window as unknown as { __aConversaWsStore?: typeof audienceWsStore }).__aConversaWsStore = audienceWsStore;` assignment, with an 18-line comment block explaining why the DEV gate was dropped (tree-shaking in compose production builds + the same plumbing-convenience-not-new-capability argument the participant uses).
- [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) — the participant precedent. The comment block at lines 37-49 spells out the unconditional-assignment rationale: "the compose stack's production build mode tree-shakes DEV-gated branches, so a `import.meta.env.DEV` guard would silently strip the seed entry point in CI." The audience post-ship code copies this shape verbatim (only the assigned value differs: `audienceWsStore` singleton vs the participant's `useWsStore` hook reference).
- [`tasks/refinements/participant-ui/part_ws_client.md:150-158`](../participant-ui/part_ws_client.md#L150) — the participant refinement's sketched code, which itself names the unconditional pattern as canonical. (The participant refinement is the seed of the unconditional-assignment pattern across all three surfaces.)
- [`tasks/refinements/audience/aud_session_url.md:371-383`](aud_session_url.md#L371) — the `## Status` block of the file being amended. Its `main.tsx` bullet is the prose-tier record of the divergence; the body amendments this task lands bring the Decision-tier text into agreement with that record.

**Target file to amend:**

- `tasks/refinements/audience/aud_session_url.md` — the body occurrences requiring rewrite are at the following approximate locations (the Implementer should `grep -n "import.meta.env.DEV\|dev-only\|DEV-gated\|gated on \`import\|production bundle stays clean"` on the file and verify the hit list — the line numbers below may have drifted by 1-2 since this refinement was authored):

  - **What this task is — third bullet** at approximately line 18: `apps/audience/src/main.tsx is extended with a dev-only window.__aConversaWsStore = useWsStore assignment that mirrors the participant + moderator pattern ... Gated on import.meta.env.DEV === true so the production bundle stays clean.` Rewrite so the bullet names the unconditional assignment and the tree-shaking rationale; drop the "production bundle stays clean" phrasing (the production bundle deliberately carries the assignment — that's the whole point of the unconditional shape).

  - **Inputs / context — Live code the leaf plugs into** at approximately line 74: `apps/audience/src/main.tsx:85-94 — <WsClientProvider> already mounted with allowAnonymous. This leaf adds the dev-only window.__aConversaWsStore assignment immediately after the ReactDOM.createRoot(...) call (Decision §3).` Rewrite so it says "unconditional `window.__aConversaWsStore` assignment" and locates the assignment correctly (the shipped code places the assignment **before** `ReactDOM.createRoot(...)`, as the first statement of `mount(props)` — see [`apps/audience/src/main.tsx:72-73`](../../../apps/audience/src/main.tsx#L72) vs `:75`).

  - **Constraints / requirements — Files this task touches — `apps/audience/src/main.tsx` entry** at approximately lines 118-126. The code sketch reads:

    ```ts
    if (import.meta.env.DEV) {
      (window as unknown as { __aConversaWsStore?: typeof audienceWsStore }).__aConversaWsStore =
        audienceWsStore;
    }
    ```

    Rewrite the sketch to drop the `if (import.meta.env.DEV) { ... }` wrapper, leaving the bare assignment. Update the surrounding prose paragraph that explains the placement: the assignment lives **inside** `mount(props)` as its first statement (NOT "immediately after `ReactDOM.createRoot(...)`"). The "two intentional differences" paragraph should be reframed: only difference (a) — assignment-inside-mount-not-module-scope — survives; difference (b) about the value being the audience-specific `audienceWsStore` is correct and stays.

  - **Acceptance criteria — `apps/audience/src/main.tsx` bullet** at approximately line 186: `apps/audience/src/main.tsx exposes window.__aConversaWsStore = audienceWsStore inside mount(props) gated on import.meta.env.DEV === true.` Rewrite to drop the "gated on `import.meta.env.DEV === true`" clause. The Vitest case described next (in `main.test.tsx` or `mount.test.tsx`) should be rewritten too: the original prescribes asserting the assignment lands in DEV mode AND is absent in prod-mode mock; the new test pins the unconditional shape (assignment present unconditionally; no DEV-flag toggling needed). The shipped Vitest case at `apps/audience/src/mount.test.tsx` is already in the unconditional shape — the Status block records the smoke count rise.

  - **Decisions §3 (title + body)** at approximately lines 278-289. The title reads "Expose `window.__aConversaWsStore` (dev-only) on the audience; payback the deferred decision". Drop the "(dev-only)" qualifier. The body's option-(A — chosen) text says "Expose `audienceWsStore` on `window.__aConversaWsStore` under `import.meta.env.DEV` only"; rewrite to remove the "under `import.meta.env.DEV` only" qualifier and add the tree-shaking rationale paragraph. The final "Why `import.meta.env.DEV`" sub-paragraph (the last paragraph of §3, asserting the production OBS bundle MUST NOT expose internal store state on `window` as a defensive-coding move) is the **load-bearing wrong claim** — replace it wholesale with the tree-shaking rationale that matches the shipped comment block at [`apps/audience/src/main.tsx:63-71`](../../../apps/audience/src/main.tsx#L63):

    > **Why unconditional and not DEV-gated**: the compose stack's production-mode Vite build tree-shakes `import.meta.env.DEV` branches; a guard would silently strip the seed entry point in CI, where the Playwright spec runs against the production-mode build. The participant precedent at `apps/participant/src/main.tsx:36-50` documents the same trap. The plumbing-convenience-not-new-capability argument (the store reference is already reachable through the module graph; window-exposure is a Playwright-only convenience) is the security argument: the audience surface's store is read-only-by-construction (`audienceWsStore` is a Zustand singleton fed only by the inbound WS dispatcher; no caller can write to it from outside), so production-mode exposure does not widen the attack surface.

  - **Decision §5** at approximately lines 301-310 (titled "Inline `page.evaluate` for seeding, NOT the `seedWsStore` fixture wrapper (initially)"). Decision §5 does NOT itself prescribe DEV gating, but the WBS note for this amendment task lists "Decision §3 + §5" together because the surrounding prose around the `seedWsStore` helper (lines 305-308) carries an implicit assumption that the window key is dev-only-reachable (the participant precedent the §5 paragraph cites uses the unconditional key; the audience refinement's §5 inherits the same flavour). The amendment here is a one-line clarification at the end of §5: explicitly state that the window-key the inline `page.evaluate` calls reach is the unconditional `window.__aConversaWsStore` per amended §3 — the spec does NOT need to special-case prod-vs-dev-mode Playwright runs.

- The `## Status` block at the bottom (lines 371-383) — **do not edit**. Its `main.tsx` bullet already records the divergence ("`window.__aConversaWsStore = audienceWsStore` made unconditional (DEV gate dropped; matches participant precedent at `apps/participant/src/main.tsx:42-50`; tree-shaking in the compose production build eliminated the gated assignment — see attempt 5)"). Editing it would erase the historical trail that points the next reader to this amendment task.

## Constraints / requirements

- **Doc-only.** No runtime behavior change. The shipped code in `apps/audience/src/main.tsx` is the canonical reference for the corrected claim; this task only realigns `aud_session_url.md`'s prose to match it.
- **Preserve all other content** of `aud_session_url.md`. Only the body occurrences of the DEV-gating prescription get rewritten; everything else — every other Decision, every acceptance-criteria bullet, every paragraph not naming the DEV gate — stays verbatim. The amendment is surgical, not a wholesale rewrite. In particular: the four-leaf inherited-debt list, the six Playwright scenarios, Decisions §1/§2/§4/§6/§7/§8/§9/§10, and the Open questions all stay untouched.
- **Do not touch the `## Status` block** (lines 371-383). Per `tasks/refinements/README.md:36` Status sections are the historical record per the task-completion ritual; the closer's correction note in that block is the trail that points future readers to this amendment task. Editing it would erase the trail.
- **Single file scope.** Only `tasks/refinements/audience/aud_session_url.md` is touched. No code edits (the code is already correct); no other refinements need amending (the participant + moderator precedents already document the unconditional pattern correctly); no ADR (the decision is settled at the refinement tier, not architectural).
- **No new e2e, no new i18n keys, no new ADRs.** Pure doc fix; the UI-stream e2e policy does not apply (no UI-surface change). The audience-live-session Playwright spec from the prior task is already on disk and already exercises the unconditional window-seam (it would have failed CI otherwise).
- **Build + smoke remain green** per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — running the full test suite after the amendment must not regress. The amendment touches only a refinement document — no source, no schema, no config — so the global build+test gate falls under the [doc-only commit](../../../tasks/refinements/audience/aud_session_url_refine_amend.md) skip rule (memory entry `feedback_doc_only_commits_skip_build_test.md`). The pre-commit hook is the safety net.

## Acceptance criteria

1. `grep -n "import.meta.env.DEV\|DEV-gated\|gated on .*DEV\|dev-only.*window\|production bundle stays clean" tasks/refinements/audience/aud_session_url.md` returns **no hits** outside the `## Status` block (lines 371+). The unrelated `production` usages (e.g. references to the "production Docker bundle" in non-DEV-gating contexts) survive only if they don't reproduce the wrong claim — the Implementer audits each remaining hit before declaring done.
2. The rewritten Decision §3 explicitly cites the tree-shaking rationale (matching the shipped comment block at [`apps/audience/src/main.tsx:63-71`](../../../apps/audience/src/main.tsx#L63)) and the participant precedent at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36).
3. The code sketch in Constraints / requirements (the `apps/audience/src/main.tsx` entry around lines 118-126) shows the bare assignment without the `if (import.meta.env.DEV) { ... }` wrapper, and the surrounding prose names the assignment's placement correctly (first statement of `mount(props)`, before `ReactDOM.createRoot(...)`).
4. The acceptance-criteria bullet for `apps/audience/src/main.tsx` (around line 186) describes the unconditional assignment; the corresponding Vitest-case description names the assertion shape that matches the shipped `apps/audience/src/mount.test.tsx`.
5. The `## Status` block of `aud_session_url.md` (lines 371-383) is byte-identical before and after the amendment — `git diff` shows zero changes in that range.
6. The closer appends a fresh `## Status` block to **this** refinement document recording the amendment and the commit per the `tasks/refinements/README.md:32` ritual.
7. Doc-only commit per [`feedback_doc_only_commits_skip_build_test.md`](../../../../.claude/projects/-home-ruoso-devel-a-conversa/memory/feedback_doc_only_commits_skip_build_test.md): the global build+test gate is skipped; the pre-commit hook is the safety net.

## Decisions

### §1 — Canonical authority is the shipped runtime + participant precedent

The corrected claim defers to two sources: the shipped audience runtime at [`apps/audience/src/main.tsx:56-73`](../../../apps/audience/src/main.tsx#L56) (the actual unconditional assignment + its 18-line rationale comment) and the participant precedent at [`apps/participant/src/main.tsx:36-50`](../../../apps/participant/src/main.tsx#L36) (the original codebase-wide adoption of the unconditional pattern, with the tree-shaking trap documented inline). The amendment names these sources by file:line in the rewritten text so the next reader can verify the claim against living code, not against the amended refinement's own prose.

**Alternative**: cite only the shipped audience code without the participant precedent. Rejected — the participant precedent is the seed of the pattern across all three surfaces, and naming it in the amended Decision §3 lets a future reader see the codebase-wide consistency directly rather than having to discover it via grep.

### §2 — Status block immutability

The prior `aud_session_url` `## Status` block stays untouched. Per `tasks/refinements/README.md:36` Status sections are the historical record of how the task landed; the closer's correction note in that block ("`window.__aConversaWsStore = audienceWsStore` made unconditional (DEV gate dropped; matches participant precedent at `apps/participant/src/main.tsx:42-50`; tree-shaking in the compose production build eliminated the gated assignment — see attempt 5)") is the trail that points future readers to this amendment task. Editing it would erase the trail.

The closer of THIS amendment task appends a new `## Status` block to **this** file (`aud_session_url_refine_amend.md`), not to the prior file. Two amendments to the same prior refinement therefore land as two distinct Status blocks on two distinct amendment-task documents — the pattern that `mod_propose_action_refinement_amendment.md` established for the moderator-tier equivalent.

### §3 — Scope confined to the one named file

No code edits, no ADR, no other refinement touched. The shipped audience runtime is already correct; the participant + moderator precedents already document the unconditional pattern correctly; the only artifact narrating the wrong claim is `aud_session_url.md`'s body. A wider scope (e.g. amending all three surfaces' refinements to add cross-references) is YAGNI — the next reader who hits the corrected `aud_session_url.md` Decision §3 sees the participant precedent cited directly and can navigate from there if they want the full picture.

**Alternative**: also add a back-reference from the participant refinement's Status block pointing at the audience as a downstream consumer. Rejected — the participant refinement's Status block is settled; back-references for "downstream surfaces that mirrored this pattern" are a different kind of artifact (better surfaced via grep or the ADR layer if one ever lands) and adding them piecemeal as each surface ships would noise up the historical record.

### §4 — No ADR

The unconditional-vs-DEV-gated choice is a **task-level** decision shaped by the compose stack's production-mode tree-shaking behavior, not a project-level architectural commitment. The same call recurs naturally on every future surface that needs Playwright-imperative drives (moderator, participant, audience — and any next surface that lands). The pattern is documented in the comment blocks at the three surfaces' `main.tsx` files, which is the right tier (close to the code, visible to any future implementer who edits those files). Promoting it to an ADR would over-formalize a documentation pattern.

**Alternative**: write an ADR titled "Compose stack production-mode builds tree-shake DEV-gated branches; window-seams must be unconditional." Rejected per above; the comment-block precedent at three surface files is the canonical tier.

### §5 — Amendment-task naming convention

This task is named `aud_session_url_refine_amend` matching the WBS leaf at `tasks/50-audience-and-broadcast.tji:393`. The refinement-file basename mirrors the leaf id (`aud_session_url_refine_amend.md`), continuing the pattern `mod_propose_action_refinement_amendment.md` established for the moderator amendment. The `_refine_amend` suffix is intentional shorthand — readable enough that a future grep for "amendments to prior refinements" finds both files.

**Alternative**: name the file `aud_session_url_amendment.md` (closer to the moderator's `_refinement_amendment` shape). Rejected — the WBS leaf is `aud_session_url_refine_amend` and the file convention is "filename matches leaf id"; deviating would break the `note "Refinement: tasks/refinements/<area>/<task_name>.md"` convention `tasks/refinements/README.md:15` documents.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `tasks/refinements/audience/aud_session_url.md` amended: 5 body locations rewritten (line-18 bullet, line-74 Live-code bullet, Constraints code sketch + surrounding prose at ~lines 118-126, Acceptance-criteria `main.tsx` bullet at ~line 186, Decision §3 title + option-(A) + closing rationale paragraph at ~lines 278-288), Decision §5 closing clarification appended.
- DEV-gating prescription (`import.meta.env.DEV`) removed from all body occurrences; replaced with unconditional assignment + tree-shaking rationale.
- Decision §3 now cites the tree-shaking trap (compose production Vite build tree-shakes DEV-gated branches) and the participant precedent at `apps/participant/src/main.tsx:36-50`.
- Code sketch in Constraints section rewritten to show bare assignment (no `if (import.meta.env.DEV)` wrapper) as first statement of `mount(props)`.
- Acceptance-criteria `main.tsx` bullet updated to describe unconditional assignment; Vitest-case description updated to match shipped `apps/audience/src/mount.test.tsx` shape.
- `## Status` block of `aud_session_url.md` (lines 371-383) left byte-identical — historical trail preserved (acceptance criterion #5 satisfied).
- Net diff: 13 insertions, 13 deletions; all hunks above line 311; zero changes in Status block range.
