# Security

Arvlet v0.1 is a single-owner, pre-release workspace. API keys grant access to the
entire workspace. Do not expose a local HTTP deployment to the public network.
Use the documented HTTPS configuration for remote access and protect `.env` and
database backups as credentials and private workspace data.

HTML artifacts run in browser isolation with a restricted state bridge. They are
not trusted application code. Fetch/XHR, external resource loading, parent-document access, and form
submission are disabled. Iframe self-navigation is not a reliable network containment
boundary. Only run artifact source trusted with its own data. CPU and memory usage
are not bounded by this sandbox.

Please use GitHub's private vulnerability reporting feature if enabled on the
repository. If unavailable, open an issue requesting a private contact without
including exploit details, credentials, or private data. There is no promised
response SLA during pre-release development.
