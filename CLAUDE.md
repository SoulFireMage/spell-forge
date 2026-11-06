Please always merge to main. This is going to be a GitHub Pages site, so whatever permissions are required to allow you to do that, you can assume they're given here, especially for merging to main and pushing.

We have existing infrastructure and template stuff for how to do the nuts and bolts of this. If you use the Starship Builder site and our usual root of skapi.com and GitHub Pages to produce yet another site.

Thank you. 
## Working notes (for agents)
- Deploys from `main` (GitHub Pages, branch, root). Merge work into `main` and push.
- Before pushing a site change: `node tools/version.mjs` (bumps the version stamped into every module URL), then `npm test` and `node tools/ui-test.mjs`.
- Read `AGENT_SPEC.md` before changing the compiler, the genome or the Laws. Any genome in range must compile to one watertight body; `npm test` enforces it.
- Every manifold-3d object goes through `Scope.k()`; the test fails on leaks.
- An AI project built by Claude; keep that credit in the README and the page footer.
