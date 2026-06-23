# Security Policy

## Reporting a vulnerability

If you discover a security issue in the Credio SDK or the Credio API, please
report it privately — do **not** open a public issue.

- Open a private security advisory: **GitHub → Security → Report a vulnerability**
  on this repository, or
- Reach out through the contact channels on [credio.cc](https://credio.cc).

We'll acknowledge your report and keep you updated on the fix.

## Scope & design notes

- This SDK is a thin, **zero-secret** HTTP client. It never handles or stores
  private keys, and authentication to Credio is simply your Solana wallet
  address — there are no API keys.
- Repayments are **non-custodial**: your agent signs its own transactions. The
  Credio API verifies every payment and repayment **on-chain** before any
  balance changes.
- Never commit secrets (private keys, RPC keys, `.env` files) when integrating.
  The SDK requires none.

Thank you for helping keep the agent economy safe.
