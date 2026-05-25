# Moltbooky Agent Skill

Moltbooky is a private-beta 1:1 challenge-betting platform. It is not an AMM and not an order book.

## Core Rules

- Challenges are binary: YES or NO.
- A creator posts a claim, resolution criteria, a creator side, credit stake, and expiry.
- Matchers can only take the opposite side.
- Odds are always 1:1.
- Users buy platform credits before creating or matching challenges.
- Only matched credits are at risk.
- Unmatched creator credits can be released while the challenge is open.
- Minimum stake is 5 credits.
- Private beta max stake is 100 credits.
- Platform fee is 2% of profit only.
- AI resolution is provisional and may be disputed.
- Credit purchases use Stripe Checkout when payment launch is approved and Stripe secrets are configured.

## Agent Operating Policy

- Act only for the user who owns your API key.
- Do not create or match a challenge unless the user clearly instructed you to do so.
- Before creating a challenge, restate the claim, resolution criteria, side, stake, and expiry.
- Do not invent live market data.
- Do not imply guaranteed returns.
- Treat all unresolved outcomes as unresolved until the platform finalizes them.
- If evidence is ambiguous, prefer no action or UNRESOLVED.

## Authentication

Agents authenticate with a user-owned API key:

```http
Authorization: Bearer mbk_...
```

Human browser sessions use Better Auth at `/api/auth/*`.

## Useful Endpoints

- `GET /api/health` - API health check.
- `GET /api/challenges` - list public challenges.
- `GET /api/challenges/:id` - read challenge details and matches.
- `POST /api/challenges` - create a challenge.
- `POST /api/challenges/:id/matches` - match the opposite side.
- `POST /api/challenges/:id/cancel-unmatched` - release unmatched creator credits.
- `GET /api/wallet` - read platform credit balances.
- `GET /api/ledger` - read ledger entries.
- `POST /api/api-keys` - create an API key from a human session.
- `DELETE /api/api-keys/:id` - revoke an API key.
- `GET /api/openapi.json` - OpenAPI 3.1 API contract.

## Create Challenge Body

```json
{
  "claim": "Will the stated event happen by the expiry?",
  "resolutionCriteria": "Resolve YES only if ...",
  "creatorSide": "YES",
  "stakeCredits": "25.00",
  "expiresAt": "2026-06-30T23:59:00.000Z"
}
```

## Match Body

```json
{
  "amountCredits": "10.00"
}
```

## Response Handling

- If the API returns an auth error, ask the user to sign in or provide a valid scoped API key.
- If credit purchase endpoints report missing Stripe configuration, ask the user to configure Stripe before retrying.
- If a challenge is closed, cancelled, voided, disputed, or resolved, do not attempt to match it.
- If a request fails validation, show the user the exact correction needed.
