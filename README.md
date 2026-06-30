# alem-world.github.io

The project page and leaderboard for **[Alem](https://github.com/alem-world/alem-env)** —
a JAX benchmark for open-ended multi-agent coordination
(*Benchmarking Open-Ended Multi-Agent Coordination in Language Agents*).

This is the **org GitHub Pages site**, served live at **<https://alem-world.github.io/>**.

It is a **self-contained static site** — plain HTML, CSS and vanilla JS, no build step.
All content is driven by JSON in [`data/`](data/), so updating results never touches the markup.
All asset paths are relative, so it works at the domain root or under a subpath unchanged.

## Run locally

The pages `fetch()` JSON over HTTP, so serve over a local server (not `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Structure

```
index.html              # the project page (hero, leaderboard, gameplay, environment, results, cite)
leaderboard.html        # standalone leaderboard page
traces.html             # index of the full off-site reasoning-trace viewers
assets/css/style.css    # design system (Geist / Geist Mono, light "best-paper" aesthetic)
assets/js/app.js        # leaderboard render, sorting, model-config modal, in-page trace viewer
assets/img/             # logo/mark (SVG), demo GIFs, paper figures (assets/img/paper/)
assets/video/           # hero + difficulty reels, per-model gameplay clips (assets/video/play/)
assets/system_prompt.txt
data/leaderboard.json   # all results + model metadata   ← edit this to update the board
data/rl_results.json    # MARL baseline table
data/llm-run-configs.json  # real wandb run configs shown when a leaderboard score is clicked
data/traces/*.json      # compact per-model step traces for the in-page viewer
data/trace_sizes.json   # index for traces.html
```

## Updating the leaderboard

Edit [`data/leaderboard.json`](data/leaderboard.json). Each entry holds `[mean, ci_low, ci_high]`
for Base / Coord / Total at each difficulty. Add a model under `homogeneous` (LLMs) or `marl`
(baselines); the table, sorting, ranks and CI bars update automatically. Submissions follow
[`SUBMISSION.md`](https://github.com/alem-world/alem-env/blob/main/SUBMISSION.md) in the main repo.

## Full reasoning traces

`traces.html` links to large self-contained debug viewers hosted on Cloudflare R2
(`https://pub-74f4d738bad14571bd2d3355cb14acb7.r2.dev/traces/v1/<model>.html`). The base URL is
set once as `FULLLOG_BASE` in both `traces.html` and `assets/js/app.js`. The compact in-page
viewer (`data/traces/*.json`) is the fast path and ships in this repo.

## Deploy (GitHub Pages)

Pushing to `main` publishes the repo root via the workflow in
[`.github/workflows/pages.yml`](.github/workflows/pages.yml).

In the repo settings, set **Pages → Build and deployment → Source: GitHub Actions** (one-time).
The site is then live at <https://alem-world.github.io/>.

> Alternatively you can use **Source: Deploy from a branch → `main` / root** and delete the
> workflow — for a plain static site at the root either approach works.
