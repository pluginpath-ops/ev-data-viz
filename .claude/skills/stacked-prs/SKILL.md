---
name: stacked-prs
description: >
  EVBench's rules for stacked pull requests with `gh stack`. Use with GitHub's
  gh-stack skill whenever work in this repo is split into dependent PRs, a
  stack is created, submitted, synced or merged, or a stack branch is checked
  out.
---

# Stacked PRs in EVBench

GitHub's own skill covers `gh stack` itself: layers, non-interactive flags,
syncing, merging and recovery. Read it first:
https://github.com/github/gh-stack/tree/main/skills/gh-stack

This file adds only what is specific to this repository. Every rule here was
learned on the first stack, the navigation layers of #338 (stack #359).

## When to stack

- **One plan, dependent layers.** Stack when later work needs earlier work
  merged to make sense, and each layer is reviewable alone. CLAUDE.md's
  "never stack unrelated work" still holds: unrelated fixes get their own PR
  from `main`.
- **Every layer leaves a working app.** A reviewer may merge the stack part
  way. If a layer removes something (a tab, a route), the layer that replaces
  it has to be the same one or one below it.
- **Leave out anything that needs the owner's decision.** Post it as questions
  on the issue, and add it as a layer once it is decided.

## Commands, with this repo's flags

The repo has three remotes, all the same URL, so every command that pushes
needs `--remote origin`. Do not change the owner's git config to avoid it.

```bash
git checkout main && git pull
gh stack init <prefix>/1-<name>      # first layer, from an up-to-date main
# ... commit ...
gh stack add <prefix>/2-<name>       # each further layer
gh stack submit --auto --open --remote origin
gh stack view --json                 # never bare: it opens a TUI
```

## PR titles and descriptions

`submit --auto` takes each PR's title from its branch's latest commit subject,
and its body from that commit's body, without the attribution line. So:

1. **Write each layer's commit message as its PR description.** Say what the
   layer changes, what it leaves to the layers above it, and the checks run.
   End it with the vocabulary pledge (CLAUDE.md).
2. **After `submit`, rewrite each new PR's description** with `gh pr edit
   <n> --body-file`. Start it with a stack note, e.g. "**Stack:** layer 2 of
   the plan on #338, on top of #357 (stack #359). Merging this one merges #357
   with it." End it with the attribution line.
3. **Run `npm run vocab -- --text "$(cat body.md)"`** on each description
   before posting it.

## Checks, per layer

Run these on every layer before committing it, not only the top one:
`npm test`, `npm run lint`, `npm run drift`, `npm run vocab`, and a
`vite build`. A layer that passes only with the layers above it is not a
layer.

## Merging

The owner merges. When asked to merge, use `gh stack merge <pr> --yes`, not
`gh pr merge`, which cannot merge a stack. After a merge, run
`gh stack sync --remote origin` so the layers above are rebased and
retargeted.
