# OBS setup guide — production grounding

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.deployment_docs.obs_setup_guide`
**Effort estimate**: 1d
**Inherited dependencies**: `audience.aud_obs_integration.aud_obs_setup_docs` (settled — it authored [`docs/obs-setup.md`](../../../docs/obs-setup.md) with `https://<host>` placeholders and delegated the deployed-host specifics here), `prod_tls_and_domain` (the hostnames now exist).
**Executor**: agent-authored; producer-consumed.

## What this task is

Ground the producer-facing OBS guide in the live production
instance: the concrete host, and the production-specific failure
mode the audience-side guide could not know about.

## Why it needs to be done

The guide's whole audience is a show producer on show day. With
placeholders, the producer's first question ("what URL do I paste?")
had no answer in the doc — and the production hostname scheme has a
trap built in: the apex forwards root-only, so a bare-domain deep
link inside a Browser source fails *silently* as an empty transparent
layer. That exact mistake on show day costs minutes at the worst
possible time.

## Acceptance criteria

- `docs/obs-setup.md` names `www.a-conversa.org` as the production
  host and warns about the bare-domain deep-link 404 with the
  silent-in-OBS framing.
- The rest of the guide (already written and validated by the
  audience-side task) is untouched.

## Decisions

- **Amend the existing guide, don't fork a "production" copy** — one
  document for producers; the production section sits at the top and
  self-hosted instances keep the placeholder convention.

## Open questions

(none — all decided)

## Status

**Done — 2026-06-12.** "The production instance" section added to
[`docs/obs-setup.md`](../../../docs/obs-setup.md): canonical host
`www.a-conversa.org`, the apex deep-link 404 called out with its
silent-empty-source symptom and a pointer to the admin runbook.
