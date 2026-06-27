# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest stable release | Yes |
| Pre-release / nightly | Best-effort |
| Older versions | No |

## Reporting a Vulnerability

This is a community VS Code extension published to the Marketplace and Open VSX.
It is a **read-only** extension: it never writes to disk, never sends network
requests, and its only attack surface is the webview that renders transcript data
from local Claude Code workflow runs.

If you discover a security vulnerability, please report it privately by email
rather than opening a public GitHub issue. Public disclosure of an unpatched
vulnerability could expose users before a fix is available.

**Contact:** malte@langermann.net

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Which version of the extension you tested against.

**Response timeline:**

- Acknowledgement within 5 business days.
- Status update within 14 days.
- Target fix within 30 days for confirmed issues.

We will coordinate a release and credit the reporter (unless they prefer
to remain anonymous) before public disclosure.

## Scope

In scope:

- XSS / content injection in the webview (the extension renders transcript data
  from disk inside a sandboxed VS Code webview; a crafted workflow output could
  attempt script injection).
- Path traversal or information disclosure (the extension reads files under
  `~/.claude/projects` and the configured workspace; a crafted run dir could
  attempt to leak paths outside the intended scope).
- Supply-chain issues in the extension's own dependencies.

Out of scope:

- Vulnerabilities in VS Code itself or the Claude Code CLI.
- Issues that require the attacker to already have write access to
  `~/.claude/projects` (that constitutes full local code execution already).

## Disclaimer

This is an unofficial community project and is **not affiliated with Anthropic**.
For Claude Code CLI security issues, contact Anthropic directly.
