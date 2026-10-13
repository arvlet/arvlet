# Security

Arvlet v0.1 is a single-owner, pre-release workspace. API keys grant access to the
entire workspace. Do not expose a local HTTP deployment to the public network.
Use the documented HTTPS configuration for remote access and protect `.env` and
database backups as credentials and private workspace data.

HTML artifacts run on a dedicated preview origin in browser isolation with a restricted state bridge. They are
not trusted application code. Fetch/XHR, external resource loading, parent-document access, and form
submission are disabled. Iframe self-navigation is not a reliable network containment
boundary. Only run artifact source trusted with its own data. CPU and memory usage
are not bounded by this sandbox.

Editable share URLs are bearer capabilities: anyone with the complete URL can
read and replace that artifact's app data. They do not provide workspace access.
Shares pin HTML code at creation, have no automatic expiry, and can be revoked
through the authenticated shares API. Do not put private edit URLs in screenshots,
public issues, or logs. Database backups may contain share URLs in stored
idempotency responses as well as hashed share lookups; protect the entire backup.
The optional LAN listener exposes only share routes. Use it only on a trusted
network; HTTP does not encrypt content or edit links in transit.

Please use GitHub's private vulnerability reporting feature if enabled on the
repository. If unavailable, open an issue requesting a private contact without
including exploit details, credentials, or private data. There is no promised
response SLA during pre-release development.
