# Secret storage choice — Railway Variables (settled)

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_secrets.secret_storage_choice`
**Effort estimate**: 0.5d
**Inherited dependencies**: `prod_compose` rollup (the services the secrets attach to).
**Executor**: human operator (policy task; executed implicitly while doing the service tasks).

## What this task is

The "choose secret-storage approach" leaf. The choice was made by
[ADR 0031](../../../docs/adr/0031-production-hosting-railway-paas.md):

> **Secrets.** Railway Variables hold every secret ... No external
> secret manager.

What remains for this task is fixing the **operating conventions**
around that choice, so the three sibling handling tasks share one set
of rules.

## Conventions (the deliverable)

1. **Two stores, always both.** Every production secret exists in
   exactly two places: the Railway Variable (runtime copy) and the
   operator's password manager (canonical/recovery copy), under the
   same name. A secret in one store but not the other is a defect.
2. **Naming.** The Variable name is the contract: app-consumed
   variables use the server's env names (`SESSION_TOKEN_SECRET`, …);
   Dex-consumed ones use the `ACONVERSA_*` / `GOOGLE_*`
   names fixed in
   [`prod_railway_dex_service.md`](prod_railway_dex_service.md).
   The full inventory lives in `infra/railway/README.md`
   ([`prod_railway_iac_committed.md`](prod_railway_iac_committed.md)).
3. **Generation hygiene.** Generate locally (`openssl rand`);
   pass into Railway via dashboard paste or
   `railway variables --set "NAME=$(…)"` command substitution. No
   secret value in shell history, files in the repo tree, transcripts,
   or tickets.
4. **No third copies.** No `.env.production` on disk, no secrets in CI
   (the only CI secret is `RAILWAY_TOKEN`, which is a credential *to*
   the store, held in GitHub Actions secrets), no secrets in
   `railway.json` or any committed file.
5. **Rotation is per-secret, documented in the sibling refinements**
   ([`session_token_secret_handling.md`](session_token_secret_handling.md),
   [`postgres_credentials_handling.md`](postgres_credentials_handling.md),
   [`oauth_credentials_handling.md`](oauth_credentials_handling.md)).
   Common shape: write new value to both stores → restart the
   consuming service(s) → verify → retire the old value in the
   password manager (keep one prior version, labeled, for rollback).

## Acceptance criteria

- The conventions above are followed by the executed service tasks —
  spot-check: every Variable name in the dashboard has a same-named
  password-manager entry, and the leak-grep in
  `prod_railway_iac_committed` is clean.

## Decisions

- **Railway Variables, no external secret manager** — ADR 0031.
  Alternatives (Vault, SOPS-in-git, Doppler) were implicitly rejected
  by the ADR's "smallest operator surface" rationale; nothing at v1
  scale justifies a second secret system with its own auth, backup,
  and availability story.
- **Password manager as canonical copy** — Railway Variables have no
  versioning/recovery story of their own; the password manager is the
  recovery path and the rotation audit trail.

## Open questions

(none — all decided)
