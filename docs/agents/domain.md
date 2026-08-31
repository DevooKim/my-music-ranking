# Domain Docs

Before exploring the codebase, read the root `CONTEXT.md` and relevant ADRs under `docs/adr/` when they exist. Missing files require no warning; domain-modeling creates them lazily when needed.

## Layout

This repository uses a single-context layout:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Use terminology defined by `CONTEXT.md`. If work contradicts an existing ADR, surface that conflict explicitly instead of silently overriding it.
