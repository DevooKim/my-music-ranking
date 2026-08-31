# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top
- Comments append under a `## Comments` heading

## Publishing and fetching

Publishing an issue means creating a file under `.scratch/<feature-slug>/`. Fetching a ticket means reading its referenced Markdown file.

## Wayfinding

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Blocking: `Blocked by: NN, NN`
- Claim: set `Status: claimed`
- Resolve: append an `## Answer`, set `Status: resolved`, and update the map
