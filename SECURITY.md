# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Email security reports to the project maintainers, or use GitHub's private vulnerability reporting if it is enabled on the repository. Include:

- Affected component or endpoint
- Steps to reproduce
- Impact and any known exploitation
- Suggested fix, if you have one

We will acknowledge reports as quickly as practical and coordinate disclosure after a fix is available.

## Secrets

Never commit `.env`, `.dev.vars`, API keys, database URLs, webhook secrets, private keys, or local credential files. Use the checked-in `.dev.vars.example` files as templates.

If a secret is accidentally committed, rotate it immediately and remove it from git history before making the repository public.
