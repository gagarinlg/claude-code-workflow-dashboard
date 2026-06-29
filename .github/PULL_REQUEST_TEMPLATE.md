## Summary

<!-- Describe what this PR does and why. Link the related issue if one exists (e.g. Closes #123). -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation / community files only
- [ ] Refactor / internal cleanup (no behavior change)

## Checklist

- [ ] `npm run typecheck` passes (no TypeScript errors)
- [ ] `npm run lint` passes (zero ESLint warnings/errors)
- [ ] `npm run coverage` passes (coverage stays >= 90 % on `src/data/**` and `src/webview/**`)
- [ ] New code is covered by tests (added or extended test files)
- [ ] The extension remains **read-only** (no writes to `~/.claude` or the workspace,
      except the user-initiated Markdown export)
- [ ] New UI strings use `--vscode-*` CSS variables (no hardcoded colors)
- [ ] Any webview output derived from transcripts is escaped via `esc()` (no raw `innerHTML`)
- [ ] `dist/` is **not** included in this PR (it is generated, never committed)
- [ ] ROADMAP.md / CLAUDE.md updated if structure or conventions changed
- [ ] CHANGELOG.md entry added (if this is a user-visible change)

## Testing

<!-- Describe how you tested this change. Include relevant vitest test names, manual steps, or both. -->

## Screenshots (if applicable)

<!-- For UI changes, attach before/after screenshots in dark and light theme. -->
