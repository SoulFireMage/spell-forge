Please always merge to main. This is going to be a GitHub Pages site, so whatever permissions are required to allow you to do that, you can assume they're given here, especially for merging to main and pushing.

We have existing infrastructure and template stuff for how to do the nuts and bolts of this. If you use the Starship Builder site and our usual root of skapi.com and GitHub Pages to produce yet another site.

Thank you. 
## Working notes (for agents)
- Deploys from `main` via GitHub Actions (`.github/workflows/deploy.yml`). Merge work into `main` and push.
- Before pushing a site change: `node tools/version.mjs` (bumps the version stamped into every module URL), then `npm test` and `node tools/ui-test.mjs`.
- Read `AGENT_SPEC.md` before changing the compiler, the genome or the Laws. Any genome in range must compile to one watertight body; `npm test` enforces it.
- Every manifold-3d object goes through `Scope.k()`; the test fails on leaks.
- An AI project built by Claude; keep that credit in the README and the page footer.

## Skapi (v1.1: accounts, Spellbook, Hall; see AGENT_SPEC.md §8b)
- Reuse the existing Skapi project "Starship Whisperer" (ID `5GJ5SJePWQUiq0jvYr-2ZVgaOLUqOhnse3Hcl8M4d`, eu-west-3, CORS `*`). Do not create a new project; the owner's decision.
- One user pool is shared with Starship Whisperer, so a Spellforge sign-up is also a Starship Whisperer account. Keep Spellforge data in its own tables, prefixed `spellforge_` (`spellforge_spellbook`, `spellforge_hall`).
- The project only lets signed-in users read; don't change that project-wide setting (it also governs Starship Whisperer).
- Never test against the real project with writes: `tools/ui-test.mjs` routes the SDK to a stand-in.
- Pages deploys via `.github/workflows/deploy.yml` (build_type=workflow); a push to `main` publishes.
