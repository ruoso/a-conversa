# Authelia dev TLS material

`cert.pem` + `key.pem` are a committed, self-signed certificate / private
key pair used **only** by the local compose stack so the dev Authelia
service answers `https://authelia:9091` instead of `http://`. The
moderator + server side (`apps/server/src/auth/config.ts`) feeds
`OIDC_ISSUER_URL=https://authelia:9091` into `openid-client@6`, which
rejects http issuer URLs by default — this cert lets the dev/CI shape
match the production shape (https everywhere) without bypassing the
library's TLS gate.

## Trust shape

- The compose `app` service mounts `cert.pem` and sets
  `NODE_EXTRA_CA_CERTS` so the server's Node.js process trusts it for
  OIDC discovery + token-exchange calls to `https://authelia:9091`.
- Authelia mounts `cert.pem` + `key.pem` and serves TLS via the
  `server.tls` block in `configuration.yml`.
- The Playwright browser never visits `https://authelia:9091` directly
  (the i18n smoke spec asserts the 302 from `GET /api/auth/login` without
  following the redirect into Authelia), so the browser trust store
  doesn't need this cert.

## Properties

- Subject: `CN=a-conversa dev Authelia`
- SANs: `DNS:authelia`, `DNS:localhost`, `IP:127.0.0.1`
- 2048-bit RSA, self-signed, 100-year validity (dev-only — production
  uses real CA-issued certs supplied via `deployment.prod_secrets`).

## Regenerate

If/when this material rotates, re-run:

```sh
openssl req -x509 -nodes -newkey rsa:2048 -days 36500 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=a-conversa dev Authelia" \
  -addext "subjectAltName=DNS:authelia,DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
```

Production secrets never share material with this directory; the
`deployment.prod_secrets` task is the only authoritative source for
production TLS keys.
