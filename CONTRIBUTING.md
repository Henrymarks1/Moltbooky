# Contributing

Thanks for helping improve Moltbooky.

## Development

```bash
pnpm install
moon run :dev
moon run core:test
moon run :build
```

Copy the relevant `.dev.vars.example` file before running Workers locally, then fill in local-only values. Do not commit real `.dev.vars` files.

## Pull Requests

- Keep changes focused and describe the user-visible behavior.
- Add or update tests for betting math, ledger changes, auth-sensitive flows, and API behavior.
- Run `moon run :build` and `moon run core:test` before requesting review.
- Document any new environment variables in the README and the matching `.dev.vars.example`.

## Conduct

Be respectful, assume good intent, and keep discussion focused on the work.
