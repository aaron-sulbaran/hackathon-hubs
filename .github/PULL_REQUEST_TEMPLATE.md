## What this changes

<!-- One or two sentences. Link the issue: Closes #123 -->

## How you checked it

<!-- The commands you ran and their last line of output. The checks need Node 22.12 or later. -->

- [ ] `pnpm typecheck`, `pnpm test:all`, and `pnpm build` inside `template/` (if `template/` changed)
- [ ] `node --test "packages/create-hackathon-hub/test/*.test.mjs"` (if the scaffolder changed)
- [ ] Screenshots at phone and desktop width (if the board looks different)

## Rules

- [ ] `template/scripts/` and `template/lib/hub` still import Node built-ins only
- [ ] Nothing event-specific outside `hub.config.json` and `team.json`
- [ ] No real names, tokens, unlock links, or content from a real team's hub
- [ ] No em dashes

<!-- Did a coding agent help? Say which one. -->
