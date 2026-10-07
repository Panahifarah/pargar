# Pargar documentation

This folder is the engineering source of truth. [`README.md`](../README.md) is only the entry point; details live here.

## Reading map

1. **Newcomer / product** → [product.md](product.md)
2. **Architecture** → [architecture.md](architecture.md)
3. **Local development** → [development.md](development.md)
4. **Deployment** → [deployment.md](deployment.md) (plus the ops shortcut in [`deploy/README.md`](../deploy/README.md))
5. **Security & launch** → [security.md](security.md)
6. **Day-to-day ops** → [operations.md](operations.md)
7. **API contract** → [api.md](api.md)
8. **Env & settings** → [configuration.md](configuration.md)

## Writing conventions

- File paths, env names, shell commands, and route names stay in **exact English**.
- Prefer linking over long duplication across files.
- When behavior changes, update the matching doc in the same PR.

## Related files outside `docs/`

| File | Role |
|------|------|
| [`CONTEXT.md`](../CONTEXT.md) | Short domain summary for agents / fast onboarding |
| [`deploy/README.md`](../deploy/README.md) | Deploy command shortcut |
| [`.env.example`](../.env.example) / [`.env.prod.example`](../.env.prod.example) | Secret templates |
