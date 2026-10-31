# Performance exploration: koi-ascii, October 2026

The branch `perf/explore-2026-10-28` against origin/main 23cd98e, measured from 2026-10-22 to 2026-10-28 on one machine. Paths under `.claude/perf-lab/` name the evidence lab on that machine: the raw JSON and stdout of every measurement, with the scripts that produced them. The lab is git-excluded and is not part of this repository, so the paths are references for the maintainer, not links.

- [Summary](#summary)
- [Environment](#environment)
- [Cost map](#cost-map)
- [Perf changes](#perf-changes)
- [Combined result](#combined-result)
- [Architecture/design updates](#architecturedesign-updates)
- [Proposals not landed](#proposals-not-landed)
- [Rejected](#rejected)
- [Unproven](#unproven)
- [Gaps](#gaps)
- [Rounds log](#rounds-log)

## Summary

This report covers a three-round exploration of where the pond spends GPU, CPU and start-up time, all measured on one machine (RX 9060 XT, radeonsi via ANGLE-GL; see Environment). The branch lands 30 perf commits and three measuring tools. Every perf commit is pixel-identical to origin/main in the 147-cell `shots` gate, and none changes the public API in `src/index.ts`. The report also keeps what did not land: three public-API proposals with their measured benefit, 27 candidates that were implemented and rejected, and the claims that stay unproven.

### What landed

| area | commits | what changed |
|---|---|---|
| ascii pass | 9 | float cell divide and exact float products in place of `ivec2` divides and integer multiplies; the pixel position from a varying, not `gl_FragCoord`; uniform branches for the look tail and the ramp stops; per-segment ramp steps from the CPU; the border test on the cell index; a cheaper halo sample, skipped when the glow target is clear |
| glow pass | 4 | a float32 emission pre-pass in place of re-evaluating emission per tap; branch-free taps on a zero-bordered target; one clear when the halo goes off |
| scene pass | 6 | the fish drawn as a second layer of the same program; trail chunk boxes, built on the CPU, with trails ending at age 0.85; the trail loop unrolled by 4; an eye-reach gate on `refrAt`; a branch-free closest-segment search |
| ripple pass | 1 | the texel position from the shared `pixel.vert` varying |
| start-up | 1 | the scene's shadow and trail-chunk loops kept rolled, so the scene program links faster |
| CPU | 7 | koi pose tables, a bit-exact `Math.hypot` replica, no per-frame array literals, a reused `sampleBody` array, no `lightingAt` temporaries, and a lighting memo |
| bundle | 2 | `//` comments, indentation and trailing spaces stripped from the shipped GLSL |
| docs | 2 | `docs/scene-features.md` brought up to date with the branch (ae57938), and this report |
| tools | 6 | `npm run batch` (whole-batch GPU time), `npm run cpu` (CPU, allocation and time-advancing GPU per frame), `npm run startup` (compile, link and first frame), plus their CLAUDE.md lines, and a review fix to `startup.mjs --bundle` |

### Combined result against origin/main 23cd98e

Base and head alternate in one browser, each measured in two runs (Combined result has the details):

| measure | S1 1280×800 @1 | S2 2560×1440 @2 |
|---|---|---|
| frozen frame, GPU µs (`npm run perf`, median of 4 queries) | 88.44 → 43.26 (−51.0%) | 243.62 → 109.58 (−55.0%) |
| whole batch, GPU µs per advancing frame (`npm run batch`, MID) | 94.22 → 47.10 (−50.0%) | 245.55 → 112.78 (−54.1%) |
| allocated per frame (`npm run cpu -- --alloc`, MID) | 34,520 → 5,887 B (−82.9%) | 33,626 → 4,735 B (−85.9%) |
| minor GCs per 3000 frames (MID) | 60 → 21 | 62 → 23 |
| CPU step per frame (MID) | 0.0481 → 0.0407 ms: noise by the rule | 0.0497 → 0.0405 ms: noise by the rule |
| cold load to GPU done (`npm run startup`, `?seed=7`) | 276.67 → 230.32 ms (−16.8%) | 275.42 → 229.72 ms (−16.6%) |
| `dist/index.js`, gzip -9 | 46,839 → 43,248 B (−7.7%) | — |
| pixel gate (`npm run shots -- --base origin/main`, 9 groups) | 147 of 147 SAME | — |

Run 2 reproduces every row to within 1.4 percentage points. The CPU step row is the one that does not count as a win: every cell fell by 14.5% to 25.3%, but no cell beat twice the larger spread.

### Headline findings

- **At S2 the ascii pass is the frame.** On origin/main it is 86% of the S2 frame and 36% of the S1 frame. The scene, emission and glow passes work per cell, and the cell count is 10,374 at S1 and 10,584 at S2. The ascii pass works per device pixel, which is 14.4 times as many at S2. Per-pixel integer work was the largest single cost:
  - the `ivec2` cell divide: −54 µs at S2;
  - `gl_FragCoord`, which makes radeonsi set up the fixed-point position for every wave: −38 µs;
  - three quarter-rate `v_mul_lo_u32` multiplies: −19 µs.

  The ascii pass went 209.50 → 93.38 µs at S2.
- **The glow pass re-evaluated emission for every tap.** A float32 pre-pass stores it once per cell. Together with branch-free taps, glow went 22.78 → 5.50 µs at S1, plus 3.30 µs for the new emission pass.
- **Scene cost per frame sits in the background layer.** On the whole batch at S1, water, trail segments and the shadow's joint fetches cost 1 to 3 µs each, and the sky is below noise. Fish shading dominates only the per-draw timer of one isolated frame (Cost map ranks the regions by ablation). The landed scene changes took the scene pass from 33.28 to 18.94 µs at S1.
- **Per-draw timers miss part of the frame.** `npm run perf` times each draw, so it misses work between draws (clears, target switches) and can bill one draw's drain to the next. One rejected candidate, r2-ascii-bg-cell-layers, won 16 µs per draw at S2 but cost 58 to 76 µs more per frame on a whole-frame timer. That is why `npm run batch` now ships.
- **CPU cost showed up as allocation, not time.** Step time is too small and too noisy to move by the rule (about 0.05 ms a frame). Allocation fell by 82.9% at S1 and 85.9% at S2, most of it in the koi kinematics: pose tables −17 KB per frame, the `Math.hypot` replica −6 KB and its NaN return −3.5 KB.
- **Start-up is program link.** Keeping the scene's shadow and trail-chunk loops rolled cut cold load-to-GPU-done by 43 ms against its parent. At the tip, cold start-up is about 46 ms faster than origin/main, almost all of it in link: glow compile+link 34.6 → 7.5 ms and scene 139.9 → 122.2 ms.

### What did not land

- **Three public-API proposals.** Each is written up under Proposals not landed with its measured benefit and its migration cost:
  - `maxPixelRatio`: −35.5% of the S2 frozen frame (DUSK) and −32.6% of the S2 whole batch at a cap of 1.5;
  - a glow switch: −19% of the S1 whole batch with the halo off;
  - `maxFps`: −1.4 to −6.6 W of board power when capped below the display rate.
- **27 rejected candidates.** Rejected gives each one's numbers: no win beyond noise, a win that did not reproduce, a cost moved into start-up, or a pixel difference.

The exploration stopped after round 3 because the maintainer capped it there, not because it ran dry: round 3 still kept 11 of 18 candidates.

## Environment

Every timing in this report comes from one machine. Absolute numbers are comparable only within one run, because base and head alternate in one browser in each run. The clock-regime notes below explain why.

| item | value | evidence |
|---|---|---|
| GPU | AMD Radeon RX 9060 XT, radeonsi gfx1200, ACO compiler, reached through ANGLE on OpenGL ES 3.2 | `.claude/perf-lab/evidence/final/checks/browser.txt` line 4 prints `GPU: ANGLE (AMD, AMD Radeon RX 9060 XT (radeonsi gfx1200 ACO), OpenGL ES 3.2 Mesa 26.2.2-arch1.1)` |
| driver | Mesa 26.2.2-arch1.1 | same line |
| kernel | 7.2.5-3-omarchy | `uname -r`, run 2026-10-28 |
| browser | Chromium 156.0.8078.4 (Google Chrome for Testing, ms-playwright `chromium-1248`), headless, driven by Playwright 1.64.1 | `.claude/perf-lab/evidence/costmap.md` §1; `npx playwright --version` re-checked 2026-10-28 |
| GPU guard | every run goes through `test/browser/gpu.ts`, which refuses SwiftShader | CLAUDE.md "Browser checks" |
| node, npm, vite | v24.21.0, 11.19.0, 8.3.4 | `.claude/perf-lab/evidence/costmap.md` §1 (node re-checked 2026-10-28) |
| vitest | 5.0.5 (final check: 14 files, 203 tests pass) | `.claude/perf-lab/evidence/final/checks/checks.txt` |
| bundle tools | rolldown 1.2.14 (for the `-m` what-if), the TypeScript 6.0.3 scanner (for byte composition), gzip 1.14, brotli 1.2.0 | `.claude/perf-lab/evidence/r3/map/c.md` §3; `.claude/perf-lab/evidence/r3/map/c/bundle/bundle-size.txt` |

The costmap's environment table cites `baseline/env.txt`, but there is no `baseline/` folder under `.claude/perf-lab/evidence/`. The values above are the costmap's own table, plus the re-checks noted in the evidence column.

**Sizes** (`.claude/perf-lab/evidence/costmap.md` §1):

| size | CSS × DPR | device px | scene/glow cells | ripple grid |
|---|---|---|---|---|
| S1 | 1280×800 @1 | 1,024,000 (1.024 Mpx) | 182×57 = 10,374 | 257×161 |
| S2 | 2560×1440 @2 | 5120×2880 = 14,745,600 (14.75 Mpx) | 196×54 = 10,584 | 513×289 |

**Queries (Q4).** Every query carries `?debug`. The three fixed phases add `&time=fixed&phase=<p>&sky=all`.

| name | query |
|---|---|
| MID | `?debug` |
| NOON | `?debug&time=fixed&phase=0.5&sky=all` |
| DUSK | `?debug&time=fixed&phase=0.83&sky=all` |
| NIGHT | `?debug&time=fixed&phase=0&sky=all` |

The query strings are as printed in `.claude/perf-lab/evidence/r2/smoke/perf7.stderr` lines 2 and 14. Some runs add `palette=`, `view=raw` or `glow=off` to these.

**Measures.** The round-3 maps and proposals use four:

- **perf** (`npm run perf`) re-renders one frozen frame back to back and sums per-draw `TIME_ELAPSED` queries.
- **cpu.mjs --gpu** sums per-draw queries over advancing `koi.step` frames.
- **batch** (`scripts/batch.mjs`, named `batchq.mjs` in the lab) puts a whole batch of advancing frames in one query.
- **Lab-only tools** measure what the others cannot see: presented frames (`outside.mjs`, `present`) and 60 Hz pacing with board power (`paced.mjs`). Neither landed.

**GPU serial queue.** `.claude/perf-lab/bin/gpu-run` serialises every Playwright or timing command.

- It takes an exclusive `flock` on `.claude/perf-lab/gpu.lock`. The wait is `GPU_RUN_WAIT`, 480 s by default, and the command exits 75 on timeout.
- While holding the lock, it waits up to 60 s for any live ms-playwright Chromium. If one is still alive, it logs `REFUSED` and exits 76.
- It logs `START` and `END rc=…` lines to `.claude/perf-lab/evidence/gpu-queue.log`.
- Each measurement folder's `run.sh` wraps gpu-run and writes `sclk-<name>-{before,after}.txt` clock snapshots.
- **Log snapshot**, read at 2026-10-28T22:44:35 while the final perf run was still writing:
  - 2,017 `START` and 2,015 `END` lines, and 0 `REFUSED`;
  - 1,977 `END` lines with rc=0;
  - the first entry is 2026-10-27T18:28:03, so round 1 has no queue log;
  - the only long gap is 2026-10-28T05:30:13 → 18:17:53 (767 min), which is the round-3 pause and the 2026-10-28 reboot;
  - lock-wait timeouts (exit 75) happen before `START` and are not logged.

### Clock regimes

`npm run perf` frames are short bursts, so the µs it reports depend on how far DPM boosts the shader clock (sclk). The S1 regime changed at one of the boots after round 1 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26) and stayed the same through the 2026-10-28 reboot. S2 did not change. Every frame in the next table is the MID query.

| comparison | S1 frame (µs) | S2 frame (µs) | evidence |
|---|---:|---:|---|
| origin/main A/A, round 1 (before the reboot) | 67.70 | 242.94 | `.claude/perf-lab/evidence/costmap.md` headline |
| origin/main, map D (2026-10-28) | 88.48 | 243.60 | `.claude/perf-lab/evidence/r3/map/d.md` §1 |
| ratio | **1.307** | **1.003** | |
| origin/main, integration 1 measure 1 (round 1) | 67.12 ±2.08 | | `.claude/perf-lab/evidence/int-r1/final/perf1.md` line 49 |
| ratio to map D | **1.318** | | |
| round-1 stack tip de4b18c, round 1 | 46.40 ±0.72 | | `.claude/perf-lab/evidence/int-r1/final/perf1.md` line 49 |
| round-2 base d0a6f41, 2026-10-27, after the reboot | 61.20 | | `.claude/perf-lab/evidence/r2/smoke/perf7.stderr` line 10 |
| ratio | **1.32** | | |
| round-3 base 872e201, after the 2026-10-28 reboot | 46.92 / 46.84 (A/A) | | `.claude/perf-lab/evidence/r3/smoke/perf-reboot2-s1.stderr` line 10 |
| 872e201 in map D, before the 2026-10-28 reboot | 46.92 | 132.36 | `.claude/perf-lab/evidence/r3/map/d.md` §1 |

Notes on the table:

- d0a6f41 is de4b18c plus two commits: the koi pose tables (CPU only) and the GLSL `//` comment strip (shader text only). The 46.4 → 61.2 comparison is therefore close to like for like.
- **Four-query medians.** Over MID, NOON, DUSK and NIGHT, origin/main's S1 frame is 67.28 µs in integration 1 (`.claude/perf-lab/evidence/int-r1/integration.md` line 81) and 88.74 µs in map D (the median of the S1 frame rows at `.claude/perf-lab/evidence/r3/map/d.md` lines 91, 96, 102 and 107), about 1.32. Pair a MID value only with a MID value.
- **Clock in S1 bursts.** These are samples with `busy > 50`, taken from hwmon traces:

  | trace | date | n | sclk min / p50 / max (MHz) | trace max (MHz) | evidence |
  |---|---|---:|---|---:|---|
  | round 2 | 2026-10-27 18:29 | 14 | 1691 / 1736 / 1746 | 1761 | `.claude/perf-lab/evidence/r2/smoke/clock-s1.tsv` |
  | round 3, after the 2026-10-28 reboot | 2026-10-28 18:18 | 5 | 1553 / 1731 / 1735 | 1760 | `.claude/perf-lab/evidence/r3/smoke/clock-reboot2-s1.tsv` |

  The round-3 summary states "Same clock regime as map D (S1 tip frame 46.92 µs, busy sclk p50 1731 MHz)" (`.claude/perf-lab/evidence/r3/summary.md` line 3).
- **Round 1 was the faster regime at S1, not the slower one.** A session observation, not backed by a lab file, puts round 1's S1 bursts at about 2.2-2.4 GHz. No clock trace from round 1 survives, so that figure has no raw evidence.
- **S2 is unaffected.** `.claude/perf-lab/evidence/r2/r2-koi-hypot-replica/measure.md` line 64 says "the 1.33x clock regime does not show at S2", and the S2 ratio in the table above is 1.003. No measurement explains why.
- **One claim is not settled.** `.claude/perf-lab/evidence/r2/int/r2-cpu-alloc-literals/run1.md` lines 88-92 read a uniform shrink of every pass as a return to the faster clock. That run's parent already included round-2 shader gains, so the evidence does not separate the two causes.
- **The `sclk-*-before/after.txt` snapshots** are taken at idle. They cannot show the in-burst boost; only the hwmon traces can.
- **Lighter frames clock down.** This makes GPU µs non-monotonic when work is removed:
  - r3-p1 at cap 1 shows scene, emission and glow at +8.2, +1.2 and +2.1 µs although none of their work changed.
  - At cap 1.25, the whole batch is slower than at cap 1.5.
  - The evidence is `.claude/perf-lab/evidence/r3/proposals/r3-p1-max-pixel-ratio/proposal.md` §5.
- **Real pacing costs more per frame than back to back.**
  - On origin/main in round 1 (pre-reboot S1 regime), a paced frame costs 92 and 132 µs at S1 (120 and 60 fps) and 402 and 652 µs at S2. perf measures 68-76 and 243-248 µs back to back. That is 1.2-2.7x (`.claude/perf-lab/evidence/r1/proposals/p3-max-fps/proposal.md`, "Against the proposal's estimate").
  - On 872e201 at S2 and 60 Hz, a frame costs 648.28 / 650.96 µs, against 132.3 µs back to back (r3-p1 proposal §3).

### Noise floor

The round-1 baseline ran origin/main against itself (A/A): 2 rounds × 7 runs × 2 sides, 28 run medians per cell. The floor per cell is the largest of the run-to-run spread, the A/A delta and the shift between rounds. The GPU timer steps in 0.04 µs. These numbers are from the faster pre-reboot clock regime at S1 (Clock regimes above). Use them as the shape of the noise, not as current µs (`.claude/perf-lab/evidence/costmap.md`, "Noise floor per pass").

| size | query | scene | glow | ascii | frame (µs) | CPU submit (ms) |
|---|---|--:|--:|--:|--:|--:|
| S1 | MID | 0.12 | 0.48 | 1.56 | 1.88 | 0.0003 |
| S1 | NOON | 0.08 | 0.36 | 1.44 | 1.88 | 0.0005 |
| S1 | DUSK | 0.72 | 0.84 | 3.16 | 4.84 | 0.0028 |
| S1 | NIGHT | 0.16 | 0.40 | 1.56 | 2.20 | 0.0013 |
| S2 | MID | 0.04 | 0.04 | 0.48 | 0.76 | 0.0025 |
| S2 | NOON | 0.04 | 0.04 | 0.56 | 0.72 | 0.0008 |
| S2 | DUSK | 0.40 | 0.04 | 0.84 | 1.32 | 0.0028 |
| S2 | NIGHT | 0.08 | 0.04 | 0.72 | 1.04 | 0.0037 |

- **S1 is the noisier size.** S1 never reaches the top clock state, and its ascii and glow rows are bimodal per page load (ascii about 24.2 or 25.6 µs), which widens the S1 spread to about 1.4 µs.
- **Advancing frames** (`npm run cpu -- --gpu`, 14 runs): the frame floor is 2.88 µs at S1 MID and 1.40 µs at S2 MID. The step CPU floor is 0.0097 ms at S1 MID and 0.0108 ms at S2 MID.
- **In the final run** (round-3 regime), the largest win threshold (2 × spread) over the four standard queries was 5.20 µs at S1 and 5.52 µs at S2 for the frozen frame. On the whole batch it was up to 28.24 µs at S1 (glow=off; the base side's spread) and 7.96 µs at S2 (Combined result).

### Reproduce

Run these from a checkout of the branch. Every tool starts and stops its own Vite servers and checks out `--base` in a temporary worktree. Only one may run at a time; the lab serialised them with `gpu-run`, described above. S1 is `--size 1280x800 --dpr 1` and S2 is `--size 2560x1440 --dpr 2`. Run 2 of the perf, batch and cpu blocks used the queries in reverse order and `--runs 9`, except the `--alloc` command, which kept `--runs 7`. Start-up run 2 repeated run 1's command.

```bash
# frozen frame, GPU µs per pass (run once per size)
npm run perf -- '?debug' '?debug&time=fixed&phase=0.5&sky=all' '?debug&time=fixed&phase=0.83&sky=all' '?debug&time=fixed&phase=0&sky=all' '?debug&palette=mono' '?debug&palette=paper' '?debug&palette=brand' '?debug&glow=off' '?debug&intensity=0.5' '?debug&view=raw' --base origin/main --runs 7 --size 1280x800 --dpr 1
# whole batch, GPU µs per advancing frame
npm run batch -- '?debug' '?debug&time=fixed&phase=0.5&sky=all' '?debug&time=fixed&phase=0.83&sky=all' '?debug&time=fixed&phase=0&sky=all' '?debug&palette=mono' '?debug&palette=paper' '?debug&glow=off' --base origin/main --runs 7 --size 1280x800 --dpr 1
# CPU step, allocation, and time-advancing GPU per pass
npm run cpu -- '?debug' '?debug&time=fixed&phase=0.83&sky=all' --base origin/main --runs 7 --size 1280x800 --dpr 1
npm run cpu -- '?debug' '?debug&time=fixed&phase=0.83&sky=all' --base origin/main --runs 7 --no-step --alloc --size 1280x800 --dpr 1
npm run cpu -- '?debug' '?debug&time=fixed&phase=0.83&sky=all' --base origin/main --runs 7 --no-step --gpu --size 1280x800 --dpr 1
# start-up: compile, link, first frame
npm run startup -- '?seed=7' '?debug' --base origin/main --runs 7 --size 1280x800 --dpr 1
# bundle: build each side, then compare dist/index.js raw, gzip -9 and brotli -q 11
npm run build
# pixel gate: the 9 shots groups, all SAME
npm run shots -- --base origin/main --sheet
npm run shots -- --base origin/main --palettes pond,mono,phosphor,amber,paper,brand --sky default,none,all --phases 0,0.05,0.25,0.5,0.8,0.83
npm run shots -- --base origin/main --size 1280x800 --dpr 2 --palettes pond,paper --sky default,all --phases 0.05,0.5,0.83
npm run shots -- --base origin/main --size 2560x1440 --dpr 1 --palettes pond --sky all --phases 0.05,0.5,0.83
npm run shots -- --base origin/main --query view=raw --sky all --phases 0.05,0.5,0.83
npm run shots -- --base origin/main --query glow=off --sky all --phases 0.05,0.5,0.83
npm run shots -- --base origin/main --query intensity=0.5 --palettes pond,phosphor,paper --sky all --phases 0.05,0.5
npm run shots -- --base origin/main --reduced-motion --sky all --phases 0.05,0.5,0.83
npm run shots -- --base origin/main --seed 7 --frames 300 --palettes pond,brand --sky all --phases 0.05,0.5,0.83
# checks
npm run typecheck && npm test && npm run test:browser
```

The lab rule for a win: an improvement larger than 2 × max(base spread, head spread) on the targeted pass at one size or more, with no loss beyond noise at the other, reproduced by a second run, SAME in all 147 gate cells, and the checks green.

### Shas in this report

Two sets of shas appear. PR shas are the commits on this branch. Lab stack shas are commits on the local integration branch `perf-int/r1`, which is not pushed. Each increment there was measured against its parent, except rows 5-9, which were measured on per-area chains (Perf changes). Each PR commit has the same tree as its stack commit (`git rev-parse <sha>^{tree}`), so a measurement of one is a measurement of the other. The stack tips the rounds log names are: de4b18c (after integration 1, PR `f839bf4`), d0a6f41 (after the fix stage, PR `083cb00`), 872e201 (after round 2 and the base of round 3, PR `7835893`) and 431e4c3 (after round 3, PR `0378378`).

<details><summary>PR commit ↔ lab stack commit (30 rows)</summary>

| # | PR commit | lab stack commit | candidate id |
|---|---|---|---|
| 1 | `41477d0` | `89576b7` | r1-ascii-float-celldiv |
| 2 | `c78f160` | `70187bf` | r1-ascii-look-branch |
| 3 | `c256ed1` | `9829f6c` | r1-ascii-glow-skip-cleared |
| 4 | `3682557` | `6690267` | r1-ascii-glow-lod |
| 5 | `3cbb8ec` | `443f903` | r1-glow-emission-prepass |
| 6 | `164191e` | `edf15eb` | r1-glow-branchfree-taps |
| 7 | `2e9040f` | `b92562c` | r1-scene-trail-chunk-boxes |
| 8 | `3440a41` | `321d7de` | r1-scene-trail-unroll |
| 9 | `f839bf4` | `de4b18c` | r1-scene-eye-gate |
| 10 | `2728924` | `398ec7e` | r1-bundle-strip-glsl-comments |
| 11 | `083cb00` | `d0a6f41` | r1-koi-pose-v235 |
| 12 | `599ed76` | `562ba24` | r2-ascii-pos-varying |
| 13 | `f067572` | `a97e72f` | r2-ascii-ramp-uniform-select |
| 14 | `2a26f5b` | `abe91cc` | r2-scene-layer-split |
| 15 | `9045b8f` | `7579d58` | r2-koi-hypot-replica |
| 16 | `28e921b` | `a7f61ab` | r2-scene-polyline-branchfree |
| 17 | `138a369` | `0521df5` | r2-glow-zero-pad-emit |
| 18 | `f693868` | `14c2fcd` | r2-cpu-alloc-literals |
| 19 | `7835893` | `872e201` | r2-bundle-glsl-indent-strip |
| 20 | `dad7b85` | `852b32a` | r3-ascii-fmul |
| 21 | `e22d7b4` | `2f8d717` | r3-startup-ir-diet |
| 22 | `f372e94` | `b53494f` | r3-cpu-hypot-nan |
| 23 | `c3160b7` | `70d0d86` | r3-scene-trail-cull |
| 24 | `3390812` | `861cd80` | r3-glow-clear-once |
| 25 | `8e4b418` | `4a95fa2` | r3-ascii-ramp-float-index |
| 26 | `d05daa2` | `d287d5f` | r3-cpu-samplebody-scratch |
| 27 | `6fb0e99` | `93576c3` | r3-cpu-lighting-temps |
| 28 | `3e62b1d` | `3360d40` | r3-cpu-lighting-memo |
| 29 | `c9386da` | `ac5eff6` | r3-ascii-border-on-cell |
| 30 | `0378378` | `431e4c3` | r3-ripple-pos-varying |

</details>

## Cost map

### How to read this map

Where the pond's GPU, CPU, start-up and bundle costs go; round 3 planned from it.

**Setup.**

- **Machine.** RX 9060 XT, radeonsi gfx1200 (ACO) via ANGLE-GL, Mesa 26.2.2, Playwright Chromium (`.claude/perf-lab/evidence/costmap.md` §1).
- **Sizes.** S1 is 1280×800@1: 1.024 Mpx, 10,374 cells and a 257×161 ripple grid. S2 is 2560×1440@2: 14.75 Mpx, 10,584 cells and a 513×289 ripple grid.
- **Queries.** MID is `?debug`. NOON is `?debug&time=fixed&phase=0.5&sky=all`, and DUSK and NIGHT use phase 0.83 and 0. mono, paper and raw are palettes or views, and INT is intensity 0.7.

**Two clock regimes: compare absolute µs only within one run.**

- **Round 0 is pre-reboot.** Round 0 is the baseline map of origin/main that opened round 1 (other sections call it the round-1 baseline map); its file is `.claude/perf-lab/evidence/costmap.md`. It ran before the reboot after round 1 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26). S1 moved into the slower-clock regime at one of the boots after round 1; the 2026-10-28 reboot did not change the regime (Environment, Clock regimes). Its S1 numbers are about 1.3× lower than the same commit in round 3: the S1 MID frame is 67.70 µs against 88.48 in map D, ×1.307 (`.claude/perf-lab/evidence/r3/map/d/tables.md`). S2 happened to agree (242.94 against 243.60), which does not license comparing them.
- **What each run is used for.** Round-0 tables give only shares and within-run drops. Every origin/main-against-872e201 figure comes from map D: one process, base and head alternating, round-3 regime.
- **Candidate outcomes in this map are measure-stage numbers.** The "fed" labels below (for example r3-ascii-fmul −19.88, r3-scene-trail-cull −1.72, r3-glow-clear-once −1.81, r3-ascii-ramp-float-index −8.80, r3-ascii-border-on-cell −0.52 / −2.72, the r3-cpu-* allocation drops and r3-startup-ir-diet 267.33 → 227.05) come from `.claude/perf-lab/evidence/r3/summary.md`, each measured against its own parent on the 872e201 line. The integration numbers that back the landed commits are in Perf changes, and they differ.
- **No per-pixel comparisons across sizes.** S1 never reaches the top sclk state; S2 runs at about 2.9–3.2 GHz (`.claude/perf-lab/evidence/map-gaps/gaps.md`).

**Three GPU instruments.**

| instrument | what it times |
|---|---|
| `npm run perf` | one timer query per draw on a frozen frame, with no ripple and no simulation |
| `cpu.mjs --gpu` | one timer query per draw on advancing frames, which adds the ripple row |
| whole batch (lab files `batchq-*` and `tip-batch-*`; shipped as `scripts/batch.mjs`) | one TIME_ELAPSED query over 30 advancing frames, divided by 30, with no per-draw queries |

**Per-draw and whole-batch timing differ by construction.**

- **The scene is two overlapping draws.** Since r2-scene-layer-split it is two draws of one program, layer 0 the background and layer 1 the fish, which overlap on the GPU. Per-draw timers make the fish draw the critical path; a whole batch measures total work.
- **Timers absorb drains.** A per-draw timer absorbs the previous draw's drain, as the radeonsi TIME_ELAPSED begin appears to be top-of-pipe (`.claude/perf-lab/evidence/r2/map/c.md`). The S1 emission row rises 0.76–1.16 µs whenever a fish-layer switch shortens the scene (`.claude/perf-lab/evidence/r3/map/b.md`, "Cross-pass attribution").
- **The batch reads below the per-draw sum:** by 1–3 µs on 872e201, and by 6.3–7.1 µs on origin/main at S2 (`.claude/perf-lab/evidence/r3/map/d.md`).

**The ablation method.**

- **The switches.** `?ablate=X` becomes `#define ABL_X` in a throwaway worktree: perf-ablate-r3a (1946735, bbd9ff2) for map A, perf-ablate-r3b (c07b8d1, ae2f062) for map B.
- **The drop.** The switch removes region X and the output it feeds; base and head alternate in one browser, `--runs 7`. **Drop = base − head**, an upper bound for any output-preserving rewrite of X.
- **Drops do not add up.** Removing a region also removes work gated on it, changes register pressure and moves drains between timers.
  - Round 0's scene parts summed to 84% / 86% of `scene_empty`, and the fish sub-parts to 112–119% of `fish` at S1.
  - In map A, `ascii_local` + `ascii_atlasaddr` = 3.2 / 26 µs, but the exact rewrite of both (r3-ascii-fmul) recovers 2.3 / 17–19.
  - Switches also act across passes. `ascii_empty` slows the scene timer by 6.7–8.4 µs at S2 (map A), and on origin/main `scene_empty` made glow 4.40 µs faster at S2 (round 0).
- **The win rule.** A change counts when |Δ| > 2 × max(spread base, spread head). On a null set it gave no false positives in 48 cells per pass (0/24 at each size); a lone "p" mark (only the rank-sum permutation p < 0.01) has about a 4% rate (`.claude/perf-lab/evidence/map-gaps/gaps.md`).

### GPU per pass: origin/main against 872e201

Map D measured origin/main (23cd98e) against 872e201 (round-2 tip, round-3 base) in one run. The final tip's per-pass numbers are in Combined result.

MID, µs, median of 7 runs ± spread:

| pass | S1 origin/main | S1 872e201 | S2 origin/main | S2 872e201 |
|---|--:|--:|--:|--:|
| ripple (advancing only) | 4.36 ±0.04 | 4.28 ±0.08 | 4.48 ±0.04 | 4.48 ±0.08 |
| scene | 33.28 ±0.20 | 19.68 ±0.08 | 18.80 ±0.04 | 11.36 ±0.12 |
| emission (pre-pass from r1-glow-emission-prepass) | — | 3.36 ±0.16 | — | 1.92 ±0.00 |
| glow | 22.88 ±0.24 | 5.60 ±0.16 | 15.40 ±0.00 | 3.08 ±0.04 |
| ascii | 31.72 ±0.32 | 18.36 ±0.20 | 209.32 ±1.24 | 115.92 ±0.88 |
| frame, frozen, per-draw sum | 88.48 ±0.56 | **46.92** ±0.60 (−47.0%) | 243.60 ±1.16 | **132.36** ±1.04 (−45.7%) |
| frame, advancing, per-draw sum | 94.24 ±2.36 | 51.48 ±0.36 | 249.44 ±0.96 | 137.24 ±2.04 |
| whole batch, advancing | 96.89 ±7.95 | 50.49 ±0.78 | 245.73 ±1.68 | 135.66 ±2.66 |

Sources, all in `.claude/perf-lab/evidence/r3/map/d/` (tabulated in `tables.md`): `tip-perf-s1.json` and `tip-perf-s2.json` for frozen frames (verdict WIN-A in `verdict-perf.txt`), `tip-cpugpu-s1.json` and `tip-cpugpu-s2.json` for advancing frames, and `tip-batch-s1.json` and `tip-batch-s2.json` for the whole batch.

**Shares at 872e201.**

- **S1 is split between two passes:** scene 41.9%, ascii 39.1%, glow 11.9%, emission 7.2%.
- **At S2, ascii is the frame:** ascii 87.6%, scene 8.6%, glow 2.3%, emission 1.5%.
- On origin/main, ascii was 35.8% at S1 and 85.9% at S2.
- **Why.** The cell count barely changes between sizes, so scene, emission and glow cost about the same at both; ascii shades every device pixel.

**Caveats.**

- `npm run perf` yields every 20 redraws, which can add up to 1.9 µs to the S2 scene row (`.claude/perf-lab/evidence/r3/map/d.md`).
- Advancing S1 DUSK fly went from 0.04 to 0.20 µs. The rule calls that a loss: 0.16 against a threshold of 0.08 (`tip-cpugpu-s1.json`).

<details><summary>Other palettes and views (map D, origin/main → 872e201, µs)</summary>

| query | S1 ascii | S1 frame | S2 ascii | S2 frame | S1 / S2 batch |
|---|---|---|---|---|---|
| mono | 39.92 → 24.48 | 96.96 → 53.00 | 269.40 → 164.32 | 303.60 → 180.88 | 101.05 → 56.76 / 306.37 → 184.26 |
| paper (no glow) | 30.68 → 16.88 | 64.24 → 36.64 | 209.00 → 104.88 | 228.12 → 116.20 | — |
| raw | 23.96 → 13.44 | 57.32 → 33.16 | 152.36 → 80.36 | 171.08 → 91.60 | — |

NOON, DUSK and NIGHT stay within 1 µs of MID on every frozen row at 872e201. Their whole batch is 50.70–51.25 at S1 and 136.32–137.51 at S2 (origin/main 93.65–97.97 / 245.95–246.03). Sources: `.claude/perf-lab/evidence/r3/map/d/tip-perf-s*.json`, `tip-batch-s*.json`.

</details>

### Scene pass by region (872e201, map B)

**The base and its overlap.**

- **Base.** The MID scene is 19.68 µs at S1 and 11.44 at S2 (map D, a separate run, gives 11.36 ±0.12 at S2). Per-draw that is bg 14.28 + fish 5.28 at S1 and 8.56 + 2.84 at S2.
- **Use the summed row.** The bg/fish split is a timeline partition and noisy: at S1 the null spread is 0.76 on bg and 0.92 on fish, against 0.20 on the sum.
- **Overlap model** (`.claude/perf-lab/evidence/r3/map/b/perf-s*-b1.json`, `-b2`, `-b16`), S1 / S2 µs:
  - the bg draw alone costs 14.04 / 8.60, and the fish draw on a constant bg 14.40 / 8.36;
  - the two draws overlap by 6.88 / 4.64;
  - `scene_empty` leaves a 2.44 / 1.40 spine, and the second draw's fixed cost is 0.56 / 0.52.

**Ranked by whole-batch S1**, the instrument without per-draw queries; every value is an upper bound. Batch S1 spans MID to DUSK, batch S2 shows only where it resolved (s = one query separated: every head run lies on one side of every base run, exact p = 0.0006), n = inside the noise, per-draw is the MID scene sum.

<details><summary>Scene regions ranked by whole-batch S1 (12 rows)</summary>

| # | region | batch S1 | batch S2 | per-draw S1 / S2 | round-3 candidate it fed |
|---|---|--:|--:|--:|---|
| — | `scene_empty` (whole pass to a constant) | 17.82–18.41 | 9.54–9.92 | 17.24 / 10.04 | — |
| 1 | background draw, whole (`bg_empty`) | 5.60–6.73 | 2.00 s | 5.28 / 3.08 | — |
| 2 | water (fbm 1.14–1.60, caustic 1.44–1.45) | 2.58–3.63 | 2.94 s | 2.32 / 1.20 | none: rewrites under threshold or not exact |
| 3 | trails (per-segment work 2.23–3.02) | 2.82–3.03 | 2.33 s | 1.08 / 0.56 | r3-scene-trail-cull (WIN, S1 DUSK batch −1.72) |
| 4 | polyline joint fetches, shadow and fish (`polyline_math` alone 0.11 n) | 1.93–2.05 | n | 5.68 / 3.00 | — |
| 5 | shadow loop (its polylines 1.40–1.55) | 1.25–1.79 | 1.86 s | 0.80 / 0.20 | — |
| 6 | glyph pick | 1.29–1.40 | n | 1.56 / 0.52 | — |
| 7 | fish draw, whole (`fish_draw_skip`) | 0.72–1.38 | n | 5.64 / 2.84 | r3-scene-drawfish-fetch-hoist (LOSS) |
| 7a | fish-wave regions: `fish_body` 0.50–0.55, `fish` 0.44–0.46, the rest ≤0.99 n | ≤0.55 | n | see details | r3-scene-eye-refr-vs (LOSS) |
| 8 | ripple-texture sample, both draws | 0.94–1.06 | n | 0.80 / 0.52 | — |
| 9 | sky (stars, moon, sun) | n | n | 0.24 n / 0.12 n | — |
| — | fly pass, whole | — | — | ≤0.08 / ≤0.12 | — |

</details>

Sources: `.claude/perf-lab/evidence/r3/map/b/batchq-s1*.json`, `batchq-s2*.json` (`bqtable.json`), `perf-s1-b*.json` and `perf-s2-b*.json`, with the file for each row in `.claude/perf-lab/evidence/r3/map/b.md`. The outcomes are in `.claude/perf-lab/evidence/r3/summary.md`.

**INVERSE switches measure what the existing gates save:**

- **`fish_nobox`** (the fish bbox early-out): 4.10–4.87 batch at S1 and 3.40–5.18 at S2, and 3.56 / 1.92 per-draw.
- **`trail_cbox`** (the trail chunk boxes): 1.55–2.22 batch at S1, and 0.28 / 0 per-draw.
- **`eye_gate`**: 0.92 / 0.56 per-draw.

**Why the instruments rank differently.** The cell-gate model gives these lane → wave64 shares at S1: fish bbox 22.3% → 32.1%, body shading 3.7% → 13.6%, shadow box 24.4% → 32.1%, trail tbox 11.2% → 17.4%, eye 2.85% → 7.6% (`.claude/perf-lab/evidence/r3/map/b/cell-gates-S1.json`, `cell-gates-S2.json`).

- **Fish-layer work** is the tail of the pass. Per-draw it counts in full, 0.44–5.28 per region. Whole-batch it hides behind other waves, ≤0.55 per region.
- **Trails and shadow** lengthen the bg timer but shorten the fish timer, so per-draw they move the sum only 1.08 and 0.80. Whole-batch they cost in proportion to their waves.
- **Water and glyphs** run on every cell and cost throughput under both.

So per frame, the levers are in layer 0: water, trail segments and the shadow's joint fetches, 1–3 µs each at S1. Fish shading matters only for the latency of one isolated frame.

<details><summary>Per-draw MID scene-sum drops, all switches (872e201, µs, S1 / S2)</summary>

| switch | S1 / S2 | switch | S1 / S2 | switch | S1 / S2 |
|---|---|---|---|---|---|
| scene_empty | 17.24 / 10.04 | fish_tail | 3.32 / 1.80 | fish_pec | 1.24 / 0.72 |
| polyline | 5.68 / 3.00 | fish_markings | 2.44 / 1.44 | eye_refr | 1.20 / 0.60 |
| fish_draw_skip | 5.64 / 2.84 | water | 2.32 / 1.20 | trails | 1.08 / 0.56 |
| bg_empty | 5.28 / 3.08 | fish_eyes | 1.68 / 0.88 | fish_caustic | 0.96 / 0.40 |
| fish_body | 5.28 / 2.80 | glyphs | 1.56 / 0.52 | water_caustic | 0.88 / 0.52 |
| fish | 4.96 / 2.72 | water_fbm | 1.48 / 0.92 | shadow / trail_segs / ripple_sample | 0.80 / 0.20, 0.80 / 0.36, 0.80 / 0.52 |
| fish_inner | 4.72 / 2.28 | tail_grad | 1.44 / 0.72 | shadow_poly / fish_shade | 0.52 / 0.08, 0.44 / 0.20 |
| polyline_math | 4.16 / 2.04 | sky | 0.24 n / 0.12 n | | |

Sources: `.claude/perf-lab/evidence/r3/map/b/perf-s1-b1.json` to `perf-s1-b16.json` and the S2 files. They are tabulated in `.claude/perf-lab/evidence/r3/map/b.md`, "Switch table".

</details>

<details><summary>Round 0, origin/main, pre-reboot regime: scene drops (shares only)</summary>

On origin/main the scene was one draw. Drops at S1 / S2 MID, µs: `scene_empty` 23.64 / 17.68; polyline 8.56 / 7.36, fish 8.24 / 7.96, trails 6.96 / 4.72, fish_body 4.88 / 4.20, fish_tail 2.96 / 2.20; water, shadow, glyphs and the eyes 0.7–1.6 each; sky ≤0.36 ("p" only).

r1-scene-trail-chunk-boxes, r1-scene-trail-unroll, r2-scene-polyline-branchfree and r2-scene-layer-split went after the leaders. Source: `.claude/perf-lab/evidence/costmap.md` §3; the raw `ablation/ablation.json` is not in the lab.

</details>

### ascii pass by region (872e201, map A)

**Base.** ascii is 18.32–18.36 µs at S1 and 115.84–116.32 at S2; on mono it is 24.44 and 164.24.

**Floors.** Each floor replaces the whole shader:

| floor | S1 µs | S2 µs | what it shows |
|---|--:|--:|---|
| `ascii_empty`: constant colour, no input | 7.16–7.20 | 69.88–69.96 | launch and export: 39% / 60% of the pass |
| `ascii_emptypos`: reads the `vPx` varying | 12.28 | 77.88–78.20 | the varying adds 5.1 / 8.0–8.3 per draw |
| `ascii_emptyfc`: reads `gl_FragCoord` (the input before r2-ascii-pos-varying) | 20.96–21.00 | 149.08–149.20 | more than the whole current pass |
| `ascii_emptyvar`: `vPx` to an incompressible colour | 12.28 | 136.28–154.52 | +50.50 whole-batch at S2: the pass relies on colour compression |

Whole-batch (`.claude/perf-lab/evidence/r3/map/a/batchq-summary.txt`), `ascii_empty` saves 10.77 at S1 and 33.28 at S2.

**Regions.** The body above the varying floor is 6.0 µs at S1 and 38.5 at S2. The table gives per-draw drops on the pond queries:

<details><summary>ascii regions, per-draw drops on the pond queries (12 rows)</summary>

| # | region | S1 µs | S2 µs | round-3 candidate it fed |
|---|---|--:|--:|---|
| 1 | ink chain (fetch latency into the export) | 4.36–4.44 | 34.00–34.76 | — |
| 2 | `ascii_local`: two 32-bit integer multiplies | 2.16–2.20 | 17.72–19.24 | r3-ascii-fmul |
| 2′ | `ascii_fmul`: exact float rewrite of rows 2 and 5 | 2.28–2.32 (batch 2.40) | 16.88–19.48 (batch 18.33) | r3-ascii-fmul (WIN, S2 NIGHT ascii −19.88) |
| 3 | `ascii_halo`: bilinear halo sample and coordinate | 1.40–1.52 | 11.76–12.60 | r3-ascii-halo-early (NULL, S2 MONO −2.24 against 4.48) |
| 4 | `ascii_border`: early-out test | 1.24–1.28 | 8.60–9.56 | r3-ascii-border-on-cell (WIN, S1 MONO −0.52, S2 NOON −2.72) |
| 5 | `ascii_atlasaddr`: integer multiply for the atlas x | 1.00–1.04 | 7.24–8.24 | r3-ascii-fmul; r3-ascii-atlas-array (refuted) |
| 6 | `ascii_mix` (an fma rewrite is not exact) | 0.52–0.60 | 4.24–4.84 | — |
| 7 | `ascii_s0` (uScene0 fetch) | 0.40–0.44 | 3.08–4.08 | — |
| 8 | `ascii_celldiv` | 0.28–0.32 | 1.16–2.12 | — |
| 9 | `ascii_s1`, `ascii_look` on the pond | ≤0.32 | ≤0.64 | — |
| L1 | MONO look tail (`ascii_look`), of which ramp stops (`ascii_rampstops`) | 6.24, 2.92 | 49.52, 24.40 | r3-ascii-ramp-float-index (WIN, S2 mono −8.80) |
| L2 | INT look tail (`ascii_look`, `ascii_intensity`) | 1.04, 0.96 | 7.60, 7.32 | — |

</details>

`ascii_decode` and `ascii_atlasfetch` came out slower than the base, so they bound nothing.

Sources: `.claude/perf-lab/evidence/r3/map/a/perf-s1-b2.json` to `perf-s1-b15.json`, `perf-s1-bx1.json`, `perf-s1-bx2.json` and the S2 files (`table.md`); batch from `batchq-s1-q2.json`, `batchq-s2-q2.json`. Outcomes: `.claude/perf-lab/evidence/r3/summary.md`.

**What bounds the body.** These come from calibration chains appended to the real pass (`perf-s*-bx1.json`).

- **Float against integer.** A full-rate float op per pixel costs about 0.15 µs at S1 and 1.26 at S2. A dependent `v_mul_lo_u32` + add costs about 1.40 and 10.7, which is about 9 float ops (quarter rate).
- **The multiplies.** The three integer multiplies per pixel are about half the body, which made r3-ascii-fmul the largest exact lever (12–16% of ascii).
- **Fetches are mostly hidden** (atlas bounds nothing, uScene1 ≤0.32), except the ink chain into the export and the halo, the only filtered sample.
- **Noise costs at S2.** Given the colour-compression floor, noisier per-pixel output such as dithering costs tens of µs at S2.

<details><summary>Round 0, origin/main, pre-reboot regime: ascii drops (shares only)</summary>

Drops at S1 / S2, in µs (`.claude/perf-lab/evidence/costmap.md` §4b):

| region | drop | later commit |
|---|---|---|
| floor, `ascii_empty` | 18.72 / 158.56 | — |
| cell integer divide, `ascii_intdiv` | 5.76 / 54.08 | r1-ascii-float-celldiv |
| atlas, `ascii_atlas` | 4.76 / 61.20 | — |
| halo | 1.60 / 17.20 | r1-ascii-glow-lod, r1-ascii-glow-skip-cleared |
| pond look | 1.24 / 13.04 | r1-ascii-look-branch |
| mono look | 5.96 / 72.76 | r2-ascii-ramp-uniform-select |

Unconfounded runs at S2 gave atlasfetch 34.86, glyphfetch 15.64 and localf 9.11 (`.claude/perf-lab/evidence/map-gaps/gaps.md`). The round-0 fit, ascii = 10.67 µs + 13.45 µs per device Mpx, describes only its two points, because the clock differs between sizes.

</details>

### glow, emission, ripple and fly floors

<details><summary>glow, emission, ripple and fly floors by part (14 rows)</summary>

| pass and part | S1 µs | S2 µs | source |
|---|--:|--:|---|
| emission, per-draw | 3.28–3.32 | 1.84–1.92 | `.claude/perf-lab/evidence/r3/map/a/table.md` |
| ↳ floor (`emis_empty` leaves it) | 2.56 (76–78%) | 1.44–1.48 | same, b10 |
| ↳ body (fetches, material, lum) | ≤0.72–0.80 | ≤0.44–0.48 | same, b10–b12 |
| ↳ RGBA32F → RGBA8 target (not exact) | 0.36–0.40 | 0.20 | same, b12; whole-batch noise |
| ↳ whole draw, whole-batch (`emis_skip`) | 2.44 | ≤2.32 n | `.claude/perf-lab/evidence/r3/map/a/batchq-s1-q1.json` |
| glow, per-draw | 5.56–5.60 | 3.08–3.12 | `.claude/perf-lab/evidence/r3/map/a/table.md` |
| ↳ floor (`glow_empty` leaves it) | 1.96 | 1.16 | same, b12–b13 |
| ↳ 44-tap gather (`glow_loop`), of which fetch | 2.92–2.96, 1.80–1.88 | 1.60–1.64, 1.12–1.16 | same, b13 |
| ↳ kernel, exp, knee | 0 | 0 | same, b14 |
| ↳ whole draw, whole-batch (`glow_skip`) | 4.73 | ≤2.65 n | `batchq-s1-q1.json` |
| ripple, advancing | 4.28 | 4.48 | `.claude/perf-lab/evidence/r3/map/d/tip-cpugpu-s1.json`, `-s2.json` |
| ↳ constant-writing floor (origin/main, round 0, pre-reboot regime: shares only) | 2.84 (78%) | 3.10 (69%) | `.claude/perf-lab/evidence/ablation-cpu/ablation-cpu.md` §2 |
| ↳ wave equation / drop loop (round 0, pre-reboot regime) | 0.76 / 0.04 | 1.30 / 0.08 | same |
| fly (DUSK), per-draw | ≤0.08 | ≤0.12 | `.claude/perf-lab/evidence/r3/map/b/perf-s1-b15.json`, `perf-s2-b15.json` |

</details>

- **Emission is fixed cost;** its only lever, the target width, is not exact.
- **Glow** splits into floor, fetch and accumulate: 35%, 32–34% and about 20% at S1; 36–37%, 35–36% and about 16% at S2. The shares use the glow base of the same ablation runs, 5.52–5.60 / 3.16–3.20 µs (`.claude/perf-lab/evidence/r3/map/a.md`, "glow pass").
- **The old glow cost.** On origin/main, glow recomputed every neighbour's emission per tap. In round 0 (pre-reboot regime; compare shares, not µs, with the round-3 rows above), `glow_emission` was 12.48 / 11.20 of a 17.52 / 15.36 µs pass (`.claude/perf-lab/evidence/costmap.md` §4a). r1-glow-emission-prepass, r1-glow-branchfree-taps and r2-glow-zero-pad-emit removed it.
- **Ripple is launch cost on its own coarse grid**, so size barely matters. Its one lever above noise was the `gl_FragCoord` input: r3-ripple-pos-varying took S2 from 4.48 to 4.08.

### Outside the draws

| item | S1 | S2 | source (`.claude/perf-lab/evidence/r3/map/d/`) |
|---|--:|--:|---|
| non-draw commands of a frame (binds, viewports, uniforms, `texSubImage2D`, `bufferSubData`, the query) | ≤1.79–1.82 µs | ≤1.70–1.77 µs | `outside-s1.json`, `outside-s2.json`, `present-s*.json` |
| fish texture upload | ≤~2, null | null | same |
| glow-target clear when the halo is off (every frame) | +2.0 | +1.9 | `present-s1.json`, `present-s2.json`; fed r3-glow-clear-once (WIN, −1.81 batch) |
| deferred drawing-buffer clear (`preserveDrawingBuffer: false`), per presented frame | **7.67 ±0.06** | **37.62 ±0.58** | `present-s1.json`, `present-s2.json` (looppcdraw mode) |
| real-loop frame against back-to-back batch, MID | 58 vs 50.1 | 169 vs 132.6 | same |

- **The drawing-buffer clear** is 22% of the real-loop S2 frame (872e201 only). It lands in the first draw's timer, the scene (ripple draws in under 1% of loop frames); a timed no-op `gl.clear(0)` before that draw takes the whole excess.
- **`preserveDrawingBuffer: true` removes the clear but loses:** 5345 → 4040 fps (−24%) at S2, as Chromium copies the back buffer at present (`pdb-s1.json`, `pdb-s2.json`).
- **`alpha: true` changes nothing:** 170 vs 169 µs (`ctxattr-s2.json`).
- **A `desynchronized: true` probe was deferred untested** (`.claude/perf-lab/evidence/r3/summary.md`).

### CPU per frame

Main thread, origin/main → 872e201, from map D (7 runs per side):

| metric | S1 MID | S1 DUSK | S2 MID | S2 DUSK |
|---|---|---|---|---|
| step ms/frame | 0.0494 → 0.0424 (null, thr 0.0178) | 0.0522 → 0.0441 | 0.0499 → 0.0428 (null, thr 0.0174) | 0.0526 → 0.0449 |
| allocated B/frame | 34,523 → **10,714** (−69.0%) | 34,676 → 10,838 | 33,601 → **9,651** (−71.3%) | 33,761 → 9,822 |
| minor GCs per 3000 frames | 60 → 27 | 60 → 27 | 62 → 30 | 62 → 26 |
| GC µs/frame | 2.979 → 1.515 | 3.020 → 1.574 | 3.395 → 1.909 | 3.300 → 1.888 |

Sources: `.claude/perf-lab/evidence/r3/map/d/tip-cpu-s1.json`, `tip-cpu-s2.json`, `tip-alloc-s1.json`, `tip-alloc-s2.json` (`tables.md`).

- **Step time.** The −14 to −16% change is null under the 2× rule in every cell. The change is 0.0070–0.0081 ms, 0.04–0.05% of a 16.67 ms (60 Hz) frame; the whole step is 0.0424–0.0449 ms, 0.25–0.27%.
- **Allocation**, GC count and GC time win in every cell: koi.ts 26,344 → 7,015 B/frame, native 4,177 → 545.

**Where it goes on 872e201** (map C, single-sided, 7 × 3000 frames; `.claude/perf-lab/evidence/r3/map/c/profile-s1.json`, `alloc-s1.json` and the S2 pair):

- **Self time at S1 MID.**
  - Total 0.0588 ms/frame: `advance` path 0.0326, koi.ts 0.0188.
  - Top functions: `pose` 0.0062, the `hypot` replica 0.0040, `update` 0.0030, `writeTrail` 0.0022, `followSpine` 0.0016, `render` 0.0012, `pack` 0.0011, `texSubImage2D` 0.0010.
  - Fish kinematics are 0.0170 (29%). Debug-only work is about 0.004; GC is 0.001.
- **Allocation at S1 MID.**
  - Total 10,707 B/frame (9,638 at S2). GC is 1.55 / 1.79 µs/frame.
  - By file: koi.ts 7,005 (65%), lighting.ts 1,432 (13%), renderer 584.
  - By function: `update` 2,352, `pose` 1,827, `followSpine` 1,506, `sampleBody` 821, `render` 584, `lightingAt` 508, `azimuth` 333.
  - Mostly boxed doubles around out-of-line calls, inferred from an offline node inlining trace (`.claude/perf-lab/evidence/r3/map/c/offline/inlining.txt`), not from Chrome.
- **Candidates fed** (measure stage, `.claude/perf-lab/evidence/r3/summary.md`; each against its own parent, so they do not sum; the integration numbers are in Perf changes rows 22 and 26-28):
  - r3-cpu-hypot-nan: −3,443 B/frame at S2 MID.
  - r3-cpu-lighting-memo: −2,069 at S1 DUSK.
  - r3-cpu-samplebody-scratch: −737 at S1 MID.
  - r3-cpu-lighting-temps: −699 at S1 MID.
  - r3-cpu-uniform-cache: NULL.

<details><summary>Round 0, origin/main (another run)</summary>

- **Step and split.** Step was 0.0484 / 0.0499 ms (MID S1 / S2), 0.0511 / 0.0535 at DUSK. By ablation: js_sim 0.0373 (74%), js_render 0.0150 (30%), js_pack 0.0041 / 0.0050, js_lighting 0.0033 / 0.0025, js_uniforms 0.0033 / 0.0013.
- **Profile.** `Koi.pose` inclusive 0.0124 ms, `followSpine` 0.0082. koi.ts:509 `Math.atan2` was 0.00516 (12.9% of advance), later removed by r1-koi-pose-v235.
- **Allocation.** 34,547 / 33,585 B/frame, 60 minor GCs per 3000 frames, GC 3.13 / 3.39 µs/frame. The largest sites were `Koi.pose` 18,290, native `Math.hypot` 3,682 (later r2-koi-hypot-replica) and `followSpine` 3,043.
- **GL calls.** 97 per frame, 58 of them uniform calls.

Sources: `.claude/perf-lab/evidence/costmap.md` §5, `.claude/perf-lab/evidence/cpu/tables.md` and `.claude/perf-lab/evidence/ablation-cpu/ablation-cpu.md` §1.

</details>

### Start-up

This is map C, cold start: 7 runs, origin/main → 872e201 alternating, `--serve build`, fresh Mesa cache, ms median ± spread. Start-up is CPU-bound compile time, so the GPU regime does not apply.

| row | S1 `?seed=7` | S2 `?seed=7` |
|---|---|---|
| programs (wall) | 190.9 ±7.8 → 167.9 ±4.4 (−23.0) | 191.0 → 166.9 (−24.1) |
| Σ compile / Σ link | 24.1 / 166.7 → 27.1 / 139.3 | 24.2 / 166.0 → 26.6 / 139.0 |
| nav → first draw | 241.9 ±14.2 → 216.8 ±7.1 | 241.6 ±6.8 → 218.0 ±6.7 (−23.5, clears 2× spread) |
| first draw → gpu done | 37.0 → 48.5 (+11.6) | 35.3 → 52.0 (+16.7) |
| **nav → gpu done** | 278.2 ±10.9 → **265.1** ±11.0 (null) | 276.1 ±6.8 → **269.3** ±6.0 (null) |

Sources: `.claude/perf-lab/evidence/r3/map/c/startup-s1.json`, `startup-s2.json` (`.claude/perf-lab/evidence/r3/map/c.md` §2).

The −23 ms of programs is glow's compile + link going from 34.44 to 7.71 ms (link alone 32.38 to 6.31). Most of it returns as first draw → gpu done.

**Per program** (cold S1 `?seed=7`, `.claude/perf-lab/evidence/r3/map/c/progs.md`). The build is serial (ripple, scene, emission, glow, ascii, fly), with a blocking status query after each step.

| program | origin/main compile / link | 872e201 compile / link | 872e201 fragment chars |
|---|--:|--:|--:|
| ripple | 1.89 / 4.54 | 2.30 / 4.48 | 3,392 |
| **scene** | 15.91 / 124.16 | **16.81 / 122.06** | 24,132 (was 37,865) |
| emission | — | 1.58 / 1.66 | 2,959 |
| glow | 1.99 / 32.38 | 1.44 / 6.31 | 3,111 |
| ascii | 2.46 / 2.89 | 2.79 / 2.98 | 4,605 |
| fly | 1.73 / 1.31 | 1.83 / 1.08 | 2,795 |

Cutting the scene source 36% (comments, whitespace) left its compile and link time unchanged.

**Critical path at 872e201** (`.claude/perf-lab/evidence/r3/map/c/critpath.md`, `.claude/perf-lab/evidence/r3/map/c/ablate/table.md`).

- **Frame 1 waits on a deferred compile** of the scene program after its link returns. Scene link end → gpu done is 84.7 ±11.1 ms (94.5 on origin/main), and 32.2 with every scene chunk stubbed, so the deferred compile is ≈52 ms.
- **The scene dominates cold start.** It costs 16.8 + 122.1 + ≈52 ≈ 191 of 265 ms. `ablate=all` measures −182.8 ms nav → gpu done.
- **Chunk stubs** (non-additive bounds on nav → gpu done, ms; `ablate-1.json`, `ablate-2.json`, `ablate-3.json`): compose (`drawFish` and `shadow` with their callees) −127.9, fish −45.6 (backend −37.7), trails −40.0, glyphs −37.1, markings −28.4, water −22.6, cell −21.6, sky −16.0, ripples −11.1, light null.
- **Fed.** r3-startup-ir-diet keeps the shadow and trail chunk loops rolled: S1 `?seed=7` cold nav → gpu done went 267.33 → 227.05 ms in its measure-stage run 2 (`.claude/perf-lab/evidence/r3/summary.md`; integration numbers in Perf changes row 21).
- **Rejected.** r3-startup-fbm-roll was not exact. r1-startup-parallel-compile was a disk-warm LOSS of +60–65 ms.

**Cache variants**, nav → gpu done, origin/main → 872e201 (`.claude/perf-lab/evidence/r3/map/c.md` §2):

| variant | S1 `?seed=7` | S1 `?debug` | S2 `?debug` |
|---|---|---|---|
| warm (second page) | 53.2 → 49.9 | 67.6 → 64.7 | 66.1 → 64.5 |
| Mesa-warm (behaves as cold: Mesa stores no shaders under Chrome) | 270.5 → 263.7 | 319.8 → 311.3 | 326.2 → 315.1 |
| disk-warm (restarted browser) | 60.6 → 53.5 | **158.8 → 84.8** | **171.8 → 88.2** |

- **The `?debug` disk-warm stall** (origin/main first draw → gpu done 73.8 ms at S1) is gone at 872e201.
- **Round 0 agrees:** programs took 196.8 of 223.1 ms from mount to first draw (`.claude/perf-lab/evidence/costmap.md` §6a).

### Bundle bytes: maintainer-policy notes, not landed

**Status.** None of these ship. Each changes what consumers receive, so it is the maintainer's call; rounds 1 and 3 dropped the JSDoc drop and the debug-hook split as policy (`.claude/perf-lab/evidence/r3/summary.md`, "Dropped").

| item | origin/main 23cd98e (round 0) | d0a6f41 (round 2) | 872e201 (round 3) |
|---|--:|--:|--:|
| dist/index.js raw / gzip -9 | 143,292 / 46,839 (CLI) | 130,960 / 41,753 (zlib) | 131,320 / 42,265 (zlib), 41,933 (CLI) |
| GLSL literals | 47,774 (33.3%) | — | 30,611 (23.3%) |
| JSDoc `/** */`, raw | — | **16,402** | 16,778 (12.8%) |
| drop JS comments: Δ gzip | — | **−7,456** | −7,622 |
| rolldown `-m` minify: Δ gzip | — | **−12,506** | −12,742 |
| minify + GLSL token-minify: Δ gzip | — | — | −13,593 |
| Vite `--minify`: Δ gzip | — | — | −10,696 |

Sources: `.claude/perf-lab/evidence/costmap.md` §6b (round 0), `.claude/perf-lab/evidence/r2/map/c.md` "Bundle" (round 2), and `.claude/perf-lab/evidence/r3/map/c/bundle/variants.txt`, `composition.txt` and `bundle-size.txt` (round 3).

**Notes.**

- **JSDoc.** Dropping it is the largest saving that keeps the output readable, about 18% of the wire. Types and docs ship in `index.d.ts`.
- **GLSL token-minify** would break the `file:line` mapping of shader compile errors (`sceneLines`).
- **Other dead weight at 872e201:**
  - ≈1.15 KB raw of debug-only plumbing in mount.ts and internal.ts (`.claude/perf-lab/evidence/r3/map/c/bundle/debug-plumbing.txt`);
  - 778 B of GLSL blank-line escapes (−186 B gzip).
- **Tool caveat.** `bin/bundle-size.mjs` and `startup.mjs --bundle` find 0 of 22 shaders from 872e201 on, because the indentation strip defeats their matcher, so their GLSL-share rows read 0%. `.claude/perf-lab/evidence/r3/map/c/bundle/compose.mjs` matches correctly. The shipped `startup.mjs --bundle` was fixed after these runs: it now also looks for each shader as the build strips it, and on the tip it finds 19 of 19 on origin/main and 22 of 22 on head, with the raw shares (33.3% and 22.7%) that Combined result gives.

### Unproven in the cost map

- **Round-0 raw data is missing.** `baseline/*`, `ablation/ablation.json` and `perf-s*-batch*.json` are not in the lab; round-0 figures rest on `.claude/perf-lab/evidence/costmap.md` and other md files.
- **The map regions have no ISA or VGPR stats.** AMD_DEBUG through Chromium produced nothing (`.claude/perf-lab/evidence/r3/map/a.md`, point 8), so instruction costs come from calibration chains.
- **The cross-pass effects are not traced** (`ascii_empty` slowing the scene at S2, `scene_empty` speeding glow on origin/main, S1 emission absorbing the scene drain). The working explanation is the top-of-pipe timer begin.
- **The per-draw against whole-batch gap rests on a model** (overlap and wave shares), not hardware counters.
- **The ≈52 ms deferred backend compile is inferred from timing**, not traced to radeonsi's compile queue.
- **The glow gap between sizes is not explained:** 5.60 µs at S1 against 3.08 at S2 for about the same cells. A lower S1 clock is possible, not isolated (`.claude/perf-lab/evidence/r3/map/a.md`, "Base pass times").
- **Everything is from one machine, driver and browser.**
- **The cell-gate shares are modelled**, assuming one 8×8 block of cells per wave64 (`cell-gates-*.json`), not counted.
- **The origin/main allocation figures disagree:** 34.5 KB/frame by sampling profile, 54.6 by static heap profile. Not reconciled.
- **The profile under-attributes the sim.** On origin/main, `Pond.update` inclusive is 0.0278 ms in the profile against `js_sim` 0.0373 ms by ablation (`.claude/perf-lab/evidence/costmap.md` §5b–5c). Not explained.
- **The origin/main ripple was decomposed only at MID.**
- **The map's `ascii_fmul` pixel check covered 42 cells** (`.claude/perf-lab/evidence/r3/map/a/fmul-pixels`). The full-frame gate came later, in r3-ascii-fmul's own verification.
- **`update` allocates 2,352 B/frame at S1 against 1,498 at S2**, consistently. Not explained.
- **The bundle what-ifs are byte counts only**, untested on consumers.

## Perf changes

The branch puts 30 perf commits on origin/main 23cd98e: 11 from round 1, 8 from round 2 and 11 from round 3, in that order. Nine are in the ascii pass: float cell math and varyings replace the ivec2 divide and gl_FragCoord, uniform branches pick the look and the ramp stops, and the halo sample is cheaper or skipped. Four are in the glow pass: a float32 emission pre-pass, branch-free taps on a zero-bordered target, and a single clear when the halo is off. Six are in the scene pass: trail culling and unrolling, an eye-reach gate, the fish drawn as a second layer, and a branch-free polyline search. One reads the ripple texel position from a varying, one keeps two scene loops rolled so the scene program links faster, seven cut per-frame CPU allocation (koi pose tables, the hypot replica, sampleBody, pack and render literals, lighting), and two strip comments and whitespace from the shipped GLSL. The 147-cell pixel gate against origin/main was SAME on every commit as measured (rows 5-9 on their chain commits and on the merged stack) and on the final tip.

**How to read the table.**

- **Rows.** One row per perf commit, in branch order (`git log --reverse origin/main..HEAD`). The commit cell gives the 7-character PR sha, its subject and the candidate id.
- **PR sha and measured sha.** The "Shas in this report" table under Environment maps each PR sha to the stack sha that was measured. In the lab, `.claude/perf-lab/report/commits.tsv` pairs each stack sha with the PR sha from before the commit messages gained their numbers, and `.claude/perf-lab/report/reworded.tsv` maps those to the current PR shas. For all 30 commits, `git rev-parse <pr>^{tree}` equals `<stack>^{tree}`, and the parent trees also match. A measurement of the stack commit is therefore a measurement of the PR commit, except for the † rows.
- **base and head.** The target cell from the first run: the median of the per-run medians on the commit's parent and on the commit. GPU passes are in µs (the timer queries step in 0.04 µs), allocation in B/frame, bundle in bytes and start-up in ms. When both sizes won, the cell reads S1 / S2.
- **Δ%.** (head − base) / base.
- **spread.** The larger of the base and head spreads (max − min of the run medians), followed by → and the threshold, which is 2 × spread. Rule (a) needs −Δ > threshold. "thr" alone gives a threshold whose spread is not quoted.
- **reproduced?** What the independent second run showed, and the third run where there was one.
- **shots SAME.** The pixel gate against origin/main on that commit, out of 147 cells.

**Clock regime of the round-1 rows (1-11).**

- **When they ran.** Rows 1-11 were measured on 2026-10-22, in the boot that ended 2026-10-23 00:57. That boot was in the faster GPU clock regime, so their S1 µs are about 1.3x lower than the S1 µs of rounds 2 and 3 and of the combined result below.
- **origin/main.** The S1 MID frame was 67.12 µs at integration 1 (`.claude/perf-lab/evidence/int-r1/final/perf1.md`, line 49) and 88.48 µs in round-3 map D (`.claude/perf-lab/evidence/r3/map/d.md`, line 21), a ratio of x1.318. The medians over the four standard queries were 67.28 µs (`.claude/perf-lab/evidence/int-r1/integration.md`, line 81) and 88.74 µs (the median of d.md lines 91, 96, 102 and 107), about x1.32.
- **d0a6f41.** The S1 MID frame was 46.36 µs at the fix stage (`.claude/perf-lab/evidence/r2/fix/r1-koi-pose-v235/run1.md`, line 48). On 2026-10-27 the same commit measured 61.18 / 61.26 µs against itself (`.claude/perf-lab/evidence/r2/smoke/perf.json`, `perf.stderr`).
- **S2.** S2 did not change: origin/main's S2 MID frame measured 242.76 µs at integration 1 (`.claude/perf-lab/evidence/int-r1/final/perf1.md`, line 106) against 243.60 µs in map D, and the four-query medians were 242.88 µs against 243.56 µs.
- **What still holds.** Each row ran base and head in the same run, so the Δ% values and verdicts hold. The absolute S1 µs in rows 1-9 cannot be compared with rows 12-30 or with the combined result. Rows 10 (bundle bytes) and 11 (allocated bytes) do not depend on the GPU clock.
- **Raw data.** The reboot after round 1 lost most of the raw perf JSON for rows 1-11 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26). Their numbers come from the rebuilt write-ups and from `.claude/perf-lab/evidence/int-r1/result.json`, which was reconstructed from the workflow journal on 2026-10-27.

**† Rows 5-9 were measured on per-area chains.**

- **The chains.** Integration 1 built three chains directly on origin/main and measured each increment against its chain parent:
  - ascii: 7c376f2 → ccc2b89 → f1d10c4 → 349b9d6
  - glow: 06fa96c → 9b1dd0d
  - scene: aec9727 → e491f9a → 8ec7be6
- **Rows 1-4.** The ascii chain commits have the same trees and parent trees as stack commits 1-4.
- **Rows 5-9.** The glow and scene chain commits carry the same patches as stack commits 5-9 (`git patch-id --stable`). Their parents lack the earlier areas' commits, though, so the measured base tree is not the PR parent tree.
- **The merged stack.** The stack was merged at de4b18c. Its gate was SAME in 147 cells (`.claude/perf-lab/evidence/int-r1/merge/merge.md`). Against origin/main it measured 67.28 → 46.44 µs at S1 and 242.88 → 178.72 µs at S2 (`.claude/perf-lab/evidence/int-r1/integration.md`).

<details><summary>Per-commit table: 30 perf commits, branch order</summary>

| # | commit | pass/chunk | base | head | Δ% | spread | reproduced? | shots SAME | evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `41477d0` perf(ascii): find the cell with a float divide, not an ivec2 one (r1-ascii-float-celldiv) | ascii, NIGHT, S1 / S2 | 24.20 / 208.96 µs | 18.68 / 154.68 µs | -22.8 / -26.0 | 1.60 → 3.20 / 2.44 → 4.88 | yes. Run 2: S1 -5.56 to -5.64, S2 -54.24 to -54.72 µs | 147/147 (chain 7c376f2) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 1), `.claude/perf-lab/evidence/int-r1/result.json` |
| 2 | `c78f160` perf(ascii): wrap the look tail in one uniform branch (r1-ascii-look-branch) | ascii, S2 mono (extra query; the standard queries are noise at both sizes) | 187.92 µs | 176.80 µs | -5.92 | 2.20 → 4.40 | yes. Run 2: 187.04 → 176.72 (-10.32, thr 3.12) | 147/147 (chain ccc2b89) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 2), `.claude/perf-lab/evidence/int-r1/r1-ascii-look-branch/run2.md` |
| 3 | `c256ed1` perf(ascii): skip the halo sample when the glow target was cleared (r1-ascii-glow-skip-cleared) | ascii, S1 glow=off (extra query) | 17.24 µs | 16.96 µs | -1.62 | 0.08 → 0.16 | thin. Each of 3 runs won on a different cell. S1 glow=off and paper moved -0.24 to -0.28 in all 3 runs but beat thr only in runs 1 and 3. Run 2 won on S2 glow=off frame (-2.64, thr 2.16), with ascii -2.40 equal to thr | 147/147 (chain f1d10c4) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 3), `.claude/perf-lab/evidence/int-r1/r1-ascii-glow-skip-cleared/run3.md` |
| 4 | `3682557` perf(ascii): sample the halo with textureLod at level 0 (r1-ascii-glow-lod) | ascii, S2 mono (extra query); frame noise | 176.52 µs | 171.72 µs | -2.72 | 2.12 → 4.24 | yes. Run 2: 175.44 → 171.08 (-4.36, thr 4.08) | 147/147 (chain 349b9d6) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 4), `.claude/perf-lab/evidence/int-r1/r1-ascii-glow-lod/run2.md` |
| 5† | `3cbb8ec` perf(glow): store each cell's emission once in a float32 pre-pass (r1-glow-emission-prepass) | glow + emission (head) against glow (base), MID, S1 / S2 | 17.56 / 15.36 µs | 11.88 / 11.48 µs | -32.4 / -25.3 | 0.20 → 0.40 / 0.04 → 0.08 | yes. Run 2: S1 -5.72 to -6.08, S2 -3.88; frame S1 -7.36 to -7.48, S2 -4.56 to -4.68 µs | 147/147 (chain 06fa96c) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 5), `.claude/perf-lab/evidence/int-r1/r1-glow-emission-prepass/run2.md` |
| 6† | `164191e` perf(glow): clamp each tap and fetch it, masking only the accumulate (r1-glow-branchfree-taps) | glow, MID, S1 / S2 | 8.00 / 5.28 µs | 4.96 / 3.56 µs | -38.0 / -32.6 | 0.04 → 0.08 / 0.04 → 0.08 | yes. Run 2 gives the same glow Δ in every cell. Frame across both runs: S1 -2.96 to -3.12, S2 -2.32 to -2.68 µs; every frame cell wins except run 2's S1 DUSK (-2.96) and MID (-3.04), noise at thr 4.40 / 4.64 after one head run widened the spread | 147/147 (chain 9b1dd0d) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 6), `.claude/perf-lab/evidence/int-r1/r1-glow-branchfree-taps/run1.md`, `run2.md` |
| 7† | `2e9040f` perf(scene-trails): skip trail chunks no cell is near (r1-scene-trail-chunk-boxes) | scene, S1 DUSK (S2 noise, 0.00 to -0.48) | 24.24 µs | 21.92 µs | -9.57 | 0.32 → 0.64 | yes. Run 2: S1 -2.00 to -2.56 | 147/147 (chain aec9727) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 7), `.claude/perf-lab/evidence/int-r1/r1-scene-trail-chunk-boxes/run2.md` |
| 8† | `3440a41` perf(scene-trails): unroll the trail segment loop by 4 (r1-scene-trail-unroll; see note a) | scene, MID, S1 / S2 | 22.40 / 18.76 µs | 20.96 / 17.64 µs | -6.43 / -5.97 | 0.08 → 0.16 / 0.04 → 0.08 | yes. Run 2: the same cells; S2 DUSK noise (-0.96, thr 1.36) | 147/147 (chain e491f9a) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 8), `.claude/perf-lab/evidence/int-r1/r1-scene-trail-unroll/run2.md` |
| 9† | `f839bf4` perf(scene-fish): skip refrAt for cells beyond an eye's reach (r1-scene-eye-gate) | scene, S1 NOON / S2 MID | 21.64 / 17.60 µs | 21.12 / 17.20 µs | -2.40 / -2.27 | 0.20 → 0.40 / 0.04 → 0.08 | yes. Run 2: S1 -0.52 to -0.64, S2 -0.44 in 3 queries | 147/147 (chain 8ec7be6; merged stack de4b18c also 147/147) | `.claude/perf-lab/evidence/int-r1/integration.md` (row 9), `.claude/perf-lab/evidence/int-r1/r1-scene-eye-gate/run2.md` |
| 10 | `2728924` perf(bundle): strip // comments from the shipped GLSL (r1-bundle-strip-glsl-comments) | dist/index.js, gzip -9 | 48,920 B | 41,104 B | -15.98 | 0 → 0 (deterministic builds) | yes. 3 of 3 runs give the same bytes and sha256 | 147/147 (398ec7e) | `.claude/perf-lab/evidence/int-r1/r1-bundle-strip-glsl-comments/run1.md` to `run3.md` |
| 11 | `083cb00` perf(koi): precompute koi pose tables, skip atan2 in the bend limit (r1-koi-pose-v235) | allocated B/frame, MID, S1 / S2 | 34,537 / 33,579 | 17,597 / 16,665 | -49.0 / -50.4 | 190 → 380 / 120 → 240 | yes. Run 2: S1 34,554 → 17,635 (thr 336), S2 33,631 → 16,670 (thr 274); step CPU noise in both runs | 147/147 (d0a6f41) | `.claude/perf-lab/evidence/r2/fix/r1-koi-pose-v235/run1.md`, `run2.md` |
| 12 | `599ed76` perf(ascii): read the pixel position from a varying, not gl_FragCoord (r2-ascii-pos-varying) | ascii, MID, S1 / S2 | 22.80 / 153.88 µs | 18.32 / 116.00 µs | -19.65 / -24.62 | 0.12 → 0.24 / 1.40 → 2.80 | yes. Run 2: S1 -4.48 (thr 0.32), S2 -38.36 (thr 5.36) | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-ascii-pos-varying/run1-verdict.txt`, `run2-verdict.txt`, `gate.txt` |
| 13 | `f067572` perf(ascii): pick ramp stops by uniform stop-count branches (r2-ascii-ramp-uniform-select) | ascii, amber palette, S1 / S2 | 25.80 / 173.44 µs | 24.40 / 163.68 µs | -5.43 / -5.63 | 0.08 → 0.16 / 2.84 → 5.68 | yes. Run 2: S1 -1.32 to -1.36 (thr 0.16 to 0.40), S2 -8.44 to -9.68 (thr 4.56 to 6.64) | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-ascii-ramp-uniform-select/run1-verdict.txt`, `run2-verdict.txt`, `gate.txt` |
| 14 | `2a26f5b` perf(scene): draw the fish as a second layer of the scene program (r2-scene-layer-split) | scene, NOON, S1 / S2 | 28.40 / 17.24 µs | 23.60 / 13.52 µs | -16.90 / -21.58 | 0.12 → 0.24 / 0.08 → 0.16 | yes. Run 2: 12 of 12 cells win | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-scene-layer-split/run1-verdict.txt`, `run2-verdict.txt`, `gate.txt` |
| 15 | `9045b8f` perf(koi): replace Math.hypot with an inlinable bit-exact replica (r2-koi-hypot-replica) | allocated B/frame, MID, S1 / S2 | 17,623 / 16,660 | 11,564 / 10,455 | -34.4 / -37.2 | 159 → 318 / 88 → 176 | yes. Run 2: -6,056 to -6,231 (thr 312 to 366) | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-koi-hypot-replica/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 16 | `28e921b` perf(scene-fish): keep the closest polyline segment by selects (r2-scene-polyline-branchfree) | scene, S1 DUSK / S2 NOON | 23.56 / 13.52 µs | 19.40 / 11.24 µs | -17.66 / -16.86 | 0.08 → 0.16 / 0.16 → 0.32 | yes. Run 2: S1 -4.00 to -4.16, S2 -2.20 to -2.28 | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-scene-polyline-branchfree/run1-verdict.txt`, `run2-verdict.txt`, `gate.txt` |
| 17 | `138a369` perf(glow): zero-border the emission target, drop the tap clamp (r2-glow-zero-pad-emit) | glow, S1 MID / S2 DUSK | 6.48 / 3.60 µs | 5.52 / 3.08 µs | -14.81 / -14.44 | 0.08 → 0.16 / 0.04 → 0.08 | yes. Run 2: S1 -0.92 to -0.96 (thr 0.24), S2 -0.52 (thr 0.08) | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-glow-zero-pad-emit/run1-verdict.txt`, `run2-verdict.txt`, `gate.txt` |
| 18 | `f693868` perf(cpu): drop per-frame array literals from pack and render (r2-cpu-alloc-literals) | allocated B/frame, MID, S1 / S2 | 11,574 / 10,478 | 10,693 / 9,633 | -7.6 / -8.1 | 153 → 306 / 71 → 142 | yes. Run 2: -806 to -844 (thr 208 to 360) | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-cpu-alloc-literals/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 19 | `7835893` perf(bundle): strip GLSL indentation and trailing spaces too (r2-bundle-glsl-indent-strip) | dist/index.js, gzip -9 (raw 133,589 → 131,320 B, -1.70%; brotli 36,677 → 36,452 B, -0.61%) | 42,233 B | 41,933 B | -0.71 | 0 → 0 (deterministic builds) | yes. Run 2 gives the same bytes and sha256 | 147/147 | `.claude/perf-lab/evidence/r2/int/r2-bundle-glsl-indent-strip/run1-parent-1.txt`, `run1-head-1.txt`, `run2-parent-1.txt`, `run2-head-1.txt`, `run1-dist-equiv.txt`, `gate.txt` |
| 20 | `dad7b85` perf(ascii): take cell offset and atlas x from exact float products (r3-ascii-fmul) | ascii, MID, S1 / S2 | 18.32 / 115.88 µs | 16.00 / 96.72 µs | -12.66 / -16.53 | 0.24 → 0.48 / 2.24 → 4.48 | yes. Run 2: S2 115.44 → 97.36 (-15.66%, thr 5.12), S1 also wins (thr 0.64). Whole batch S2 MID: 135.39 → 117.67 (-13.09%, thr 4.48) in run 1, -13.23% (thr 9.88) in run 2 | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-ascii-fmul/run1-verdict.txt`, `run2-verdict.txt`, `run1-batchq-verdict.txt`, `run2-batchq-verdict.txt`, `gate.txt` |
| 21 | `e22d7b4` perf(startup): keep the scene shadow and trail chunk loops rolled (r3-startup-ir-diet) | cold nav → gpu done, S1 ?debug / S2 ?seed=7 | 317.89 / 271.14 ms | 275.10 / 228.61 ms | -13.5 / -15.7 | 15.21 → 30.42 / thr 13.55 | yes. Run 2: S1 315.05 → 274.36 (-12.9%, thr 22.00), S2 268.95 → 231.79 (-13.8%, thr 23.09) | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-startup-ir-diet/run1-table.md`, `run2-judge.md`, `gate.txt` |
| 22 | `f372e94` perf(koi): return ax + ay, not the global NaN, from the hypot replica (r3-cpu-hypot-nan) | allocated B/frame, S2 MID (all 4 cells win) | 9,638 | 6,156 | -36.1 | 101 → 202 | yes. Run 2: 9,643 → 6,166 (thr 228); step CPU noise | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-cpu-hypot-nan/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 23 | `c3160b7` perf(scene): end trails at age 0.85 and grow their boxes on the CPU (r3-scene-trail-cull) | whole batch µs/frame, S1 DUSK | 48.96 µs | 46.89 µs | -4.23 | 0.83 → 1.66 | yes. Run 2: 48.95 → 46.97 (-4.04%, thr 1.50). The other S1 queries moved -1.12 to -1.76 under thr 1.48 to 2.02; S2 noise | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-scene-trail-cull/run1-batchq-verdict.txt`, `run2-batchq-verdict.txt`, `gate.txt` |
| 24 | `3390812` perf(glow): clear the glow target once when the halo goes off (r3-glow-clear-once) | whole batch µs/frame, S1 glow=off (paper: 39.16 → 37.39, -4.52%, thr 1.74) | 39.61 µs | 38.00 µs | -4.06 | 0.45 → 0.90 | yes. Run 2: 39.55 → 38.00 (-3.92%, thr 1.16), paper -5.13% (thr 1.54); S2 noise | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-glow-clear-once/run1-batchq-verdict.txt`, `run2-batchq-verdict.txt`, `gate.txt` |
| 25 | `8e4b418` perf(ascii): upload the ramp's per-segment steps instead of subtracting (r3-ascii-ramp-float-index) | ascii, mono, S1 / S2 | 21.92 / 144.68 µs | 21.12 / 138.12 µs | -3.65 / -4.53 | 0.12 → 0.24 / 3.12 → 6.24 | yes. Run 2: S2 144.40 → 137.28 (-4.93%, thr 2.32), S1 -3.83% (thr 0.48). Whole batch S2 mono: 163.62 → 157.26 (-3.89%, thr 6.24) in run 1, -4.52% (thr 6.52) in run 2 | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-ascii-ramp-float-index/run1-verdict.txt`, `run2-verdict.txt`, `run1-batchq-verdict.txt`, `run2-batchq-verdict.txt`, `gate.txt` |
| 26 | `d05daa2` perf(koi): write sampleBody into a reused array, not a new object (r3-cpu-samplebody-scratch) | allocated B/frame, S1 MID (all 4 cells win) | 7,302 | 6,529 | -10.6 | 95 → 190 | yes. Run 2: 7,311 → 6,558 (thr 176) | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-cpu-samplebody-scratch/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 27 | `6fb0e99` perf(cpu): drop per-frame temporaries from lightingAt (r3-cpu-lighting-temps) | allocated B/frame, S1 MID | 6,556 | 5,887 | -10.2 | 65 → 130 | yes. Run 2: 6,544 → 5,859 (thr 134) | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-cpu-lighting-temps/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 28 | `3e62b1d` perf(cpu): reuse the frame's lighting while phase, palette and sky hold (r3-cpu-lighting-memo) | allocated B/frame, DUSK (fixed phase), S1 / S2 | 6,005 / 4,909 | 4,595 / 3,473 | -23.5 / -29.3 | 59 → 118 / 117 → 234 | yes. Run 2: S1 6,015 → 4,581 (thr 206), S2 4,881 → 3,472 (thr 152); MID noise | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-cpu-lighting-memo/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |
| 29 | `c9386da` perf(ascii): test the border on the cell index with unsigned compares (r3-ascii-border-on-cell) | ascii, mono, S1 / S2 | 21.12 / 138.24 µs | 20.32 / 130.84 µs | -3.79 / -5.35 | 0.20 → 0.40 / 2.04 → 4.08 | partly. Run 2 reproduced S2 ascii: 137.20 → 130.80 (thr 4.64). The run-1 whole-batch S2 mono win (156.43 → 150.55, -3.76%, thr 3.14) did not reproduce (-6.30, thr 6.74). The S1 wins moved to DUSK and NIGHT | 147/147 | `.claude/perf-lab/evidence/r3/int/r3-ascii-border-on-cell/run1-verdict.txt`, `run2-verdict.txt`, `run1-batchq-verdict.txt`, `run2-batchq-verdict.txt`, `gate.txt` |
| 30 | `0378378` perf(ripple): read the texel position from a varying, not gl_FragCoord (r3-ripple-pos-varying) | ripple, advancing frame (`npm run cpu -- --gpu`), S2 MID (all 4 S2 cells win) | 4.48 µs | 4.08 µs | -8.93 | 0.04 → 0.08 | yes at S2. Run 2: -0.40 to -0.44 (thr 0.16). S1 is noise in both runs, leaning +0.12 to +0.28 | 147/147 (run-1 gate) | `.claude/perf-lab/evidence/r3/int/r3-ripple-pos-varying/run1-judge.txt`, `run2-judge.txt`, `gate.txt` |

</details>

**Notes on the table.**

- **(a) Row 8's subject was corrected.** Until the messages gained their numbers, the subject of this commit said "by 3", but the code unrolls by 4: `src/shaders/scene/trails.glsl` has `for (int j = 0; j < TRAIL_CHUNK; j += 4)`, guarded by `#error trails.glsl unrolls by 4`. `3440a41` now says "by 4".
- **A cost from round 1 that no longer shows.** At integration 1 the stack raised cold first draw → gpu done by 22.5 to 30.5 ms against origin/main, a LOSS in 8 of 8 cells, bisected to row 5, `3cbb8ec` (lab stack 443f903; `.claude/perf-lab/evidence/int-r1/integration.md`). On the final tip against origin/main, that row is noise in all 8 cold cells, from -16.3% to +3.1% (`.claude/perf-lab/evidence/final/startup/startup-verdict.md`).
- **Five tool commits follow the perf commits and are not in the table:** `5046709`, `9a08e97`, `28f2f6c`, `6d4e026`, `637f55d`, then ae57938 (three lines of `docs/scene-features.md`), the commit that adds this report, and a review fix to `startup.mjs --bundle` (Cost map). They add `scripts/cpu.mjs`, `scripts/startup.mjs` and `scripts/batch.mjs`, their npm scripts, and the CLAUDE.md lines for them. `git diff --stat 0378378 637f55d` touches only CLAUDE.md, package.json and those three scripts (5 files, 2,008 insertions), with nothing under `src/`.

## Combined result

**What was compared.**

- **Sides.** The full branch against origin/main 23cd98e. The blocks ran on e84cf1d, the branch before its commit messages gained their numbers; the rewording changed messages only, so 637f55d has the same tree (`git diff e84cf1d 637f55d` is empty) and the raw JSON records e84cf1d. The commits on top change only `docs/` and the `startup.mjs --bundle` matcher, nothing under `src/` or in the build.
- **When and where.** Every block ran on 2026-10-28 between 22:42 and 23:09, in the boot that started 14:27 (rounds log), on the RX 9060 XT (radeonsi gfx1200 ACO via ANGLE-GL, Mesa 26.2.2). The perf, batch, CPU and start-up JSON all record that renderer string.
- **Two runs per block.** Run 2 is a second process in the same boot, not a separate boot.
- **Clean trees.** Both checkouts were clean, with 0 porcelain lines and HEAD e84cf1d / 23cd98e (`.claude/perf-lab/evidence/final/bundle/trees-clean.txt`, `.claude/perf-lab/evidence/final/checks/status-porcelain.txt`).
- **Timing.** Perf ran 22:42:21 to 22:45:32 (`.claude/perf-lab/evidence/final/perf/run-final-perf.log`) and CPU ran 22:55:56 to 23:01:09 (`.claude/perf-lab/evidence/final/cpu/run.log`). By file time, the batch JSON was written 22:50:13 to 22:52:27 and the start-up JSON 23:06:20 to 23:08:41.

| metric | size | run 1: base → head | Δ% | run 2: base → head | Δ% | evidence |
|---|---|---|---|---|---|---|
| frozen frame, µs | S1 | 88.44 → 43.26 | -51.03 | 88.42 → 43.32 | -50.85 | `.claude/perf-lab/evidence/final/perf/summary.md` |
| frozen frame, µs | S2 | 243.62 → 109.58 | -55.00 | 243.78 → 110.26 | -54.75 | `.claude/perf-lab/evidence/final/perf/summary.md` |
| whole batch, MID, µs/frame | S1 | 94.22 → 47.10 | -50.01 | 96.00 → 46.73 | -51.32 | `.claude/perf-lab/evidence/final/batch/table.md` |
| whole batch, MID, µs/frame | S2 | 245.55 → 112.78 | -54.07 | 245.72 → 113.11 | -53.97 | `.claude/perf-lab/evidence/final/batch/table.md` |

**How the headline numbers are computed.**

- **Frozen frame.** The median over the four standard queries (MID, NOON, DUSK, NIGHT) of each query's median of per-run medians. Its Δ µs and Δ% are the medians of the four per-query Δ µs and Δ%, so they differ slightly from head − base and (head − base) / base of the medians.
- **Whole batch.** One TIME_ELAPSED query over 30 `koi.step` frames, 20 batches per page load. Run 1 had 7 page loads per side and run 2 had 9.
- **Results.** Every headline cell is a win in both runs. The largest frozen-frame threshold is 5.52 µs against a median per-query Δ of -133.42 µs (S2, run 2); the largest batch threshold among these four cells is 15.96 µs against -49.27 µs (S1 MID, run 2).

### Frozen frame per pass (`npm run perf`)

- **Setup.** Run 1 had 7 page loads per side and run 2 had 9, each × 400 frames, over 10 queries per size: the 4 standard queries plus mono, paper, brand, glow=off, intensity=0.5 and view=raw.
- **Sources.** All numbers are from `.claude/perf-lab/evidence/final/perf/summary.md`, which is built from `.claude/perf-lab/evidence/final/perf/run1-s1.json`, `run1-s2.json`, `run2-s1.json` and `run2-s2.json`.

| pass | S1 run 1 | S1 run 2 | S2 run 1 | S2 run 2 | max thr, S1 (r1; r2) | max thr, S2 (r1; r2) |
|---|---|---|---|---|---|---|
| frame | 88.44 → 43.26 (-51.03%) | 88.42 → 43.32 (-50.85%) | 243.62 → 109.58 (-55.00%) | 243.78 → 110.26 (-54.75%) | 5.20; 4.24 | 4.24; 5.52 |
| scene | 33.28 → 18.94 (-42.85%) | 33.28 → 18.96 (-42.73%) | 18.80 → 11.14 (-40.41%) | 18.80 → 11.18 (-40.09%) | 2.32; 0.72 | 0.40; 0.40 |
| ascii | 31.70 → 15.64 (-50.73%) | 31.70 → 15.60 (-50.76%) | 209.50 → 93.38 (-55.42%) | 209.56 → 94.00 (-55.16%) | 2.72; 3.84 | 3.52; 4.40 |
| glow | 22.78 → 5.50 (-76.03%) | 22.86 → 5.52 (-75.85%) | 15.40 → 3.08 (-80.00%) | 15.44 → 3.12 (-79.79%) | 2.64; 1.20 | 0.08; 0.08 |
| emission (head only) | 3.30 | 3.30 | 1.88 | 1.88 | one-sided | one-sided |
| fly | 0.00 → 0.00 | 0.00 → 0.00 | 0.08 → 0.12 (LOSS, thr 0) | 0.08 → 0.12 (noise, thr 0.08) | 0.00; 0.00 | 0.00; 0.08 |

**Per-pass results.**

- **Standard queries.** frame, scene, ascii and glow win in 4 of 4 standard-query cells at both sizes in both runs.
- **Extra queries.** All 24 extra-query cells (frame and ascii × 6 queries × 2 sizes) win in both runs:
  - frame: -43.50% to -51.06% at S1, -46.75% to -59.16% at S2
  - ascii: -44.22% to -54.00% at S1, -47.51% to -60.71% at S2

  The view=raw rows are the smallest gains at both sizes (`.claude/perf-lab/evidence/final/perf/summary-extra.md`).
- **Glow with emission.** Head glow + emission is 8.80 / 8.82 µs at S1 against 22.78 / 22.86 µs for base glow (-61.4%). At S2 it is 4.96 / 5.00 µs against 15.40 / 15.44 µs (-67.8% / -67.6%). These are sums of the two passes' medians, not a per-run sum.
- **Verdict lines.**
  - Run 1: "verdict LOSS; 90 cells: win 74, one-sided 14, noise 1, loss 1".
  - Run 2: "verdict WIN-A; 90 cells: win 74, one-sided 14, noise 2".
- **The run-1 LOSS.** The one LOSS is fly at S2 DUSK: 0.08 → 0.12 µs, Δ +0.04, which is one timer step, against a threshold of 0 because both sides had zero spread.
  - Run 2 classes the same cell as noise (thr 0.08), and the advancing-frame run has fly at 0.12 → 0.12 µs in both runs (`.claude/perf-lab/evidence/final/cpu/table.md`).
  - The fly shaders are unchanged: `git diff --quiet origin/main HEAD -- src/shaders/fly.frag src/shaders/fly.vert` exits 0.
  - Since r2-scene-layer-split, the fish-layer draw runs just before the fly draw. That ordering may explain the change, but it was not tested.

<details><summary>Extra queries, frame and ascii, both runs (verbatim from .claude/perf-lab/evidence/final/perf/summary-extra.md)</summary>

| size | query | pass | r1 base | r1 head | r1 Δ | r1 Δ% | r1 thr | r1 class | r2 base | r2 head | r2 Δ | r2 Δ% | r2 thr | r2 class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | palette=mono | frame | 96.16 | 48.12 | -48.04 | -49.96 | 11.12 | win | 96.76 | 48.12 | -48.64 | -50.27 | 6.64 | win |
| S1 | palette=mono | ascii | 39.56 | 20.32 | -19.24 | -48.63 | 3.84 | win | 39.88 | 20.28 | -19.60 | -49.15 | 2.48 | win |
| S1 | palette=paper | frame | 64.16 | 33.12 | -31.04 | -48.38 | 0.96 | win | 64.20 | 33.00 | -31.20 | -48.60 | 0.96 | win |
| S1 | palette=paper | ascii | 30.56 | 14.08 | -16.48 | -53.93 | 0.40 | win | 30.56 | 14.08 | -16.48 | -53.93 | 0.64 | win |
| S1 | palette=brand | frame | 88.52 | 43.44 | -45.08 | -50.93 | 9.28 | win | 88.68 | 43.40 | -45.28 | -51.06 | 1.68 | win |
| S1 | palette=brand | ascii | 31.68 | 15.60 | -16.08 | -50.76 | 3.12 | win | 31.68 | 15.64 | -16.04 | -50.63 | 0.80 | win |
| S1 | glow=off | frame | 64.04 | 33.00 | -31.04 | -48.47 | 0.56 | win | 64.08 | 33.04 | -31.04 | -48.44 | 0.56 | win |
| S1 | glow=off | ascii | 30.44 | 14.04 | -16.40 | -53.88 | 0.40 | win | 30.52 | 14.04 | -16.48 | -54.00 | 0.40 | win |
| S1 | intensity=0.5 | frame | 88.24 | 44.16 | -44.08 | -49.95 | 0.88 | win | 88.44 | 44.12 | -44.32 | -50.11 | 2.64 | win |
| S1 | intensity=0.5 | ascii | 31.64 | 16.28 | -15.36 | -48.55 | 0.88 | win | 31.68 | 16.28 | -15.40 | -48.61 | 0.96 | win |
| S1 | view=raw | frame | 57.20 | 32.20 | -25.00 | -43.71 | 2.24 | win | 57.20 | 32.32 | -24.88 | -43.50 | 0.64 | win |
| S1 | view=raw | ascii | 23.84 | 13.16 | -10.68 | -44.80 | 0.80 | win | 23.88 | 13.32 | -10.56 | -44.22 | 0.48 | win |
| S2 | palette=mono | frame | 303.56 | 147.76 | -155.80 | -51.32 | 3.52 | win | 303.60 | 147.08 | -156.52 | -51.55 | 2.88 | win |
| S2 | palette=mono | ascii | 269.44 | 131.40 | -138.04 | -51.23 | 3.20 | win | 269.48 | 130.72 | -138.76 | -51.49 | 3.52 | win |
| S2 | palette=paper | frame | 227.16 | 93.72 | -133.44 | -58.74 | 4.00 | win | 227.20 | 93.72 | -133.48 | -58.75 | 3.04 | win |
| S2 | palette=paper | ascii | 208.00 | 82.76 | -125.24 | -60.21 | 3.28 | win | 208.00 | 82.68 | -125.32 | -60.25 | 3.28 | win |
| S2 | palette=brand | frame | 243.92 | 109.32 | -134.60 | -55.18 | 2.96 | win | 243.80 | 109.76 | -134.04 | -54.98 | 2.40 | win |
| S2 | palette=brand | ascii | 209.48 | 93.00 | -116.48 | -55.60 | 3.04 | win | 209.52 | 93.44 | -116.08 | -55.40 | 2.08 | win |
| S2 | glow=off | frame | 227.40 | 93.96 | -133.44 | -58.68 | 2.80 | win | 226.84 | 92.64 | -134.20 | -59.16 | 3.52 | win |
| S2 | glow=off | ascii | 208.40 | 82.80 | -125.60 | -60.27 | 2.72 | win | 207.88 | 81.68 | -126.20 | -60.71 | 3.36 | win |
| S2 | intensity=0.5 | frame | 243.84 | 115.92 | -127.92 | -52.46 | 4.56 | win | 243.44 | 115.00 | -128.44 | -52.76 | 2.96 | win |
| S2 | intensity=0.5 | ascii | 209.64 | 99.52 | -110.12 | -52.53 | 3.84 | win | 209.32 | 98.68 | -110.64 | -52.86 | 3.76 | win |
| S2 | view=raw | frame | 170.28 | 90.68 | -79.60 | -46.75 | 4.96 | win | 170.76 | 90.80 | -79.96 | -46.83 | 4.64 | win |
| S2 | view=raw | ascii | 151.72 | 79.64 | -72.08 | -47.51 | 4.64 | win | 152.08 | 79.64 | -72.44 | -47.63 | 4.32 | win |

</details>

### Whole-batch frame cost (`npm run batch`)

- **Result.** All 28 cells win (7 queries × 2 sizes × 2 runs). `.claude/perf-lab/evidence/final/batch/verdict-run1.txt` and `verdict-run2.txt` both end "verdict (targets batch): WIN-A".
- **Δ% ranges over the 7 queries.**
  - S1: -48.46% to -50.82% in run 1, -48.13% to -51.32% in run 2.
  - S2: -50.62% to -58.18% in run 1, -50.93% to -58.45% in run 2.
- **Comparison with the frozen frame.** The batch numbers sit 2 to 6 µs above the frozen-frame numbers. In run 1 at MID, S1 is 94.22 → 47.10 against a frozen 88.20 → 43.24, and S2 is 245.55 → 112.78 against 243.56 → 109.12 (`.claude/perf-lab/evidence/final/perf/run1-s1.stderr`, `run1-s2.stderr`, line 10). The Δ% is about the same while the pond advances.
- **Base spread at S1.** The base spread is large at S1, up to 14.12 µs for glow=off in run 2, against head spreads of at most 4.11 µs. The largest threshold, 28.24 µs (S1 glow=off, run 2), is 0.79 × |Δ|.

GPU clock over each batch trace (`.claude/perf-lab/evidence/final/batch/clock-summary.txt`, from the `clock-run*-s*.tsv` traces; base and head pages are interleaved in each trace):

| trace | duration | sclk p50 | sclk ≥ 2500 MHz | mclk p50 | busy p50 / p90 |
|---|---|---|---|---|---|
| run1-s1 | 29.3 s | 814 MHz | 0.8% | 96 MHz | 9 / 57 % |
| run2-s1 | 36.5 s | 811 MHz | 1.0% | 96 MHz | 9 / 56 % |
| run1-s2 | 34.1 s | 1345 MHz | 35.3% | 875 MHz | 21 / 100 % |
| run2-s2 | 43.0 s | 1391 MHz | 35.4% | 875 MHz | 22 / 100 % |

<details><summary>All 28 batch cells (verbatim from .claude/perf-lab/evidence/final/batch/table.md)</summary>

| run | size | query | metric | base | head | Δ µs | Δ% | spread base | spread head | threshold | class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| run1 | S1 | MID `?debug` | batch µs/frame | 94.22 | 47.1 | -47.12 | -50.01 | 6.11 | 0.68 | 12.22 | win |
| run1 | S1 | NOON `?debug&time=fixed&phase=0.5&sky=all` | batch µs/frame | 92.88 | 46.45 | -46.43 | -49.99 | 5.43 | 0.78 | 10.86 | win |
| run1 | S1 | DUSK `?debug&time=fixed&phase=0.83&sky=all` | batch µs/frame | 95.34 | 46.89 | -48.45 | -50.82 | 6.3 | 0.6 | 12.6 | win |
| run1 | S1 | NIGHT `?debug&time=fixed&phase=0&sky=all` | batch µs/frame | 93.58 | 46.58 | -47 | -50.22 | 5.19 | 0.79 | 10.38 | win |
| run1 | S1 | mono `?debug&palette=mono` | batch µs/frame | 104.11 | 52.15 | -51.96 | -49.91 | 9.33 | 3.66 | 18.66 | win |
| run1 | S1 | paper `?debug&palette=paper` | batch µs/frame | 73.73 | 37.23 | -36.5 | -49.5 | 13.01 | 0.49 | 26.02 | win |
| run1 | S1 | glow=off `?debug&glow=off` | batch µs/frame | 73.05 | 37.65 | -35.4 | -48.46 | 9.69 | 0.6 | 19.38 | win |
| run1 | S2 | MID `?debug` | batch µs/frame | 245.55 | 112.78 | -132.77 | -54.07 | 1.18 | 2.22 | 4.44 | win |
| run1 | S2 | NOON `?debug&time=fixed&phase=0.5&sky=all` | batch µs/frame | 246.08 | 112.5 | -133.58 | -54.28 | 1.51 | 1.8 | 3.6 | win |
| run1 | S2 | DUSK `?debug&time=fixed&phase=0.83&sky=all` | batch µs/frame | 245.94 | 113.55 | -132.39 | -53.83 | 1.33 | 3.71 | 7.42 | win |
| run1 | S2 | NIGHT `?debug&time=fixed&phase=0&sky=all` | batch µs/frame | 246.16 | 114.05 | -132.11 | -53.67 | 0.97 | 0.91 | 1.94 | win |
| run1 | S2 | mono `?debug&palette=mono` | batch µs/frame | 305.78 | 150.99 | -154.79 | -50.62 | 2.51 | 1.23 | 5.02 | win |
| run1 | S2 | paper `?debug&palette=paper` | batch µs/frame | 234.95 | 98.73 | -136.22 | -57.98 | 2.13 | 2.34 | 4.68 | win |
| run1 | S2 | glow=off `?debug&glow=off` | batch µs/frame | 234.91 | 98.23 | -136.68 | -58.18 | 2.25 | 2.42 | 4.84 | win |
| run2 | S1 | MID `?debug` | batch µs/frame | 96 | 46.73 | -49.27 | -51.32 | 7.98 | 0.81 | 15.96 | win |
| run2 | S1 | NOON `?debug&time=fixed&phase=0.5&sky=all` | batch µs/frame | 90.71 | 46.61 | -44.1 | -48.62 | 7.08 | 0.79 | 14.16 | win |
| run2 | S1 | DUSK `?debug&time=fixed&phase=0.83&sky=all` | batch µs/frame | 92.16 | 46.89 | -45.27 | -49.12 | 5.15 | 0.49 | 10.3 | win |
| run2 | S1 | NIGHT `?debug&time=fixed&phase=0&sky=all` | batch µs/frame | 91.52 | 46.75 | -44.77 | -48.92 | 2.82 | 0.84 | 5.64 | win |
| run2 | S1 | mono `?debug&palette=mono` | batch µs/frame | 100.45 | 52.1 | -48.35 | -48.13 | 9.7 | 4.11 | 19.4 | win |
| run2 | S1 | paper `?debug&palette=paper` | batch µs/frame | 73.31 | 37.43 | -35.88 | -48.94 | 13.7 | 0.91 | 27.4 | win |
| run2 | S1 | glow=off `?debug&glow=off` | batch µs/frame | 73.48 | 37.6 | -35.88 | -48.83 | 14.12 | 0.36 | 28.24 | win |
| run2 | S2 | MID `?debug` | batch µs/frame | 245.72 | 113.11 | -132.61 | -53.97 | 1.58 | 2 | 4 | win |
| run2 | S2 | NOON `?debug&time=fixed&phase=0.5&sky=all` | batch µs/frame | 245.6 | 113.65 | -131.95 | -53.73 | 2.88 | 2.7 | 5.76 | win |
| run2 | S2 | DUSK `?debug&time=fixed&phase=0.83&sky=all` | batch µs/frame | 246.14 | 113.12 | -133.02 | -54.04 | 1.3 | 3.98 | 7.96 | win |
| run2 | S2 | NIGHT `?debug&time=fixed&phase=0&sky=all` | batch µs/frame | 246.34 | 113.42 | -132.92 | -53.96 | 2.23 | 2 | 4.46 | win |
| run2 | S2 | mono `?debug&palette=mono` | batch µs/frame | 305.22 | 149.78 | -155.44 | -50.93 | 2.62 | 2.86 | 5.72 | win |
| run2 | S2 | paper `?debug&palette=paper` | batch µs/frame | 234.36 | 98.74 | -135.62 | -57.87 | 1.09 | 2.56 | 5.12 | win |
| run2 | S2 | glow=off `?debug&glow=off` | batch µs/frame | 234.66 | 97.5 | -137.16 | -58.45 | 1.35 | 2.11 | 4.22 | win |

</details>

### CPU step and allocation (`npm run cpu`)

- **Setup.** Each mode ran MID and DUSK at both sizes. Step: 7 (run 1) or 9 (run 2) page loads × 600 frames in batches of 30, timer step 5 µs. Allocation: 7 page loads × 3000 frames in both runs, V8 heap sampling every 256 B. `--gpu`: 7 or 9 page loads × 600 advancing frames (headers of `.claude/perf-lab/evidence/final/cpu/run{1,2}-{step,alloc,gpu}-s1.stderr`; commands in `.claude/perf-lab/evidence/final/cpu/run.log`).
- **Sources.** All numbers are from `.claude/perf-lab/evidence/final/cpu/table.md`, which is built from `.claude/perf-lab/evidence/final/cpu/run{1,2}-{step,alloc,gpu}-s{1,2}.json`. The judge output is `.claude/perf-lab/evidence/final/cpu/judge.txt`.

| metric | S1 MID, run 1 / run 2 | S2 MID, run 1 / run 2 | Δ% over all 8 cells | class |
|---|---|---|---|---|
| step CPU, ms | 0.0481 → 0.0407 / 0.0484 → 0.0414 | 0.0497 → 0.0405 / 0.0503 → 0.0415 | -14.5 to -25.3 | noise in 8 of 8 (\|Δ\| is 0.30x to 0.83x thr) |
| allocated, B/frame | 34,520 → 5,887 / 34,534 → 5,865 | 33,626 → 4,735 / 33,604 → 4,760 | -82.9 to -89.7 | win in 8 of 8 |
| minor GCs / 3000 frames | 60 → 21 / 60 → 21 | 62 → 23 / 62 → 23 | -62.9 to -68.3 | win in 8 of 8 |
| GC µs/frame | 3.040 → 1.248 / 3.046 → 1.217 | 3.315 → 1.606 / 3.342 → 1.635 | -51.1 to -64.2 | win in 8 of 8 |
| advancing GPU frame, µs (`--gpu`) | 94.20 → 47.32 / 92.80 → 47.36 | 249.32 → 112.56 / 249.32 → 112.80 | -49.0 to -54.9 | win in 8 of 8 |
| advancing ascii, µs | 31.76 → 15.68 / 31.64 → 15.68 | 209.76 → 93.60 / 209.76 → 93.88 | -50.4 to -55.4 | win in 8 of 8 |
| advancing scene, µs | 33.48 → 18.60 / 33.24 → 18.56 | 18.88 → 9.84 / 19.08 → 9.84 | -43.0 to -48.4 | win in 8 of 8 |
| advancing glow, µs | 22.80 → 5.36 / 23.48 → 5.32 | 15.40 → 3.00 / 15.40 → 3.00 | -76.5 to -80.5 | win in 8 of 8 |
| advancing ripple, µs | 4.32 → 4.36 / 4.32 → 4.40 | 4.48 → 4.08 / 4.48 → 4.08 | S1 +1.9 to -5.6; S2 -8.9 | S2 win in 4 of 4; S1 noise in 4 of 4 |

**CPU results.**

- **Step CPU is NULL.** Every cell's median falls by 14.5% to 25.3%, but no cell beats its threshold.
- **Emission and fly in the advancing frame.** Emission is head only: 3.32 to 3.36 µs at S1 and 2.08 to 2.48 µs at S2. Fly is 0.04 → 0.04 µs at S1 DUSK and 0.12 → 0.12 µs at S2 DUSK in both runs.
- **What the head still allocates (run 1, S1 MID).** Head allocates 5,887 B/frame in total (`.claude/perf-lab/evidence/final/cpu/run1-alloc-s1.stderr`):
  - koi.ts: 2,851 B/frame, of which 2,342 B is `update` at koi.ts:277
  - lighting.ts: 870 B/frame
  - renderer.ts: 585 B/frame
  - native: 455 B/frame
  - pond.ts: 247 B/frame
  - demo/debug/ui.ts and demo/debug/api.ts: 493 B/frame together, about the same on base. These are `?debug` overhead, not library cost.

<details><summary>All 84 CPU rows, both runs (verbatim from .claude/perf-lab/evidence/final/cpu/table.md)</summary>

| run | size | query | metric | base | head | Δ | Δ% | spread base | spread head | threshold | class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | S1 | MID | step cpu ms | 0.0481 | 0.0407 | -0.0074 | -15.4% | 0.0051 | 0.0021 | 0.0102 | noise |
| 1 | S1 | DUSK | step cpu ms | 0.0519 | 0.0411 | -0.0108 | -20.8% | 0.0029 | 0.0072 | 0.0144 | noise |
| 1 | S2 | MID | step cpu ms | 0.0497 | 0.0405 | -0.0092 | -18.5% | 0.0129 | 0.0059 | 0.0258 | noise |
| 1 | S2 | DUSK | step cpu ms | 0.0516 | 0.0409 | -0.0107 | -20.7% | 0.003 | 0.0104 | 0.0208 | noise |
| 1 | S1 | MID | alloc B/frame | 34520 | 5887 | -28633 | -82.9% | 273 | 61 | 546 | win (52.44x) |
| 1 | S1 | DUSK | alloc B/frame | 34652 | 4590 | -30062 | -86.8% | 129 | 57 | 258 | win (116.52x) |
| 1 | S2 | MID | alloc B/frame | 33626 | 4735 | -28891 | -85.9% | 131 | 38 | 262 | win (110.27x) |
| 1 | S2 | DUSK | alloc B/frame | 33746 | 3480 | -30266 | -89.7% | 220 | 97 | 440 | win (68.79x) |
| 1 | S1 | MID | minor GCs /3000 fr | 60 | 21 | -39 | -65% | 0 | 1 | 2 | win (19.5x) |
| 1 | S1 | DUSK | minor GCs /3000 fr | 60 | 19 | -41 | -68.3% | 1 | 1 | 2 | win (20.5x) |
| 1 | S2 | MID | minor GCs /3000 fr | 62 | 23 | -39 | -62.9% | 6 | 4 | 12 | win (3.25x) |
| 1 | S2 | DUSK | minor GCs /3000 fr | 63 | 20 | -43 | -68.3% | 6 | 5 | 12 | win (3.58x) |
| 1 | S1 | MID | GC us/frame | 3.04 | 1.248 | -1.792 | -58.9% | 0.19 | 0.432 | 0.864 | win (2.07x) |
| 1 | S1 | DUSK | GC us/frame | 3.036 | 1.128 | -1.908 | -62.8% | 0.354 | 0.208 | 0.708 | win (2.69x) |
| 1 | S2 | MID | GC us/frame | 3.315 | 1.606 | -1.709 | -51.6% | 0.495 | 0.258 | 0.99 | win (1.73x) |
| 1 | S2 | DUSK | GC us/frame | 3.407 | 1.481 | -1.926 | -56.5% | 0.404 | 0.181 | 0.808 | win (2.38x) |
| 1 | S1 | MID | gpu µs ripple | 4.32 | 4.36 | +0.04 | +0.9% | 0.08 | 0.56 | 1.12 | noise |
| 1 | S1 | DUSK | gpu µs ripple | 4.32 | 4.08 | -0.24 | -5.6% | 0.84 | 0.64 | 1.68 | noise |
| 1 | S2 | MID | gpu µs ripple | 4.48 | 4.08 | -0.4 | -8.9% | 0.04 | 0.04 | 0.08 | win (5x) |
| 1 | S2 | DUSK | gpu µs ripple | 4.48 | 4.08 | -0.4 | -8.9% | 0.04 | 0.04 | 0.08 | win (5x) |
| 1 | S1 | MID | gpu µs scene | 33.48 | 18.6 | -14.88 | -44.4% | 2 | 0.12 | 4 | win (3.72x) |
| 1 | S1 | DUSK | gpu µs scene | 32.8 | 18.68 | -14.12 | -43% | 2.12 | 0.2 | 4.24 | win (3.33x) |
| 1 | S2 | MID | gpu µs scene | 18.88 | 9.84 | -9.04 | -47.9% | 1.08 | 0.32 | 2.16 | win (4.19x) |
| 1 | S2 | DUSK | gpu µs scene | 18.88 | 9.8 | -9.08 | -48.1% | 0.28 | 0.12 | 0.56 | win (16.21x) |
| 1 | S1 | MID | gpu µs ascii | 31.76 | 15.68 | -16.08 | -50.6% | 0.48 | 0.08 | 0.96 | win (16.75x) |
| 1 | S1 | DUSK | gpu µs ascii | 33.2 | 15.72 | -17.48 | -52.7% | 1.32 | 0.08 | 2.64 | win (6.62x) |
| 1 | S2 | MID | gpu µs ascii | 209.76 | 93.6 | -116.16 | -55.4% | 1.32 | 2.04 | 4.08 | win (28.47x) |
| 1 | S2 | DUSK | gpu µs ascii | 209.72 | 94.24 | -115.48 | -55.1% | 1.04 | 1.76 | 3.52 | win (32.81x) |
| 1 | S1 | MID | gpu µs glow | 22.8 | 5.36 | -17.44 | -76.5% | 1.8 | 0.04 | 3.6 | win (4.84x) |
| 1 | S1 | DUSK | gpu µs glow | 23.08 | 5.36 | -17.72 | -76.8% | 1.08 | 0.08 | 2.16 | win (8.2x) |
| 1 | S2 | MID | gpu µs glow | 15.4 | 3 | -12.4 | -80.5% | 0 | 0.04 | 0.08 | win (155x) |
| 1 | S2 | DUSK | gpu µs glow | 15.24 | 3 | -12.24 | -80.3% | 0.04 | 0.04 | 0.08 | win (153x) |
| 1 | S1 | MID | gpu µs emission | — | 3.32 | — | — | — | — | — | head only |
| 1 | S1 | DUSK | gpu µs emission | — | 3.36 | — | — | — | — | — | head only |
| 1 | S2 | MID | gpu µs emission | — | 2.48 | — | — | — | — | — | head only |
| 1 | S2 | DUSK | gpu µs emission | — | 2.08 | — | — | — | — | — | head only |
| 1 | S1 | DUSK | gpu µs fly | 0.04 | 0.04 | 0 | 0% | 0 | 0 | 0 | noise |
| 1 | S2 | DUSK | gpu µs fly | 0.12 | 0.12 | 0 | 0% | 0 | 0.04 | 0.08 | noise |
| 1 | S1 | MID | gpu µs frame | 94.2 | 47.32 | -46.88 | -49.8% | 3.52 | 0.16 | 7.04 | win (6.66x) |
| 1 | S1 | DUSK | gpu µs frame | 95.2 | 47.56 | -47.64 | -50% | 1.84 | 0.64 | 3.68 | win (12.95x) |
| 1 | S2 | MID | gpu µs frame | 249.32 | 112.56 | -136.76 | -54.9% | 1.4 | 1.88 | 3.76 | win (36.37x) |
| 1 | S2 | DUSK | gpu µs frame | 249.52 | 113.28 | -136.24 | -54.6% | 1 | 1.64 | 3.28 | win (41.54x) |
| 2 | S1 | MID | step cpu ms | 0.0484 | 0.0414 | -0.007 | -14.5% | 0.0037 | 0.0042 | 0.0084 | noise |
| 2 | S1 | DUSK | step cpu ms | 0.0526 | 0.0417 | -0.0109 | -20.7% | 0.0073 | 0.0044 | 0.0146 | noise |
| 2 | S2 | MID | step cpu ms | 0.0503 | 0.0415 | -0.0088 | -17.5% | 0.0108 | 0.0044 | 0.0216 | noise |
| 2 | S2 | DUSK | step cpu ms | 0.0537 | 0.0401 | -0.0136 | -25.3% | 0.0224 | 0.0086 | 0.0448 | noise |
| 2 | S1 | MID | alloc B/frame | 34534 | 5865 | -28669 | -83% | 166 | 72 | 332 | win (86.35x) |
| 2 | S1 | DUSK | alloc B/frame | 34686 | 4598 | -30088 | -86.7% | 117 | 40 | 234 | win (128.58x) |
| 2 | S2 | MID | alloc B/frame | 33604 | 4760 | -28844 | -85.8% | 154 | 44 | 308 | win (93.65x) |
| 2 | S2 | DUSK | alloc B/frame | 33833 | 3476 | -30357 | -89.7% | 233 | 39 | 466 | win (65.14x) |
| 2 | S1 | MID | minor GCs /3000 fr | 60 | 21 | -39 | -65% | 1 | 1 | 2 | win (19.5x) |
| 2 | S1 | DUSK | minor GCs /3000 fr | 60 | 19 | -41 | -68.3% | 0 | 1 | 2 | win (20.5x) |
| 2 | S2 | MID | minor GCs /3000 fr | 62 | 23 | -39 | -62.9% | 6 | 5 | 12 | win (3.25x) |
| 2 | S2 | DUSK | minor GCs /3000 fr | 62 | 21 | -41 | -66.1% | 6 | 5 | 12 | win (3.42x) |
| 2 | S1 | MID | GC us/frame | 3.046 | 1.217 | -1.829 | -60% | 0.168 | 0.111 | 0.336 | win (5.44x) |
| 2 | S1 | DUSK | GC us/frame | 3.006 | 1.077 | -1.929 | -64.2% | 0.166 | 0.167 | 0.334 | win (5.78x) |
| 2 | S2 | MID | GC us/frame | 3.342 | 1.635 | -1.707 | -51.1% | 0.327 | 0.291 | 0.654 | win (2.61x) |
| 2 | S2 | DUSK | GC us/frame | 3.311 | 1.563 | -1.748 | -52.8% | 0.648 | 0.165 | 1.296 | win (1.35x) |
| 2 | S1 | MID | gpu µs ripple | 4.32 | 4.4 | +0.08 | +1.9% | 0.12 | 0.36 | 0.72 | noise |
| 2 | S1 | DUSK | gpu µs ripple | 4.32 | 4.08 | -0.24 | -5.6% | 0.88 | 0.6 | 1.76 | noise |
| 2 | S2 | MID | gpu µs ripple | 4.48 | 4.08 | -0.4 | -8.9% | 0.04 | 0.04 | 0.08 | win (5x) |
| 2 | S2 | DUSK | gpu µs ripple | 4.48 | 4.08 | -0.4 | -8.9% | 0.04 | 0.08 | 0.16 | win (2.5x) |
| 2 | S1 | MID | gpu µs scene | 33.24 | 18.56 | -14.68 | -44.2% | 1.6 | 0.24 | 3.2 | win (4.59x) |
| 2 | S1 | DUSK | gpu µs scene | 34.08 | 18.64 | -15.44 | -45.3% | 2.88 | 0.24 | 5.76 | win (2.68x) |
| 2 | S2 | MID | gpu µs scene | 19.08 | 9.84 | -9.24 | -48.4% | 0.96 | 0.4 | 1.92 | win (4.81x) |
| 2 | S2 | DUSK | gpu µs scene | 18.76 | 9.88 | -8.88 | -47.3% | 0.24 | 0.2 | 0.48 | win (18.5x) |
| 2 | S1 | MID | gpu µs ascii | 31.64 | 15.68 | -15.96 | -50.4% | 0.44 | 0.04 | 0.88 | win (18.14x) |
| 2 | S1 | DUSK | gpu µs ascii | 31.76 | 15.68 | -16.08 | -50.6% | 1.64 | 0.12 | 3.28 | win (4.9x) |
| 2 | S2 | MID | gpu µs ascii | 209.76 | 93.88 | -115.88 | -55.2% | 0.76 | 2.32 | 4.64 | win (24.97x) |
| 2 | S2 | DUSK | gpu µs ascii | 209.68 | 93.96 | -115.72 | -55.2% | 0.8 | 1.92 | 3.84 | win (30.14x) |
| 2 | S1 | MID | gpu µs glow | 23.48 | 5.32 | -18.16 | -77.3% | 2.76 | 0.08 | 5.52 | win (3.29x) |
| 2 | S1 | DUSK | gpu µs glow | 23.32 | 5.36 | -17.96 | -77% | 1.52 | 0.04 | 3.04 | win (5.91x) |
| 2 | S2 | MID | gpu µs glow | 15.4 | 3 | -12.4 | -80.5% | 0 | 0.04 | 0.08 | win (155x) |
| 2 | S2 | DUSK | gpu µs glow | 15.28 | 3 | -12.28 | -80.4% | 0.08 | 0.04 | 0.16 | win (76.75x) |
| 2 | S1 | MID | gpu µs emission | — | 3.36 | — | — | — | — | — | head only |
| 2 | S1 | DUSK | gpu µs emission | — | 3.36 | — | — | — | — | — | head only |
| 2 | S2 | MID | gpu µs emission | — | 2.4 | — | — | — | — | — | head only |
| 2 | S2 | DUSK | gpu µs emission | — | 2.2 | — | — | — | — | — | head only |
| 2 | S1 | DUSK | gpu µs fly | 0.04 | 0.04 | 0 | 0% | 0 | 0 | 0 | noise |
| 2 | S2 | DUSK | gpu µs fly | 0.12 | 0.12 | 0 | 0% | 0 | 0.04 | 0.08 | noise |
| 2 | S1 | MID | gpu µs frame | 92.8 | 47.36 | -45.44 | -49% | 3.08 | 0.4 | 6.16 | win (7.38x) |
| 2 | S1 | DUSK | gpu µs frame | 94.2 | 47.56 | -46.64 | -49.5% | 5.36 | 0.44 | 10.72 | win (4.35x) |
| 2 | S2 | MID | gpu µs frame | 249.32 | 112.8 | -136.52 | -54.8% | 1.2 | 2.36 | 4.72 | win (28.92x) |
| 2 | S2 | DUSK | gpu µs frame | 249.2 | 113.28 | -135.92 | -54.5% | 1.32 | 1.84 | 3.68 | win (36.93x) |

</details>

### Start-up (`npm run startup`)

- **Setup.** 7 page loads per side, served from the build with a fresh Mesa cache, for ?seed=7 and ?debug at both sizes. The variants are cold, mesaWarm, warm and diskWarm.
- **Sources.** The JSON is `.claude/perf-lab/evidence/final/startup/run{1,2}-s{1,2}.json`.
- **Verdict.** `.claude/perf-lab/evidence/final/startup/startup-verdict.md` sums up as "cells: 416; WIN 133, noise 282, LOSS 1". It was written by `startup-verdict.mjs`, because `bin/verdict.mjs` throws a TypeError on start-up JSON (`.claude/perf-lab/evidence/final/startup/verdict-mjs-attempt.stderr`).
- **mesaWarm is a second cold load.** After the cold and warm loads, the Mesa disk cache held 0 shader entries on both sides (`.claude/perf-lab/evidence/final/startup/run*-s*.stderr`), so mesaWarm got no Mesa cache hits.

<details><summary>Start-up rows, origin/main → 637f55d (13 rows)</summary>

| row (ms) | S1 ?seed=7, run 1 / run 2 | S2 ?seed=7, run 1 / run 2 | all cells of this row |
|---|---|---|---|
| cold nav → gpu done | 276.67 → 230.32 (-16.8%) / 278.07 → 230.75 (-17.0%) | 275.42 → 229.72 (-16.6%) / 277.42 → 230.66 (-16.9%) | WIN 8/8. ?debug: S1 324.43 → 275.71 / 323.85 → 270.89, S2 327.83 → 280.27 / 325.50 → 285.51 |
| mesaWarm nav → gpu done | 274.38 → 224.34 / 270.13 → 226.48 | 274.27 → 225.12 / 272.77 → 228.08 | WIN 8/8 |
| warm nav → gpu done | 54.81 → 49.41 / 54.81 → 49.67 | 55.78 → 49.16 / 55.04 → 49.91 | noise 8/8 (-0.1% to -11.9%) |
| diskWarm nav → gpu done, ?debug | 158.38 → 84.78 / 158.71 → 86.34 | 168.35 → 88.82 / 171.04 → 89.09 | WIN 4/4 for ?debug; ?seed=7 noise 4/4 |
| diskWarm first draw → gpu done, ?debug | 74.16 → 1.72 / 73.47 → 2.55 | 81.20 → 2.59 / 82.11 → 2.65 | WIN 4/4 |
| cold programs (wall) | 190.51 → 148.83 (run 1) | | WIN 8/8, Δ -39.62 to -41.69 |
| cold Σ link | 164.93 → 121.22 (run 1) | | WIN 8/8, Δ -42.22 to -44.42 |
| cold scene compile+link | 139.91 → 122.16 (run 1) | | WIN 4, noise 4; Δ -15.79 to -18.59 |
| cold glow compile+link | 34.60 → 7.45 (run 1) | | WIN 8/8; base 33.52 to 34.63, head 7.18 to 7.78 |
| cold emission program (head only) | 3.43 (run 1) | | head 3.30 to 3.57 in the 8 cold cells (`variants.cold["prog:emission"]` in the run JSON) |
| cold Σ compile | 24.45 → 26.75 (run 1) | | noise 8/8, Δ +1.85 to +3.42 (mesaWarm +1.54 to +3.13, noise 8/8) |
| cold ripple compile+link | 6.41 → 7.15 (run 1) | | noise 7, LOSS 1; Δ +0.47 to +1.20 (mesaWarm +0.27 to +1.07, noise 8/8) |
| cold first draw → gpu done | 36.03 → 30.16 (run 1) | | noise 8/8, -16.3% to +3.1% |

</details>

**Start-up results.**

- **Cold loads.** Most of the cold gain is link time. Σ link falls by 42 to 44 ms and programs (wall) by 40 to 42 ms, while Σ compile rises by 2 to 3 ms (noise).
- **The LOSS.** The one LOSS cell is run 2, S1, ?debug, cold ripple compile+link: 6.25 → 6.89 ms (+0.64, thr 0.51). Ripple compile+link moved up in all 16 cold and mesaWarm cells, but only that one beats its threshold.
- **?debug diskWarm.** Base spends 73 to 82 ms between first draw and gpu done; head spends 1.7 to 2.7 ms. This accounts for most of the 72 to 82 ms drop in nav → gpu done.

<details><summary>All 128 start-up target rows, both runs (verbatim from .claude/perf-lab/evidence/final/startup/startup-targets-table.md)</summary>

| run | size | query | variant | metric (ms) | base | head | Δ | Δ% | spread base | spread head | threshold | class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | S1 | ?seed=7 | cold | nav → gpu done | 276.67 | 230.32 | -46.35 | -16.8% | 11.80 | 8.97 | 23.61 | WIN (1.96x) |
| 1 | S1 | ?seed=7 | cold | scene compile+link | 139.91 | 122.16 | -17.75 | -12.7% | 3.69 | 4.78 | 9.56 | WIN (1.86x) |
| 1 | S1 | ?seed=7 | cold | all programs → first draw | 14.95 | 14.44 | -0.52 | -3.4% | 4.58 | 3.33 | 9.17 | noise |
| 1 | S1 | ?seed=7 | cold | first draw → gpu done | 36.03 | 30.16 | -5.87 | -16.3% | 3.85 | 3.52 | 7.69 | noise |
| 1 | S1 | ?seed=7 | mesaWarm | nav → gpu done | 274.38 | 224.34 | -50.03 | -18.2% | 6.90 | 6.71 | 13.80 | WIN (3.63x) |
| 1 | S1 | ?seed=7 | mesaWarm | scene compile+link | 140.03 | 121.21 | -18.82 | -13.4% | 7.54 | 3.96 | 15.07 | WIN (1.25x) |
| 1 | S1 | ?seed=7 | mesaWarm | all programs → first draw | 14.55 | 14.82 | +0.27 | +1.8% | 4.87 | 2.50 | 9.74 | noise |
| 1 | S1 | ?seed=7 | mesaWarm | first draw → gpu done | 33.86 | 27.66 | -6.21 | -18.3% | 7.16 | 3.22 | 14.32 | noise |
| 1 | S1 | ?seed=7 | warm | nav → gpu done | 54.81 | 49.41 | -5.40 | -9.8% | 5.83 | 9.19 | 18.38 | noise |
| 1 | S1 | ?seed=7 | warm | scene compile+link | 4.50 | 3.42 | -1.08 | -24.0% | 1.08 | 0.68 | 2.16 | noise |
| 1 | S1 | ?seed=7 | warm | all programs → first draw | 10.18 | 10.32 | +0.15 | +1.5% | 5.22 | 2.81 | 10.44 | noise |
| 1 | S1 | ?seed=7 | warm | first draw → gpu done | 5.63 | 1.94 | -3.69 | -65.6% | 4.47 | 0.41 | 8.94 | noise |
| 1 | S1 | ?seed=7 | diskWarm | nav → gpu done | 60.75 | 51.73 | -9.02 | -14.8% | 66.52 | 9.29 | 133.04 | noise |
| 1 | S1 | ?seed=7 | diskWarm | scene compile+link | 4.61 | 3.54 | -1.07 | -23.2% | 0.76 | 0.11 | 1.52 | noise |
| 1 | S1 | ?seed=7 | diskWarm | all programs → first draw | 12.04 | 11.50 | -0.55 | -4.5% | 2.73 | 2.23 | 5.46 | noise |
| 1 | S1 | ?seed=7 | diskWarm | first draw → gpu done | 5.72 | 1.92 | -3.81 | -66.5% | 66.86 | 0.35 | 133.73 | noise |
| 1 | S1 | ?debug | cold | nav → gpu done | 324.43 | 275.71 | -48.71 | -15.0% | 14.78 | 12.46 | 29.56 | WIN (1.65x) |
| 1 | S1 | ?debug | cold | scene compile+link | 139.10 | 123.32 | -15.79 | -11.3% | 3.83 | 9.04 | 18.08 | noise |
| 1 | S1 | ?debug | cold | all programs → first draw | 11.35 | 11.76 | +0.41 | +3.6% | 2.83 | 6.45 | 12.89 | noise |
| 1 | S1 | ?debug | cold | first draw → gpu done | 38.97 | 33.36 | -5.61 | -14.4% | 7.60 | 11.25 | 22.50 | noise |
| 1 | S1 | ?debug | mesaWarm | nav → gpu done | 322.78 | 271.83 | -50.95 | -15.8% | 11.19 | 8.74 | 22.38 | WIN (2.28x) |
| 1 | S1 | ?debug | mesaWarm | scene compile+link | 139.53 | 121.46 | -18.07 | -12.9% | 7.54 | 2.69 | 15.09 | WIN (1.20x) |
| 1 | S1 | ?debug | mesaWarm | all programs → first draw | 10.83 | 10.54 | -0.28 | -2.6% | 2.27 | 5.97 | 11.94 | noise |
| 1 | S1 | ?debug | mesaWarm | first draw → gpu done | 38.57 | 31.89 | -6.67 | -17.3% | 7.82 | 8.27 | 16.54 | noise |
| 1 | S1 | ?debug | warm | nav → gpu done | 66.79 | 64.81 | -1.98 | -3.0% | 7.41 | 8.35 | 16.69 | noise |
| 1 | S1 | ?debug | warm | scene compile+link | 4.49 | 3.46 | -1.02 | -22.8% | 0.31 | 1.08 | 2.16 | noise |
| 1 | S1 | ?debug | warm | all programs → first draw | 6.55 | 7.10 | +0.55 | +8.4% | 0.71 | 6.16 | 12.31 | noise |
| 1 | S1 | ?debug | warm | first draw → gpu done | 1.56 | 1.75 | +0.18 | +11.5% | 0.86 | 2.81 | 5.61 | noise |
| 1 | S1 | ?debug | diskWarm | nav → gpu done | 158.38 | 84.78 | -73.59 | -46.5% | 10.95 | 10.78 | 21.89 | WIN (3.36x) |
| 1 | S1 | ?debug | diskWarm | scene compile+link | 4.49 | 3.48 | -1.00 | -22.4% | 0.24 | 0.34 | 0.68 | WIN (1.48x) |
| 1 | S1 | ?debug | diskWarm | all programs → first draw | 8.20 | 9.38 | +1.18 | +14.4% | 1.25 | 4.59 | 9.18 | noise |
| 1 | S1 | ?debug | diskWarm | first draw → gpu done | 74.16 | 1.72 | -72.44 | -97.7% | 7.63 | 1.35 | 15.27 | WIN (4.74x) |
| 1 | S2 | ?seed=7 | cold | nav → gpu done | 275.42 | 229.72 | -45.70 | -16.6% | 21.11 | 19.38 | 42.21 | WIN (1.08x) |
| 1 | S2 | ?seed=7 | cold | scene compile+link | 139.95 | 122.11 | -17.84 | -12.8% | 14.41 | 4.03 | 28.83 | noise |
| 1 | S2 | ?seed=7 | cold | all programs → first draw | 14.39 | 14.71 | +0.31 | +2.1% | 5.13 | 2.19 | 10.25 | noise |
| 1 | S2 | ?seed=7 | cold | first draw → gpu done | 33.98 | 30.16 | -3.83 | -11.3% | 4.97 | 11.76 | 23.52 | noise |
| 1 | S2 | ?seed=7 | mesaWarm | nav → gpu done | 274.27 | 225.12 | -49.16 | -17.9% | 12.04 | 6.50 | 24.08 | WIN (2.04x) |
| 1 | S2 | ?seed=7 | mesaWarm | scene compile+link | 139.28 | 121.89 | -17.39 | -12.5% | 1.49 | 3.30 | 6.60 | WIN (2.64x) |
| 1 | S2 | ?seed=7 | mesaWarm | all programs → first draw | 15.46 | 14.77 | -0.69 | -4.5% | 6.03 | 2.05 | 12.05 | noise |
| 1 | S2 | ?seed=7 | mesaWarm | first draw → gpu done | 34.19 | 28.16 | -6.03 | -17.6% | 13.13 | 7.71 | 26.25 | noise |
| 1 | S2 | ?seed=7 | warm | nav → gpu done | 55.78 | 49.16 | -6.63 | -11.9% | 8.18 | 5.45 | 16.35 | noise |
| 1 | S2 | ?seed=7 | warm | scene compile+link | 4.60 | 3.48 | -1.11 | -24.2% | 2.23 | 0.16 | 4.46 | noise |
| 1 | S2 | ?seed=7 | warm | all programs → first draw | 10.46 | 10.04 | -0.41 | -4.0% | 2.96 | 0.71 | 5.91 | noise |
| 1 | S2 | ?seed=7 | warm | first draw → gpu done | 3.02 | 2.90 | -0.13 | -4.1% | 3.31 | 4.18 | 8.36 | noise |
| 1 | S2 | ?seed=7 | diskWarm | nav → gpu done | 60.29 | 56.69 | -3.60 | -6.0% | 3.48 | 12.41 | 24.82 | noise |
| 1 | S2 | ?seed=7 | diskWarm | scene compile+link | 4.59 | 3.62 | -0.98 | -21.3% | 1.11 | 0.33 | 2.23 | noise |
| 1 | S2 | ?seed=7 | diskWarm | all programs → first draw | 12.01 | 12.47 | +0.47 | +3.9% | 0.89 | 2.29 | 4.57 | noise |
| 1 | S2 | ?seed=7 | diskWarm | first draw → gpu done | 7.21 | 6.05 | -1.15 | -16.0% | 3.00 | 4.83 | 9.67 | noise |
| 1 | S2 | ?debug | cold | nav → gpu done | 327.83 | 280.27 | -47.55 | -14.5% | 7.50 | 10.53 | 21.05 | WIN (2.26x) |
| 1 | S2 | ?debug | cold | scene compile+link | 139.29 | 121.16 | -18.13 | -13.0% | 3.17 | 2.88 | 6.33 | WIN (2.86x) |
| 1 | S2 | ?debug | cold | all programs → first draw | 11.16 | 12.50 | +1.33 | +12.0% | 2.42 | 5.11 | 10.21 | noise |
| 1 | S2 | ?debug | cold | first draw → gpu done | 46.74 | 40.40 | -6.34 | -13.6% | 10.93 | 8.53 | 21.85 | noise |
| 1 | S2 | ?debug | mesaWarm | nav → gpu done | 322.70 | 278.21 | -44.48 | -13.8% | 18.25 | 12.28 | 36.50 | WIN (1.22x) |
| 1 | S2 | ?debug | mesaWarm | scene compile+link | 138.31 | 122.19 | -16.11 | -11.7% | 6.65 | 6.45 | 13.30 | WIN (1.21x) |
| 1 | S2 | ?debug | mesaWarm | all programs → first draw | 11.96 | 12.85 | +0.89 | +7.4% | 1.90 | 3.69 | 7.39 | noise |
| 1 | S2 | ?debug | mesaWarm | first draw → gpu done | 44.14 | 39.92 | -4.22 | -9.6% | 12.61 | 6.00 | 25.22 | noise |
| 1 | S2 | ?debug | warm | nav → gpu done | 64.94 | 61.13 | -3.81 | -5.9% | 10.78 | 11.64 | 23.28 | noise |
| 1 | S2 | ?debug | warm | scene compile+link | 4.51 | 3.44 | -1.07 | -23.8% | 0.57 | 0.17 | 1.15 | noise |
| 1 | S2 | ?debug | warm | all programs → first draw | 7.01 | 9.60 | +2.58 | +36.9% | 1.43 | 2.66 | 5.32 | noise |
| 1 | S2 | ?debug | warm | first draw → gpu done | 1.84 | 2.48 | +0.63 | +34.1% | 0.34 | 1.29 | 2.58 | noise |
| 1 | S2 | ?debug | diskWarm | nav → gpu done | 168.35 | 88.82 | -79.53 | -47.2% | 5.25 | 9.14 | 18.29 | WIN (4.35x) |
| 1 | S2 | ?debug | diskWarm | scene compile+link | 4.57 | 3.51 | -1.05 | -23.1% | 0.28 | 1.24 | 2.47 | noise |
| 1 | S2 | ?debug | diskWarm | all programs → first draw | 9.34 | 11.91 | +2.58 | +27.6% | 3.10 | 3.60 | 7.21 | noise |
| 1 | S2 | ?debug | diskWarm | first draw → gpu done | 81.20 | 2.59 | -78.61 | -96.8% | 4.13 | 0.31 | 8.26 | WIN (9.52x) |
| 2 | S1 | ?seed=7 | cold | nav → gpu done | 278.07 | 230.75 | -47.33 | -17.0% | 3.60 | 11.38 | 22.77 | WIN (2.08x) |
| 2 | S1 | ?seed=7 | cold | scene compile+link | 139.75 | 122.96 | -16.80 | -12.0% | 3.28 | 5.27 | 10.54 | WIN (1.59x) |
| 2 | S1 | ?seed=7 | cold | all programs → first draw | 14.27 | 14.49 | +0.22 | +1.5% | 2.46 | 1.88 | 4.91 | noise |
| 2 | S1 | ?seed=7 | cold | first draw → gpu done | 35.05 | 29.63 | -5.42 | -15.4% | 6.71 | 4.84 | 13.43 | noise |
| 2 | S1 | ?seed=7 | mesaWarm | nav → gpu done | 270.13 | 226.48 | -43.65 | -16.2% | 13.95 | 5.81 | 27.90 | WIN (1.56x) |
| 2 | S1 | ?seed=7 | mesaWarm | scene compile+link | 138.88 | 121.70 | -17.18 | -12.4% | 8.89 | 3.59 | 17.78 | noise |
| 2 | S1 | ?seed=7 | mesaWarm | all programs → first draw | 14.73 | 14.57 | -0.15 | -1.1% | 2.92 | 1.70 | 5.84 | noise |
| 2 | S1 | ?seed=7 | mesaWarm | first draw → gpu done | 33.13 | 27.67 | -5.46 | -16.5% | 4.96 | 7.97 | 15.94 | noise |
| 2 | S1 | ?seed=7 | warm | nav → gpu done | 54.81 | 49.67 | -5.14 | -9.4% | 10.94 | 6.22 | 21.87 | noise |
| 2 | S1 | ?seed=7 | warm | scene compile+link | 5.33 | 3.46 | -1.87 | -35.1% | 2.15 | 0.61 | 4.30 | noise |
| 2 | S1 | ?seed=7 | warm | all programs → first draw | 10.10 | 10.32 | +0.23 | +2.2% | 1.64 | 0.82 | 3.28 | noise |
| 2 | S1 | ?seed=7 | warm | first draw → gpu done | 2.50 | 1.94 | -0.56 | -22.6% | 4.61 | 0.11 | 9.21 | noise |
| 2 | S1 | ?seed=7 | diskWarm | nav → gpu done | 59.27 | 53.05 | -6.22 | -10.5% | 70.30 | 6.26 | 140.60 | noise |
| 2 | S1 | ?seed=7 | diskWarm | scene compile+link | 4.62 | 3.54 | -1.08 | -23.4% | 1.32 | 0.17 | 2.65 | noise |
| 2 | S1 | ?seed=7 | diskWarm | all programs → first draw | 12.07 | 11.81 | -0.27 | -2.2% | 1.15 | 2.25 | 4.50 | noise |
| 2 | S1 | ?seed=7 | diskWarm | first draw → gpu done | 5.76 | 1.92 | -3.85 | -66.8% | 66.83 | 1.00 | 133.67 | noise |
| 2 | S1 | ?debug | cold | nav → gpu done | 323.85 | 270.89 | -52.96 | -16.4% | 8.14 | 8.05 | 16.28 | WIN (3.25x) |
| 2 | S1 | ?debug | cold | scene compile+link | 140.34 | 121.75 | -18.59 | -13.3% | 11.70 | 2.75 | 23.40 | noise |
| 2 | S1 | ?debug | cold | all programs → first draw | 10.72 | 11.68 | +0.95 | +8.9% | 3.19 | 4.16 | 8.31 | noise |
| 2 | S1 | ?debug | cold | first draw → gpu done | 38.85 | 32.70 | -6.16 | -15.8% | 4.11 | 4.70 | 9.39 | noise |
| 2 | S1 | ?debug | mesaWarm | nav → gpu done | 318.56 | 276.85 | -41.72 | -13.1% | 7.15 | 10.93 | 21.85 | WIN (1.91x) |
| 2 | S1 | ?debug | mesaWarm | scene compile+link | 138.13 | 121.47 | -16.66 | -12.1% | 4.13 | 6.34 | 12.68 | WIN (1.31x) |
| 2 | S1 | ?debug | mesaWarm | all programs → first draw | 10.43 | 12.30 | +1.87 | +17.9% | 0.98 | 4.74 | 9.47 | noise |
| 2 | S1 | ?debug | mesaWarm | first draw → gpu done | 39.67 | 33.75 | -5.92 | -14.9% | 3.42 | 9.80 | 19.60 | noise |
| 2 | S1 | ?debug | warm | nav → gpu done | 67.25 | 64.22 | -3.02 | -4.5% | 8.54 | 7.96 | 17.09 | noise |
| 2 | S1 | ?debug | warm | scene compile+link | 4.44 | 3.37 | -1.07 | -24.2% | 2.52 | 0.23 | 5.05 | noise |
| 2 | S1 | ?debug | warm | all programs → first draw | 6.59 | 7.74 | +1.14 | +17.3% | 0.88 | 3.64 | 7.28 | noise |
| 2 | S1 | ?debug | warm | first draw → gpu done | 1.60 | 1.81 | +0.21 | +13.1% | 0.17 | 1.03 | 2.06 | noise |
| 2 | S1 | ?debug | diskWarm | nav → gpu done | 158.71 | 86.34 | -72.36 | -45.6% | 8.35 | 5.51 | 16.69 | WIN (4.34x) |
| 2 | S1 | ?debug | diskWarm | scene compile+link | 4.57 | 3.50 | -1.07 | -23.4% | 2.60 | 1.64 | 5.20 | noise |
| 2 | S1 | ?debug | diskWarm | all programs → first draw | 8.33 | 10.37 | +2.04 | +24.4% | 1.39 | 3.26 | 6.52 | noise |
| 2 | S1 | ?debug | diskWarm | first draw → gpu done | 73.47 | 2.55 | -70.92 | -96.5% | 3.94 | 1.39 | 7.87 | WIN (9.01x) |
| 2 | S2 | ?seed=7 | cold | nav → gpu done | 277.42 | 230.66 | -46.77 | -16.9% | 15.10 | 13.65 | 30.20 | WIN (1.55x) |
| 2 | S2 | ?seed=7 | cold | scene compile+link | 139.49 | 121.49 | -18.00 | -12.9% | 8.55 | 10.22 | 20.45 | noise |
| 2 | S2 | ?seed=7 | cold | all programs → first draw | 15.14 | 14.53 | -0.62 | -4.1% | 4.50 | 5.43 | 10.87 | noise |
| 2 | S2 | ?seed=7 | cold | first draw → gpu done | 34.40 | 31.09 | -3.31 | -9.6% | 9.22 | 11.57 | 23.15 | noise |
| 2 | S2 | ?seed=7 | mesaWarm | nav → gpu done | 272.77 | 228.08 | -44.69 | -16.4% | 9.55 | 10.86 | 21.72 | WIN (2.06x) |
| 2 | S2 | ?seed=7 | mesaWarm | scene compile+link | 140.44 | 122.03 | -18.41 | -13.1% | 3.36 | 5.62 | 11.23 | WIN (1.64x) |
| 2 | S2 | ?seed=7 | mesaWarm | all programs → first draw | 14.70 | 14.38 | -0.32 | -2.1% | 2.28 | 3.05 | 6.10 | noise |
| 2 | S2 | ?seed=7 | mesaWarm | first draw → gpu done | 33.89 | 29.20 | -4.70 | -13.8% | 4.23 | 6.22 | 12.44 | noise |
| 2 | S2 | ?seed=7 | warm | nav → gpu done | 55.04 | 49.91 | -5.13 | -9.3% | 3.02 | 7.33 | 14.67 | noise |
| 2 | S2 | ?seed=7 | warm | scene compile+link | 4.51 | 3.47 | -1.04 | -23.1% | 2.22 | 0.14 | 4.44 | noise |
| 2 | S2 | ?seed=7 | warm | all programs → first draw | 10.22 | 10.54 | +0.32 | +3.1% | 2.89 | 1.45 | 5.78 | noise |
| 2 | S2 | ?seed=7 | warm | first draw → gpu done | 5.51 | 2.23 | -3.28 | -59.5% | 2.83 | 4.33 | 8.65 | noise |
| 2 | S2 | ?seed=7 | diskWarm | nav → gpu done | 61.24 | 54.55 | -6.70 | -10.9% | 71.35 | 7.54 | 142.70 | noise |
| 2 | S2 | ?seed=7 | diskWarm | scene compile+link | 4.63 | 3.56 | -1.07 | -23.2% | 0.46 | 0.28 | 0.91 | WIN (1.18x) |
| 2 | S2 | ?seed=7 | diskWarm | all programs → first draw | 11.90 | 11.70 | -0.20 | -1.7% | 1.18 | 1.86 | 3.73 | noise |
| 2 | S2 | ?seed=7 | diskWarm | first draw → gpu done | 7.22 | 2.80 | -4.42 | -61.2% | 71.46 | 4.49 | 142.92 | noise |
| 2 | S2 | ?debug | cold | nav → gpu done | 325.50 | 285.51 | -39.99 | -12.3% | 11.57 | 7.95 | 23.15 | WIN (1.73x) |
| 2 | S2 | ?debug | cold | scene compile+link | 139.39 | 121.94 | -17.45 | -12.5% | 2.36 | 1.27 | 4.72 | WIN (3.70x) |
| 2 | S2 | ?debug | cold | all programs → first draw | 12.48 | 12.49 | +0.01 | +0.0% | 3.24 | 5.64 | 11.29 | noise |
| 2 | S2 | ?debug | cold | first draw → gpu done | 40.09 | 41.34 | +1.25 | +3.1% | 12.63 | 11.04 | 25.26 | noise |
| 2 | S2 | ?debug | mesaWarm | nav → gpu done | 324.60 | 281.95 | -42.65 | -13.1% | 20.16 | 8.07 | 40.33 | WIN (1.06x) |
| 2 | S2 | ?debug | mesaWarm | scene compile+link | 138.87 | 122.58 | -16.29 | -11.7% | 4.37 | 5.18 | 10.36 | WIN (1.57x) |
| 2 | S2 | ?debug | mesaWarm | all programs → first draw | 11.96 | 12.54 | +0.58 | +4.9% | 1.80 | 2.81 | 5.61 | noise |
| 2 | S2 | ?debug | mesaWarm | first draw → gpu done | 39.24 | 39.84 | +0.60 | +1.5% | 8.96 | 6.62 | 17.91 | noise |
| 2 | S2 | ?debug | warm | nav → gpu done | 64.86 | 64.78 | -0.08 | -0.1% | 5.01 | 11.74 | 23.48 | noise |
| 2 | S2 | ?debug | warm | scene compile+link | 4.50 | 3.48 | -1.03 | -22.9% | 0.14 | 0.12 | 0.29 | WIN (3.55x) |
| 2 | S2 | ?debug | warm | all programs → first draw | 7.29 | 8.32 | +1.03 | +14.2% | 0.86 | 4.68 | 9.37 | noise |
| 2 | S2 | ?debug | warm | first draw → gpu done | 1.91 | 1.94 | +0.03 | +1.6% | 0.69 | 1.73 | 3.46 | noise |
| 2 | S2 | ?debug | diskWarm | nav → gpu done | 171.04 | 89.09 | -81.95 | -47.9% | 8.53 | 12.95 | 25.90 | WIN (3.16x) |
| 2 | S2 | ?debug | diskWarm | scene compile+link | 4.54 | 3.52 | -1.02 | -22.6% | 0.28 | 0.14 | 0.55 | WIN (1.86x) |
| 2 | S2 | ?debug | diskWarm | all programs → first draw | 9.11 | 12.03 | +2.92 | +32.0% | 3.24 | 5.88 | 11.76 | noise |
| 2 | S2 | ?debug | diskWarm | first draw → gpu done | 82.11 | 2.65 | -79.46 | -96.8% | 6.18 | 6.24 | 12.48 | WIN (6.37x) |

</details>

### Bundle bytes

- **Method.** `npm run build` ran twice per side. Each side gave the same sha256 both times: base `dfbf7aac…a922a`, head `46b9478c…f328fe` (`.claude/perf-lab/evidence/final/bundle/sha256-base-1.txt`, `-2.txt`, `sha256-head-1.txt`, `-2.txt`).
- **Tools.** Sizes are from the gzip 1.14 and brotli 1.2.0 CLIs (`.claude/perf-lab/evidence/final/bundle/base.txt`, `head.txt`).

| file | base raw / gzip -9 / brotli -q 11 | head raw / gzip -9 / brotli -q 11 | Δ raw | Δ gzip | Δ brotli |
|---|---|---|---|---|---|
| dist/index.js | 143,292 / 46,839 / 40,644 | 135,180 / 43,248 / 37,584 | -8,112 (-5.7%) | -3,591 (-7.7%) | -3,060 (-7.5%) |
| dist/index.d.ts | 6,934 / 2,759 / 2,343 | 6,934 / 2,759 / 2,343 | 0 | 0 | 0 |

**The shader literals.**

- **Sources.** `.claude/perf-lab/evidence/final/bundle/base-glsl-share.txt` and `head-glsl-share.txt`.
- **Shader bytes.** The literals fell from 47,774 B to 30,710 B (-17,064 B). As a share of the raw file, that is 33.3% on base (19 of 19 shader files found) and 22.7% on head (22 of 22 found).
- **The rest of the file.** It grew from 95,556 B to 104,514 B (+8,958 B), measured with every literal replaced by `""`.
- **Compressed share (estimate).** The literals' share of the compressed file went from 33.5% to 21.6% (gzip -9 CLI) and from 33.8% to 21.9% (brotli). Both are estimates, computed by recompressing the file with the literals emptied.
- **Ignore one line in head.txt.** It reports "shader literals 0 B". That scan searches for the GLSL sources verbatim, and the head ships them stripped. Use `head-glsl-share.txt`, which matches the shipped literals.

### Pixel gate and checks

- **Pixel gate.** SAME in all 147 cells of e84cf1d (the tree of 637f55d) against origin/main, with every group at rc=0, 0 DIFF, 0 ERROR and 0 page errors. The last two lines of `.claude/perf-lab/evidence/final/gate.txt` are "PIXEL-GATE: SAME (147 cells, all groups)" and "rc=0". The per-group JSON and stderr are in `.claude/perf-lab/evidence/final/gate/`.

  | group | default | full | hidpi | big | raw | noglow | dim | calm | seed7 |
  |---|---|---|---|---|---|---|---|---|---|
  | SAME cells | 3 | 108 | 12 | 3 | 3 | 3 | 6 | 3 | 6 |

- **Default check.** `npm run typecheck && npm test`: tsc --noEmit passes, then "Test Files 14 passed (14)" and "Tests 203 passed (203)" (`.claude/perf-lab/evidence/final/checks/checks.txt`).
- **Browser suite.** `npm run test:browser`: "72 passed (24.0s)" on "ANGLE (AMD, AMD Radeon RX 9060 XT (radeonsi gfx1200 ACO), OpenGL ES 3.2 Mesa 26.2.2-arch1.1)" (`.claude/perf-lab/evidence/final/checks/browser.txt`).
- **Working tree.** `git status --porcelain` printed nothing after the runs (`.claude/perf-lab/evidence/final/checks/status-porcelain.txt`, 0 bytes).

### Not shown

- **Per-commit split.** The final measure compares only origin/main and the tip. The per-commit rows ran on different parents, on different days and, for rows 1-11, in a different clock regime, so they do not add up to the combined Δ.
- **Step CPU.** It is NULL: no cell beats its threshold, so this report claims no CPU-time gain.
- **What the GPU timers miss.** Neither the frozen frame nor the batch covers the real requestAnimationFrame loop, present, or compositor cost.
- **The fly +0.04 µs.** No cause was found, and the fly shaders did not change.
- **Start-up compile rises.** No cause was found for ripple compile+link rising by 0.27 to 1.20 ms, or for Σ compile rising by 1.54 to 3.42 ms.
- **The diskWarm stall.** The mechanism that removed the ?debug diskWarm first-draw stall was not found.
- **GPU clock per side.** The batch clock traces mix base and head pages, so the clock is not known for each side separately. The CPU governor and frequency were not recorded.
- **Glow with emission.** Glow and emission are compared only as sums of medians.
- **Other hardware.** No other GPU or driver was measured. Neither was the glow path without float32 targets, where glow works out emission per tap.
- **Compressed GLSL share.** It is an estimate.
- **Run independence.** Run 2 of each block is a second process in the same boot, not an independent boot.
- **Round-1 raw data.** The raw perf JSON for rows 1-11 is lost, and those rows rest on rebuilt write-ups.

## Architecture/design updates

The branch is `perf/explore-2026-10-28`: 35 commits on origin/main 23cd98e up to 637f55d, 28 files, +2776 −215 (`git diff --stat origin/main 637f55d`), then ae57938 (three lines of `docs/scene-features.md`), the report commit, and a review fix to `startup.mjs --bundle` (Cost map).

- Its source tree equals the round-3 tip 431e4c3 at 0378378: `git diff --stat 431e4c3 0378378` is empty.
- HEAD 637f55d adds the three tools, their npm scripts and the CLAUDE.md lines on top: 5 commits with no `src/` change. The final measure ran on e84cf1d, which has the same tree as 637f55d.
- The round-3 maps were taken on 872e201. The branch has 11 source commits after it (`git rev-list --count 7835893..0378378` = 11; 872e201 is the perf-int/r1 stack sha and is not an ancestor of HEAD, but PR commit 7835893 has the same tree, `6ef4e84`); none of these maps was re-run on the final tip (see Gaps).
- The shader layout was built on, not redone. `git diff --stat origin/main 637f55d -- src/shaders` edits 4 scene chunks (`compose.glsl`, `fish.glsl`, `main.frag`, `trails.glsl`), adds none, and adds `emission.frag`, `emission.glsl` and `pixel.vert` outside `scene/`. `test/shader-size.test.ts` is unchanged: every shader file stays within 250 lines, and every scene chunk but `uniforms.glsl` opens with `// Uniforms` and `// Depends on:` headers.

The structural changes, as the code now stands:

1. a float32 emission pre-pass with a zero-bordered target;
2. halo gating: the glow target is cleared once, and ascii skips the halo sample;
3. the scene drawn as two layers of one program;
4. CPU-built trail chunk boxes with a 0.85 age cut;
5. rolled shadow and trail loops for start-up;
6. one `pixel.vert` shared by ripple and ascii;
7. float and unsigned ascii arithmetic, with CPU ramp deltas;
8. a lighting memo;
9. table-driven koi kinematics with a bit-exact `hypot`;
10. a GLSL strip plugin in the build;
11. three new measurement tools.

The table below gives each change's files and commits, and what a maintainer must keep true.

<details><summary>Structural changes: where, commits, and what must stay true (11 rows)</summary>

| change | where | commits | what a maintainer must keep true |
|---|---|---|---|
| **Emission pre-pass.** Each cell's emission is written once into an RGBA32F target of `(cols + 2·GLOW_RX) × (rows + 2·GLOW_RY)`, with GLOW_RX = 4 and GLOW_RY = 2. The target has a zero border, and glow reads it with `texelFetch` and no clamp. | `src/renderer.ts` lines 37-38 and 147-159, `src/shaders/emission.frag`, `src/shaders/emission.glsl`, `src/shaders/glow.frag` | 3cbb8ec, 164191e, 138a369 | Nothing may draw to or clear the border; the emission viewport is offset by (GLOW_RX, GLOW_RY). Without `EXT_color_buffer_float`, glow.frag gets `emission.glsl` prepended and computes emission per tap with clamped fetches. |
| **Halo gating.** The glow target is cleared once when the halo turns off (`haloInTarget`). ascii gets `uGlowOn` and skips the halo sample, which uses `textureLod` at level 0. | `src/renderer.ts` lines 112 and 424-458, `src/shaders/ascii.frag` | c256ed1, 3682557, 3390812 | A light palette or `?glow=off` draws no emission and no glow, and does not sample the halo. |
| **The scene runs as two layers of one program.** Layer 0 (`uLayer 0`, `uFishDraw 0`) draws the water, the sky objects, the shadow loop and the trails. Layer 1 draws the fish and `discard`s every cell it does not claim (`c.mat < 0`). | `src/shaders/scene/main.frag` lines 6-17, 31-60; `src/renderer.ts` (two draws, the second only when the fish count is above 0) | 2a26f5b | Code after `drawFish()` runs in both layers. In layer 1 it starts from an unclaimed `Cell`. |
| **Trail chunk culling on the CPU.** koi.ts builds one box per 8-segment chunk (`T_CBOX`, `TRAIL_CHUNK = 8`, `TRAIL_CHUNKS = 5`, `FISH_TEXELS = T_CBOX + 5`) and cuts trails at age 0.85 (`TRAIL_CUT`). The shader skips a fish whose `T_TBOX` misses and any chunk whose box misses. Its inner loop is unrolled by 4, with `#error` guards. | `src/koi/koi.ts` line 81, `src/koi/layout.ts`, `src/pond.ts`, `src/shaders/scene/trails.glsl` lines 31-72 | 2e9040f, 3440a41, c3160b7 | The box growth `w0·(0.5 + 1.4·age) + 1` and the 0.85 cut are tied by a proof comment to the trails.glsl constants. `test/trail.test.ts` checks the boxes, their union and the cut over 600 frames. |
| **Rolled loops for start-up.** The shadow loop runs to `uFishCount` and the trail chunk loop to `n`; neither is unrolled to MAX_FISH. | `scene/main.frag` line 41, `scene/trails.glsl` line 57 | e22d7b4 | A shader edit that re-unrolls these loops brings back link time. Check it with `npm run startup`. |
| **One pixel vertex shader.** ripple and ascii read the pixel position from a `vPx` varying in `pixel.vert`, not from `gl_FragCoord`; scene, emission and glow keep `fullscreen.vert`. Against origin/main, `src/shaders/pixel.vert` is one new file; on the branch, 599ed76 added it as `ascii.vert` and 0378378 renamed it. | `src/shaders/pixel.vert`, `ascii.frag`, `ripple.frag`, `src/renderer.ts` | 599ed76, 0378378 | Both passes take a `uDev` uniform. |
| **ascii arithmetic.** The cell index comes from a float divide `floor((q + 0.5) / cellPx)`, the cell offset and atlas x from exact float products, and the border test from unsigned compares. The look tail sits in one uniform branch. Ramp stops are picked by uniform stop-count branches, with per-segment steps uploaded as `uStopDeltas`. | `ascii.frag`, `src/look.ts` (`rampUniforms(p, stops, deltas)`) | 41477d0, c78f160, f067572, dad7b85, 8e4b418, c9386da | The deltas are float32 differences computed on the CPU. `test/palette.test.ts` covers `rampUniforms`. |
| **Lighting memo.** The renderer recomputes light, scene light, stars, flies and look only when the phase value, the resolved palette object or the sky object changes. | `src/renderer.ts` lines 103-105 and 296-306 | 3e62b1d, 6fb0e99 | `mount.ts` replaces the palette and sky objects on `setPalette` and `setSky`. A value that depends on anything else, or a palette or sky that is mutated in place, would go stale. |
| **CPU sim.** `JOINT_PROFILE`, `PEDUNCLE_PROFILE` and `TAIL_SPREAD` are now tables. `bendTrig` skips `atan2`. A local `hypot` matches `Math.hypot` to the bit for two arguments and returns `ax + ay` on NaN. `sampleBody` writes into a reused `Float64Array(5)`. Per-frame array literals and spreads are gone. | `src/koi/koi.ts` lines 46-63, `src/pond.ts`, `src/lighting.ts`, `src/renderer.ts` | 083cb00, 9045b8f, f372e94, f693868, d05daa2 | No unit test covers the `hypot` replica; it is module-private. Its exactness evidence is only in `.claude/perf-lab/evidence/r2/r2-koi-hypot-replica/` (`chromium-bruteforce.json`, `lockstep-3000.txt`). |
| **GLSL strip in the build.** `stripGlslComments()` removes `//` comments and per-line leading and trailing blanks from `.glsl`, `.frag` and `.vert` `?raw` imports. It keeps every line break, so `file:line` compile errors still map. It throws on `/*`, on `//…\` and on `\` continuations. | `vite.lib.config.ts` (exported), `vite.demo.config.ts` | 2728924, 7835893 | A shader that needs a block comment or a line continuation fails the build on purpose. |
| **Three new measurement tools**, each with an npm script. | `scripts/batch.mjs` (189 lines), `scripts/cpu.mjs` (971), `scripts/startup.mjs` (846), `package.json` (`batch`, `cpu`, `startup`) | 5046709, 9a08e97, 28f2f6c, 6d4e026 | batch times whole frames; cpu advances time (sim, uploads, ripple; `--gpu`, `--alloc`, `--profile`); startup times compile, link, atlas, font and first frame (cold, warm, mesaWarm, diskWarm; `--bundle`). |

</details>

**Docs the branch changed** (`git diff origin/main ae57938 -- docs README.md CLAUDE.md`, 3 files, +9 −6):

- **CLAUDE.md** (+3, 637f55d) adds the "Measure the whole frame", "Measure CPU cost" and "Measure start-up" lines under Browser checks.
- **README.md** (1 line): the `profile` row now lists `emission` among the passes.
- **docs/scene-features.md** (5 lines):
  - line 26 adds the layer-1 rule, that what draws after `drawFish()` "writes every `Cell` field and never reads the one under it";
  - line 35 now names `src/shaders/emission.glsl` as the home of a material's `emission()` weight, in place of `glow.frag`;
  - ae57938 updates lines 16, 34 and 49 for the three gaps below.

**Does docs/scene-features.md still hold?** Yes, after ae57938. Up to 637f55d it had three small gaps:

- Line 34 said the `M_*` material ID is read by "the glow and ASCII passes". The emission pass reads it now (or glow, through the prepended `emission.glsl`, on the fallback path). The recipe is unaffected.
- Lines 16-17 say to derive a new value from the phase in `lightingAt()`. That is still correct, but the doc did not say that the renderer now memoises the lighting on (phase, palette, sky). A derived value that depends on time, viewport or seed would silently go stale.
- Line 49 gave only `npm run perf` for checking cost. CLAUDE.md now also names `npm run batch` for draws, targets and clears, and `npm run startup` for shader growth and loop changes. Both apply to a new scene feature.

**Does docs/colour-slots.md still hold?** Yes.

- Line 45, "A light background has no glow pass (`palette.light` in `renderer.ts`)", is still true. A light background now also skips the emission pass and the ascii halo sample, and the glow target is cleared only on the transition (`src/renderer.ts` lines 424-434).
- The doc does not mention the CPU-side ramp deltas (`uStopDeltas`). It does not need to: they are derived from the existing ramp stops and add no colour slot.

## Proposals not landed

None of these is on the branch. Each would add public API, so it needs a maintainer decision, a semver-minor bump and a `CHANGELOG.md` entry. All five prototype worktrees still exist and are uncommitted; `git -C <worktree> diff HEAD --shortstat` was checked on 2026-10-28.

### maxPixelRatio (r1 p1, re-prototyped as r3-p1 on 872e201)

This is an optional `maxPixelRatio?: number` mount option. It clamps the device ratio in `deviceRatio()` (`src/mount.ts` lines 190-195).

**Benefit.** The cap helps at S2 and does nothing at S1 (dpr 1). At S2 with cap 1.5 on 872e201:

- the DUSK frozen frame drops from 131.72 to 84.92 µs (−35.5 %, a win against a threshold of 5.84); MID drops the same, 132.28 → 84.80 (−35.9 %), but one wide run puts its threshold at 121.84, so MID is noise by the rule;
- a presented frame drops from 169 to 103 µs;
- at 60 Hz a frame drops from about 650 to about 236 µs, and board power falls by 2.6-2.7 W.

Leaving the option unset is pixel-identical.

<details><summary>maxPixelRatio, round 1 against round 3 (all rows)</summary>

| measure, S2 | r1 p1 on origin/main 23cd98e | r3-p1 on 872e201 |
|---|---|---|
| frozen frame, cap 1.5 | 243.48 → 155.12 µs (−88.36, −36.3 %); ascii −88.68 (−42.4 %) | MID 132.28 → 84.80 (−47.48, −35.9 %, noise: threshold 121.84); DUSK 131.72 → 84.92 (−46.80, −35.5 %, win, threshold 5.84) |
| frozen frame, other caps | cap 1.25: −125.48 (−51.4 %); cap 1: −131 to −142 (−54 to −58 %) | cap 1: −48.9, with scene, emission and glow +8.2, +1.2 and +2.1 (clock-down) |
| whole batch, advancing | not measured | DUSK cap 1.5: 136.89 → 92.31 (−44.58, −32.6 %, win); MID cap 1.25: −21.30 (non-monotonic) |
| presented, vsync off | not measured | 169 → 103 µs per frame (−66, −39 %); fps 5430 → 8136; deferred clear 37.54 → 22.10 µs |
| 60 Hz paced, two processes | not measured | 648.28 / 650.96 → 235.84 / 235.48 µs per frame; board power above a 10.4 W idle +8.74 / +8.64 → +6.14 / +5.93 W (−2.6 / −2.7 W, −30 %) |
| S1 | noise at every cap | noise at every cap |
| other | cpu.mjs advancing frames at cap 1.5: −87.6 µs; 1280x800@2 at cap 1.5: −13 to −16 µs | — |
| pixels when unset | gate 147 SAME | gate 147/147 SAME |
| bundle (index.js) | +146 raw, +36 gzip, −10 brotli; d.ts +197 | +146 raw, +35 gzip, −1 brotli (base 131,320 / 41,933 / 36,452); d.ts +197 |
| tests | 197 pass | 201 pass |
| verdict | — | WIN-A by rule (a) for ascii (frozen) and for the whole batch. No second independent run by another agent; the 60 Hz result did reproduce in two processes. |

The r1 column ran before the reboot after round 1 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26) and the r3 column after it. The S2 rows are comparable, because the S1 clock-regime change did not move S2; the r1 1280x800@2 figure is in the faster pre-reboot regime (Clock regimes).

</details>

Evidence:

- **r1:** `.claude/perf-lab/evidence/r1/proposals/p1-max-pixel-ratio/proposal.md` only. Round 1's raw files were lost in the reboot after round 1.
- **r3:** `.claude/perf-lab/evidence/r3/proposals/r3-p1-max-pixel-ratio/proposal.md`, with the raw files beside it:
  - `perf-s2.*`, `batch-s2.*`, `present-s2.*`;
  - `paced-s2.*`, `paced2-s2.*`;
  - `verdict-perf.txt`, `verdict-batch.txt`, `bundle.txt`, `gate.txt`.

Why r3's saving is half of r1's: the round-1 and round-2 work halved the ascii pass at S2, from 209 to 115 µs, so the same relative cut saves fewer µs. The relative saving is unchanged at −36 %.

**Prototypes.**

- `.claude/worktrees/perf-proto-r1-p1-max-pixel-ratio`: detached at 23cd98e.
- `.claude/worktrees/perf-proto-r3-r3-p1-max-pixel-ratio`: detached at 872e201.
- Both hold the same diff: 3 files, +15 −2 (`demo/main.ts`, `src/index.ts`, `src/mount.ts`). It is also saved as `.claude/perf-lab/evidence/r3/proposals/r3-p1-max-pixel-ratio/prototype.diff`.

**Migration cost** (r3-p1 proposal §4):

- **For users:** none. The field is optional, and leaving it unset keeps today's output byte for byte. Changing the cap means a remount.
- **Code changes:**
  - `src/index.ts`: about 5 lines;
  - `src/mount.ts`: about 5 lines (validate and warn as `intensity` does, then clamp); no renderer or shader change;
  - README: an options row and a "Good to know" note;
  - tests: a browser test at deviceScaleFactor 2 and a unit test. The browser test brings `npm run test:browser` into the check.
- **Release:** a minor bump and a CHANGELOG entry.
- **Cost of the cap itself:** set below the device ratio, it changes the picture by design: glyphs are softer and the grid changes (192×54 cells instead of 196×54 at S2).

### Glow quality (r1 p2) and glow switch (r3-p2)

- **r1 p2:** `glow: 'full' | 'low' | 'off'` with `setGlow`, prototyped as `?glowq=off|low`.
- **r3-p2:** a mount-time `glow?: boolean`. The renderer's constructor flag changes from `software` to `halo`, so with `glow: false` the emission, glow and GLOW-ascii programs are never built.

**Benefit.** With the halo off on 872e201, the whole batch at MID drops by 9.58 µs at S1 (−19.0 %) and 14.75 µs at S2. Start-up to "gpu done" does not change.

<details><summary>Glow options, round 1 against round 3 (all rows)</summary>

| measure | r1 p2 on 23cd98e | r3-p2 on 872e201 |
|---|---|---|
| frozen frame, off, S1 | −19.44 to −21.16 µs (−29 to −31 %) | −10.32 (46.76 → 36.44, −22.1 %, win) |
| frozen frame, off, S2 | −28.52 to −29.60 (−12 %) | −16.68 (134.64 → 117.96, −12.4 %, win) |
| whole batch, MID, off | not measured | S1 50.34 → 40.76 (−9.58, −19.0 %), replicate −9.35; S2 136.61 → 121.86 (−14.75), replicate −15.89; mono S2 −23.48 / −22.51 |
| `low` (5×3 taps) | S1 −10.88 to −11.60; S2 −6.88 to −7.64; changes pixels (peak 4.8-20.9 % brighter) | not prototyped |
| start-up | mount → first draw −30 to −38 ms; nav → gpu done null | programs (wall), cold, −10.56 / −14.46 ms (S1 / S2); nav → gpu done null; CPU null |
| bundle | — | +144 raw, +42 gzip, +15 brotli |
| pixels | — | gate 147 SAME; `glow: false` against the debug `?glow=off`: 48/48 and 6/6 SAME |

The r1 column ran on origin/main in the faster pre-reboot S1 regime and the r3 column on 872e201 after it; compare percentages, not µs, across the two columns.

</details>

Evidence:

- **r1:** `.claude/perf-lab/evidence/r1/proposals/p2-glow-quality/proposal.md`. Only the proposal and its `shots/` scripts survive.
- **r3:** `.claude/perf-lab/evidence/r3/proposals/r3-p2-glow-switch/proposal.md`, with the raw files beside it:
  - `batch-s1/s2.*`, `batch-rep-s1/s2.*`, `batch2-s1/s2.*`, `perf-s1/s2.*`, `startup-s1/s2.*`;
  - `verdict-*.txt`, all WIN-A.

**The margin over what already ships is thin.** The internal debug switch `?glow=off` already gives most of the saving. The option beats it by about 1.2-1.6 µs (the glow-target clear) on pond-like palettes, and by 2.3 µs (S1) and 4.9-6.1 µs (S2) on ramp palettes. r3-glow-clear-once has since landed as 3390812 and removes that clear, so on pond-like palettes the margin is now about 0. That figure is the proposal's prediction (proposal line 55) and was not re-measured on the final tip.

The proposal also names an alternative it did not prototype: a runtime `setGlow(on)` on the existing `uGlowOn` path. It needs no program changes, keeps about 85-90 % of the per-frame saving (MID S2 batch: debug switch 122.3 against the option's 121.1-121.9 µs), and allows live toggling.

**Prototypes.**

- `.claude/worktrees/perf-proto-r1-p2-glow-quality`: at 23cd98e, `src/renderer.ts` only, +8 −2.
- `.claude/worktrees/perf-proto-r3-r3-p2-glow-switch`: at 872e201, 4 files, +22 −7.

**Migration cost** (r3-p2 proposal, "Migration cost"):

- **For users:** none unless they opt in (`createKoiPond(el, { glow: false })`). There is no setter, so toggling means a remount, which restarts the fish.
- **Code changes:**
  - `src/index.ts`: +7;
  - `src/mount.ts`: +4 to 5;
  - `src/renderer.ts`: about +6 −4;
  - a demo parameter, so `shots` and the pixel gate can reach the option;
  - README: an options row and the "Light backgrounds" sentence;
  - `docs/colour-slots.md` line 45;
  - one browser spec of about 20 lines.
- **Release:** a minor bump and a CHANGELOG entry.
- **r1 p2's three-level form** was estimated at about 60-90 lines across about 8 files, and its `low` level changes pixels.

### maxFps (r1 p3)

This is an optional `maxFps?: number`. The proposal recommends a floor of 20. `frame()` in `src/mount.ts` skips rAF ticks closer than `1000 / maxFps` ms.

**Benefit.** Measured on origin/main 23cd98e in round 1:

- **On an emulated 120 Hz display, capped to 60 fps:**
  - pond GPU: −3.15 ms/s at S1 and −9.10 ms/s at S2;
  - Chromium CPU: −41.9 and −39.9 ms/s;
  - board power: −1.38 W and −6.63 W.
- **On a native 60 Hz display, capped to 30:** −3.33 W at S1 and −4.51 W at S2.
- Pixels are unchanged by default.
- **Judder:** on a 144 Hz display, a 60 cap alternates 2 and 3 ticks (13.9 / 20.8 ms); a 72 cap is even.

Most of the CPU saving is in Chromium's present path, which neither perf nor cpu.mjs sees. The evidence is `.claude/perf-lab/evidence/r1/proposals/p3-max-fps/proposal.md`; only the proposal, `run.sh` and `summarize.mjs` survive, because the raw `summary.txt` and `v*.json` files were lost in the reboot.

**Prototype.** `.claude/worktrees/perf-proto-r1-p3-max-fps`, at 23cd98e: 3 files, +20, plus two untracked lab tools, `scripts/fpscap.mjs` and `scripts/rafprobe.mjs`.

**Migration cost:**

- `src/index.ts`: +7;
- `src/mount.ts`: about 15 lines;
- README: a note on refresh divisors, battery and the floor;
- a browser spec with a fake rAF clock;
- a minor bump and a CHANGELOG entry.

Two open design choices remain: whether to snap the cap to a refresh divisor, which removes judder but makes the rate depend on the display, and whether to keep the floor at 20.

### Bundle: JSDoc and minification (findings, not candidates)

The round-3 summary classes these as maintainer policy, not perf candidates (`.claude/perf-lab/evidence/r3/summary.md` line 89). Round 1 had already deferred the JSDoc drop and the debug-hook split on the same grounds. The lib build is `minify: false`, es2022.

**dist/index.js as built:**

| tip | raw | gzip -9 (CLI / node zlib) | brotli -q11 | evidence |
|---|---:|---:|---:|---|
| origin/main 23cd98e | 143,292 B (costmap); 139.9 KiB (r3 run) | 46,839 B (r2); 46.0 KiB (r3 run) | 39.7 KiB | `.claude/perf-lab/evidence/costmap.md` headline 12; `.claude/perf-lab/evidence/r2/map/c.md` §4; `.claude/perf-lab/evidence/r3/map/c.md` §3 |
| d0a6f41 (round-2 base) | 130,960 | 41,535 / 41,753 | 35,999 | `.claude/perf-lab/evidence/r2/map/c.md` §4 |
| 872e201 (round-3 base) | 131,320 | 41,933 / 42,265 | 36,452 | `.claude/perf-lab/evidence/r3/map/c/bundle/bundle-size.txt`, `.../variants.txt` |

`dist/index.d.ts` is 6,934 B raw and 2,759 B gzip at both tips.

**JSDoc in the shipped JS:**

- **At d0a6f41:** 16,402 B raw (12.5 %), a gzip saving of 7,249 B.
- **At 872e201:** 16,778 B raw (12.8 %), a gzip saving of 7,408 B. That is about 18 % of the wire size. lighting.ts (3.7 KB), koi.ts (2.6 KB) and renderer.ts (2.5 KB) carry the most.
- **Runtime effect:** none. Consumers get their types and docs from `index.d.ts`, which tsc emits from the sources.

The what-if variants below change nothing in the repo. All gzip figures in this table are node zlib -9.

<details><summary>Bundle what-if variants, round 2 (d0a6f41) and round 3 (872e201)</summary>

| variant | r2 raw | r2 gzip | r2 Δ gzip | r2 Δ brotli | r3 raw | r3 gzip | r3 Δ gzip | r3 Δ brotli |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| as built | 130,960 | 41,753 | 0 | 0 | 131,320 | 42,265 | 0 | 0 |
| − JS comments (JSDoc and `/* */`) | 114,036 | 34,297 | **−7,456** | −6,236 | 114,018 | 34,643 | **−7,622** | −6,345 |
| − GLSL blank lines (r2: and indentation; r3 has none) | 128,025 | 41,298 | −455 | −364 | 130,500 | 42,079 | −186 | −134 |
| − GLSL whitespace (token-minified) | 122,781 | 40,817 | −936 | −570 | 125,036 | 41,580 | −685 | −402 |
| − comments and GLSL whitespace | 105,857 | 33,366 | −8,387 | −6,755 | 107,734 | 33,958 | −8,307 | −6,699 |
| JS minified (`rolldown -m`) | 81,536 | 29,247 | **−12,506** | −10,161 | 80,917 | 29,523 | **−12,742** | −10,405 |
| JS minified and GLSL token-minified | 74,562 | 28,150 | −13,603 | −11,003 | 75,893 | 28,672 | −13,593 | −10,967 |
| Vite `--minify` (oxc; keeps whitespace in ES lib output) | — | — | — | — | 97,001 | 31,569 | −10,696 | −9,000 |

Sources:

- **r2:** `.claude/perf-lab/evidence/r2/map/c.md` §4. Only the scripts (`compose.mjs`, `variants.mjs`, `by-source.mjs`) are in `.claude/perf-lab/evidence/r2/map/c/bundle/`; the raw `variants.txt` and `composition.txt` are not there.
- **r3:** `.claude/perf-lab/evidence/r3/map/c/bundle/variants.txt` and `vite-minify.txt`.

</details>

Further notes on the bundle:

- **Debug-only plumbing.** The `slots` and `register` code, `slot.hooks.*`, the `core` object and the `stats` smoothing take about 1.15 KB raw at 872e201. That figure is the sum of the line ranges listed in `.claude/perf-lab/evidence/r3/map/c/bundle/debug-plumbing.txt`. Round 2's figure of about 2 KB was an estimate from reading.
- **Remaining GLSL waste.** At 872e201 the shipped GLSL is 29,224 B raw and 9,338 B gzip, with no indentation left. Its only residue is 778 B of blank-line `\n` escapes, worth −186 B gzip.
- **Migration cost.** Neither change was prototyped.
  - Dropping JS comments is a lib-build setting in `vite.lib.config.ts`. It leaves `index.d.ts` unchanged and keeps the output readable, though dist line numbers shift.
  - Minifying also mangles names. CDN ESM users would get unreadable code, and bundling consumers usually minify anyway.
  - GLSL token minification breaks the `file:line` mapping of compile errors (`sceneLines` in `scene/index.ts`).
- **Tool caveat.** `bin/bundle-size.mjs` and `startup.mjs --bundle` find 0 of 22 shaders in the 872e201 bundle, and 0 of 21 at d0a6f41, so their "GLSL share" rows read 0 %. They match GLSL with only the `//` comments stripped, but the build now also strips per-line blanks. `.claude/perf-lab/evidence/r3/map/c/bundle/compose.mjs` reproduces the exact plugin transform. The shipped `startup.mjs --bundle` has been fixed since (Cost map).

## Rejected

27 implemented candidates or integration increments were not kept as they stood: 6 in round 1, 4 at integration 1, 7 in round 2, 3 at the round-2 integration and 7 in round 3. Five of them later reached the stack, two as the same patch and three inside a later candidate:

- r1-koi-pose-v235, re-picked unchanged in the fix stage, as PR `083cb00` (stack d0a6f41);
- r1-bundle-strip-glsl-comments, the same commit, as PR `2728924` (stack 398ec7e);
- r2-startup-shadow-loop-roll and r2-startup-trail-chunk-roll together, inside r3-startup-ir-diet, PR `e22d7b4` (stack 2f8d717);
- r2-scene-trail-age-pads, inside r3-scene-trail-cull, PR `c3160b7` (stack 70d0d86).

By the measured reason, the 27 break down as:

| reason | count | ids |
|---|---|---|
| LOSS | 11 | r1-ascii-ramp-select, r1-scene-fish-ubo, r1-scene-fish-tight-gates, r1-startup-parallel-compile, r1-scene-trail-hit-branch, r1-scene-glyph-in-scene0-alpha (1 WIN / 2 LOSS), r2-scene-eye-early-refr, r2-glow-premul-emit, r3-ascii-float-frontend, r3-scene-drawfish-fetch-hoist, r3-scene-eye-refr-vs |
| NULL | 5 | r2-scene-trail-x8, r2-startup-shadow-loop-roll, r3-ascii-halo-early, r3-cpu-uniform-cache, and r1-koi-pose-v235 at integration 1, whose step-CPU target was NULL |
| Not reproduced (rule b) | 2 | r2-scene-trail-age-pads, r2-startup-trail-chunk-roll |
| Cost moved into startup | 4 | r2-scene-trail-fetch-groups, r2-scene-polyline-prefetch, r2-ascii-space-gate-atlas, r3-ascii-atlas-array |
| Whole-batch LOSS hidden by per-draw rows | 1 | r2-ascii-bg-cell-layers |
| Not pixel-exact or not bit-exact | 3 | r1-ascii-space-gate, r1-koi-pose-fastmath, r3-startup-fbm-roll |
| No recorded reason | 1 | r1-bundle-strip-glsl-comments, 3 WIN / 0 LOSS |

Unless a row says otherwise, numbers are base → head medians of per-run medians, and "thr" is 2 x max spread.

<details><summary>Round 1: 6 candidates not kept</summary>

| id | class | measured reason | evidence |
|---|---|---|---|
| r1-ascii-ramp-select | LOSS, reproduced in 2 runs | S2 ramp cells: ascii +5.04 to +5.36 µs, at 3-7x thr (for example S2 mono 269.16 → 274.28, +5.12, thr 0.96; frame +5.04, thr 1.44). S1 ramp cells +0.24 to +0.60, all noise. Pond cells are noise. The select chain adds about 9% to the S2 ramp premium of 60.0 µs. | `.claude/perf-lab/evidence/r1/round.json` (`results[r1-ascii-ramp-select].measure`); the run files are lost |
| r1-ascii-space-gate | Not pixel-exact (exact lens refuted) | The measure was a WIN: S2 `?debug` ascii 209.24 → 194.28 (-14.96, thr 1.12) and S2 mono -17.76 (thr 2.0). The reproduce lens confirmed it: S2 -14.12 to -17.92. But with a font whose U+0020 glyph has ink, 22,602 of 480,000 px differ (max channel delta 61), and `fontFamily` is a public option. | `.claude/perf-lab/evidence/r1/r1-ascii-space-gate/verify-exact/verify.md`, `.claude/perf-lab/evidence/r1/round.json` |
| r1-scene-fish-ubo | LOSS | Scene S1 MID 24.96 → 27.04 (+2.08, thr 0.16); S2 MID 18.72 → 20.64 (+1.92, thr 0.08). Glow moved by +0.44 at S1 and -0.56 to -0.72 at S2, so scene plus glow is about +2.5 µs at S1 and +1.2 at S2. The model predicted a 0.4-5 µs gain. | `.claude/perf-lab/evidence/r1/round.json`; only `impl.md` survives in `.claude/perf-lab/evidence/r1/r1-scene-fish-ubo/` |
| r1-scene-fish-tight-gates | LOSS | S2 MID, NOON and NIGHT scene +0.24 (thr 0.08-0.16), with every head run slower than every base run. S1 NOON +0.20 (thr 0.08). The bound predicted -0.43 at S1 and -1.16 at S2. | `.claude/perf-lab/evidence/r1/r1-scene-fish-tight-gates/measure.md` |
| r1-startup-parallel-compile | LOSS (startup) | The targets were NULL: cold nav → gpu done -8.9 to -14.0 ms against thr 24.8-30.4. Disk-warm `?seed=7` nav → gpu done was a LOSS: S2 63.60 → 128.04 ms (+64.44, thr 21.72), and S1 run 2 58.85 → 123.56 (+64.71, thr 19.46). All 21 head disk-warm loads stall 64-75 ms, against 2 of 21 base loads. KHR_parallel_shader_compile gives no overlap on this driver. | `.claude/perf-lab/evidence/r1/r1-startup-parallel-compile/measure.md` |
| r1-koi-pose-fastmath | Not bit-exact in sim state; replaced by its exact subset | It won: step CPU -23 to -31% (best S2 DUSK 0.0534 → 0.0374 ms, thr 0.0092) and allocation S2 MID 33,611 → 6,479 B/frame. But the exact lens found a 1-float32-ulp flip, once in 4.65M pond-frames (pond 3970x476, seed 3253895092, frame 14, `fish0.eyes[3]`), with no pixel change. The exact subset r1-koi-pose-v235 went to integration instead. | `.claude/perf-lab/evidence/r1/r1-koi-pose-fastmath/verify-exact/verify.md`, `.claude/perf-lab/evidence/r1/round.json` |

</details>

<details><summary>Integration 1: 4 increments not kept (refs under perf-int-dropped/)</summary>

| ref | commit | runs | measured reason | evidence |
|---|---|---|---|---|
| `perf-int-dropped/r1-scene-trail-hit-branch` | 608b857 | 0 WIN / 2 LOSS | On the unrolled loop, every S1 head run is slower. Run 1: S1 DUSK 19.88 → 20.24 (+0.36, thr 0.32). Run 2: DUSK +0.40, NIGHT +0.16. The round-1 saving of 0.32-0.36 µs is absorbed and reversed by r1-scene-trail-unroll. | `.claude/perf-lab/evidence/int-r1/r1-scene-trail-hit-branch/run2.md`, `.claude/perf-lab/evidence/int-r1/integration.md` |
| `perf-int-dropped/r1-scene-glyph-in-scene0-alpha` | 16a7e10 | 1 WIN / 2 LOSS | Run 1's WIN rests on S1 paper -0.20 (thr 0.16). Runs 2 and 3 show S1 mono ascii +0.32 (+1.64%, thr 0.24). S2 mono is +3.6 to +3.7 µs with disjoint medians, classed noise. | `.claude/perf-lab/evidence/int-r1/r1-scene-glyph-in-scene0-alpha/run1.md`, `run2.md`, `run3.md` |
| `perf-int-dropped/r1-koi-pose-v235` | 7e1f763 | NULL on the target, 2 runs | Step CPU 0.0486 → 0.0426 ms (-0.0060, thr 0.0068); run 2 -0.0077 to -0.0091 ms (-Δ/thr at most 0.61). Allocation was a WIN-A, 34,529 → 17,601 B/frame (GC 3.10 → 2.00 µs/frame, minor GCs 60 → 36), but allocation was not the target. Re-landed unchanged in the fix stage as PR `083cb00` (stack d0a6f41); this ref is superseded. | `.claude/perf-lab/evidence/int-r1/r1-koi-pose-v235/run1.md`, `run2.md` |
| `perf-int-dropped/r1-bundle-strip-glsl-comments` | 398ec7e | 3 WIN / 0 LOSS, keep=false | gzip -9 48,920 → 41,104 B (-7,816, -16.0%); brotli -6,692; raw -20,021. The builds are deterministic, so the spread is 0. No reason is recorded for keep=false. The same commit, 398ec7e, is on the stack and landed as PR commit 10, `2728924`, so this ref is stale. | `.claude/perf-lab/evidence/int-r1/integration.md`, `.claude/perf-lab/evidence/int-r1/r1-bundle-strip-glsl-comments/run1.md`-`run3.md`, "Shas in this report" (Environment) |

</details>

<details><summary>Round 2: 7 candidates not kept</summary>

| id | class | measured reason | evidence |
|---|---|---|---|
| r2-ascii-bg-cell-layers | Refuted by repro: a whole-batch LOSS hidden by per-draw rows | Per draw it won: S2 glow=off ascii+asciiBg 152.00 → 136.00 µs (-16.00, thr 1.12), and S2 NOON -8.20. The whole-frame timer showed S2 +58 to +76 µs/frame (+29 to +38%), and throughput dropped 23-27% (base 193-204, head 258-278 µs per frame). Scene also moved +0.4 to +1.1, ripple +1.6 to +2.0, and the startup atlas readback +11 ms. | `.claude/perf-lab/evidence/r2/r2-ascii-bg-cell-layers/measure.md`, `.claude/perf-lab/evidence/r2/r2-ascii-bg-cell-layers/verify-repro/verify.md` |
| r2-scene-trail-fetch-groups | Refuted: cost moved into startup | Frame gain S1 scene -0.36 (thr 0.08). Cold scene link +11.3 to +12.9 ms (+8-9%); cold nav → gpu done +10.4 to +16.0 ms. | `.claude/perf-lab/evidence/r2/r2-scene-trail-fetch-groups/measure.md`, `.claude/perf-lab/evidence/r2/r2-scene-trail-fetch-groups/verify-repro/verify.md` |
| r2-scene-polyline-prefetch | Refuted: cost moved into startup | Frame gain S1 scene 27.44 → 25.84 (-1.60, thr 0.16) and S2 -0.96; reproduced. Scene link +30 to +33 ms (per-run linkMs 122-129 base against 153-169 head, disjoint); nav → first draw +32 to +38 ms. The ISA adds SGPR spills to VGPR lanes (v_writelane +36, v_readlane +39). | `.claude/perf-lab/evidence/r2/r2-scene-polyline-prefetch/measure.md`, `verify-repro/verify.md`, `impl.md` |
| r2-scene-trail-x8 | NULL | Best S2 DUSK scene -0.24 (thr 0.32); S1 -0.08 to -0.12. Head lower in 55 of 56 paired runs, below the bar. | `.claude/perf-lab/evidence/r2/r2-scene-trail-x8/measure.md` |
| r2-scene-eye-early-refr | LOSS | S1 scene +0.20 to +0.48 in all 4 queries, in both runs (thr 0.08-0.24); S2 -0.04 to -0.24. | `.claude/perf-lab/evidence/r2/r2-scene-eye-early-refr/measure.md`, `verdict.txt`, `verdict-2.txt` |
| r2-ascii-space-gate-atlas | Refuted: cost moved into startup | Frame gain S2 mono 172.32 → 160.48 (-11.84, thr 5.52); S1 pond -0.36. The getImageData readback adds +11.3 / +10.6 ms to the mesa-warm glyph-atlas row (base about 1.27). Disk-warm nav → gpu done +9.86 / +7.37 ms. | `.claude/perf-lab/evidence/r2/r2-ascii-space-gate-atlas/measure.md`, `verify-repro/verify.md` |
| r2-glow-premul-emit | LOSS | S1 glow +0.20 to +0.24, a loss in 7 of 8 cells (base 6.48-6.56, head 6.68-6.80). S2 +0.08 (3.60-3.64 against 3.68-3.72, disjoint). The 5 added fetches cost more than the 120 removed fmuls. | `.claude/perf-lab/evidence/r2/r2-glow-premul-emit/measure.md` |

</details>

<details><summary>Round-2 integration: 3 increments not kept (refs under perf-int-dropped/)</summary>

| ref | commit | runs | measured reason | evidence |
|---|---|---|---|---|
| `perf-int-dropped/r2-startup-shadow-loop-roll` | 351e827 | NULL, NULL | Run 1: S1 `?seed=7` cold nav → gpu done 269.71 → 251.87 ms (-17.84, thr 19.96); all 7 head runs below all 7 base runs. Run 2: closest was S1 `?debug` 312.04 → 291.84 (-20.20, thr 20.81), NULL by 0.6 ms. The effect is steady at -18 to -23 ms nav → gpu done, but the 2 x spread rule never clears. Re-landed with b0dc6d7 as r3-startup-ir-diet, PR `e22d7b4`. | `.claude/perf-lab/evidence/r2/int/r2-startup-shadow-loop-roll/run1.md`, `run2.md` |
| `perf-int-dropped/r2-scene-trail-age-pads` | abea94c | NULL, WIN[S1], NULL | Run 2's only win cell, S1 DUSK scene 19.44 → 19.24 (-0.20, thr 0.16), did not reproduce in run 3 (-0.20, thr 0.24). Scene was lower in all 24 cells across the 3 runs, -0.08 to -0.24 µs. The candidate measured S1 -0.40 to -0.52 on d0a6f41, so the stack absorbed most of it. Contained in r3-scene-trail-cull, PR `c3160b7`; see "Unproven" for its whole-batch result. | `.claude/perf-lab/evidence/r2/int/r2-scene-trail-age-pads/run1.md`-`run3.md` |
| `perf-int-dropped/r2-startup-trail-chunk-roll` | b0dc6d7 | WIN[S2], NULL, WIN[S1] | Run 1: S2 `?seed=7` cold nav → gpu done 269.78 → 249.09 (-20.69, thr 19.11, 1.08x). Run 2: closest S2 `?debug` programs (wall) -8.68 (thr 10.01). Run 3: S1 `?seed=7` 267.05 → 246.54 (-20.50, thr 16.56, 1.24x). No size x query x row crossed in two runs, so rule (b) held for neither size. Re-landed with 351e827 as r3-startup-ir-diet, PR `e22d7b4`. | `.claude/perf-lab/evidence/r2/int/r2-startup-trail-chunk-roll/run1.md`-`run3.md` |

The remaining dropped refs, `perf-int-dropped/r1-bundle-strip-glsl-comments` (398ec7e) and `perf-int-dropped/r1-koi-pose-v235` (7e1f763), are stale: their content landed as PR `2728924` (stack 398ec7e) and PR `083cb00` (stack d0a6f41) (`git branch --list 'perf-int-dropped/*' -v`).

</details>

<details><summary>Round 3: 7 candidates not kept</summary>

| id | branch head | class | measured reason | evidence |
|---|---|---|---|---|
| r3-ascii-float-frontend | 3dad7fa | LOSS against its own base, commit 1 (r3-ascii-fmul) | S1 pond ascii +0.28 to +0.32 µs in all 4 pond queries: DUSK +0.32 (thr 0.24), NIGHT +0.32 (thr 0.32, a float tie). A fresh S1 repeat gave the same medians. S2 won: mono 144.88 → 132.68 (-12.20, thr 4.16), NOON -3.52 (thr 3.04). The stack comparison against 872e201 (fmul plus this) was WIN-A, but most of that is commit 1. | `.claude/perf-lab/evidence/r3/r3-ascii-float-frontend/measure.md`, `verdict-c1.txt`, `verdict-c1-s1-2.txt` |
| r3-startup-fbm-roll | 7e2aaad | Not pixel-exact; abandoned before measuring | The speed premise held: main-variant ISA 9,991 → 8,387 instructions, 50,304 → 43,120 B. Rolling fbm stops NIR folding each caller's constant into the first octave, for example kohaku `ffma(0.5, g0, 0.1)`. A native A/B render against origin/main gives 1-LSB oColor differences at koi-marking and moon texels: 62 texels over 10 big-moon frames, 18 over 60 night frames. Commit 1 alone is identical. | `.claude/perf-lab/evidence/r3/r3-startup-fbm-roll/impl.md`, `sum-order.txt` |
| r3-ascii-atlas-array | 5ecbd8b | Refuted by repro, and cost moved into startup | Measure: S2 paper ascii 88.28 → 82.96 (-5.32, thr 2.80). Repro: S2 paper -5.12 against thr 4.72 (1.08x); S1 not reproduced (paper -0.52, thr 0.56). Startup: programs → first draw +1.5 to +2.7 ms in every fresh-GPU-process variant (a LOSS by rule in cold run 1, +2.42 against thr 1.92). Disk-warm first draw → gpu done 1.90 → 3.50 ms. Disk-warm nav → gpu done +7.40 / +6.70 ms. | `.claude/perf-lab/evidence/r3/r3-ascii-atlas-array/measure.md`, `verify-repro/` |
| r3-scene-drawfish-fetch-hoist | 451c61f (rung c); rungs a f110428 and t f060454 | LOSS (rung c); NULL (rungs a and t) | Rung c: all 20 scene cells positive, +0.20 to +0.32 at S1 and +0.08 to +0.28 at S2. Run 1 S1 NOON +0.20 (thr 0.16); run 2 S1 DUSK +0.32 (thr 0.24). VGPRs 96 → 120 (8 → 6 waves). Rungs a and t: about -0.16 at S1 and -0.1 at S2, under thr 0.24-0.48. Rung a's one WIN cell, S1 NIGHT -0.16 against 0.16, is a float tie and did not repeat (-0.12 against 0.40). | `.claude/perf-lab/evidence/r3/r3-scene-drawfish-fetch-hoist/measure.md`, `table-run1.md`, `table-run2.md`, `table-rung-a.md`, `table-rung-t.md` |
| r3-scene-eye-refr-vs | a19e59f | LOSS, plus cost moved into startup | Scene Δ was 0 to +0.20 in all 20 cells, against a predicted -0.3 to -0.8. S1 NIGHT +0.16 (thr 0.16) in both runs, with disjoint run sets. Whole-batch at S1 was +0.35 to +1.26 µs in all 5 queries (disjoint, under thr). PS VGPRs 96 → 108. Cold scene compile+link +12.2 to +13.5 ms (about 138.5 → 151). | `.claude/perf-lab/evidence/r3/r3-scene-eye-refr-vs/measure.md`, `startup-s1.json`, `startup-s2.json` |
| r3-ascii-halo-early | c5e4ec3 | NULL | Best S2 mono ascii 164.80 → 162.56 (-2.24, thr 4.48, 0.50x), with head lower in all 7 pairs; S1 mono -0.16 (thr 0.32). The spec's bound was about 6 µs at S2. VGPRs 12 → 24 at 16 waves; the base sample already overlapped the atlas load. | `.claude/perf-lab/evidence/r3/r3-ascii-halo-early/measure.md`, `verdict.txt`, `batchq-verdict.txt` |
| r3-cpu-uniform-cache | f798abd | NULL | Best step cell S2 DUSK 0.0450 → 0.0441 ms (-0.0009, thr 0.0266). Allocation -3 to +37 B/frame (thr 112-228). The V8 profile shows native uniform self time 1.0 → 0.2-0.4 µs per frame, partly moved into Object.is compares (program.ts 1.3 → 2.0 µs): a net of 0.5 µs per frame or less. | `.claude/perf-lab/evidence/r3/r3-cpu-uniform-cache/measure.md`, `judge.txt` |

Round-3 branches that are not rejected candidates:

- `perf-cand/r3-ascii-ramp-float-index-a` (1c70a66) is part (a) of the kept r3-ascii-ramp-float-index. It was integrated together with part (b) as PR `8e4b418` (stack 4a95fa2).
- `perf-cand/r3-scene-trail-cull-abea94c` (0718d4e) is the abea94c-only decomposition run for r3-scene-trail-cull.
- `perf-ablate-r2a`, `perf-ablate-r2b2`, `perf-ablate-r3a` and `perf-ablate-r3b` are measurement-only ablation branches that never land.

</details>

### Triage-dropped hypotheses

These hypotheses were dropped at triage, so none was implemented. The reason given for each is its bound, its exactness, or a precedent.

<details><summary>Round 1: 13 dropped</summary>

- Scene ripple stencil with shared bilerp weights or LINEAR filtering: not exact (t±1 rounds differently for 5-14% of cells; hardware bilinear uses 8-bit weights), and the bound is at most 0.45 / 0.27 µs.
- Glow separable two-pass blur: not exact (the factored exp and the changed summation order guarantee a DIFF).
- Glow empty-neighbourhood mask pass: about 0 gain at MID and NIGHT, and a likely frame-row loss of about 2.8 µs from the extra pass.
- Per-lane trail sphere-trace skip: redundant with r1-scene-trail-chunk-boxes; the divergent fetch addresses would likely cost more than they save.
- Three rotating R16F ripple textures: expected null or negative (bound 0.10 / 0.36 µs), with a large rework of the packed path.
- Lazy fly program build: 3.08 ms cold, below the 2x startup floors, and it moves a 3 ms hitch onto the first dusk frame.
- Minify the published dist: reverses the readable-dist policy and gives 0 B to bundling consumers. Maintainer policy.
- Emission in the scene MRT's free unorm channels: not exact (k*fl(1/255) != fl(k/255) for 126 of 256 values).
- Glow wsum as a CPU uniform: not exact (JS Math.exp against the GPU exp), and at most 0.04 µs.
- Scene CPU-hoisted lighting, per-segment 1/|ab|^2, atan to octant compares, mediump colour: not exact, and the bounds are small.
- Koi.update Math.hypot → sqrt: not exact (the positive control at koi.ts:305 diverged in fish2.angVel).
- Below-noise items from the area agents: each bound is below 2x the noise floor of its target at both sizes.
- Duplicates merged into implemented candidates.

Evidence: `.claude/perf-lab/evidence/r1/round.json` (`triage.dropped`).

</details>

<details><summary>Round 2: 12 dropped</summary>

- Emission as a third scene MRT: not exact (it would have to emulate the RGBA8 pkrtz store bit for bit, and fly overwrites cells after the scene); bound about 0.68 µs at S1.
- R32F narrow emission: doubles the glow fetches per tap to save at most 0.36 µs. Expected net loss.
- Glow weight-mask fallback: moot while r2-glow-zero-pad-emit was in flight (it was kept).
- ascii scissor plus margin draws: a clear is not exact, and the margin version is subsumed by r2-ascii-bg-cell-layers.
- Per-look ascii variants, instanced quads, float-address rewrite, mix rewrite and halo items: at or below noise on the stack (look 0.16-0.20 at S1), or not exact.
- Scene lazy background, water gating, voronoi/fbm/glint/crest/mote/sky culls, ripple 5-tap dedupe, MRT narrowing: each at most 0.32 / 0.80 µs, or a measured net loss (the nearFish probe costs 0.48 to save 0.12).
- Fish micro-items (shadow prefetch, tail skip, fused shadows and others): at most 0.1-0.24 µs each, a known LOSS (fish UBO +2 µs), or not exact.
- Trail micro-items (tight pad alone, CPU age cutoff, TRAIL_CHUNK=4 and others): contained in r2-scene-trail-age-pads, or at most one critical-wave round trip (0.09-0.28 µs).
- Ripple items (damping texture, integer coords, skip at rest, dirty rect and others): at most 0.04-0.09 µs at S2, or not exact.
- CPU micro-items: at most 0.001-0.0025 ms or 263 B/frame, against thresholds of 0.0134 ms and 224-542 B.
- Architecture (glow fused into ascii, separable glow, RGBA16F emission, varying in the cell passes, cross-remount program cache): a loss by construction (about 98x), not exact, about 0.10 µs, or not measurable this round.
- Startup micro-items: at most 7 ms each, against 12.2 / 42.5 ms thresholds.

Evidence: `.claude/perf-lab/evidence/r2/round.json` (`triage.dropped`).

</details>

<details><summary>Round 3: 25 dropped</summary>

- r2-scene-trail-age-pads re-measured alone: contained in r3-scene-trail-cull, whose measure stage reported the abea94c-only decomposition.
- Per-layer scene programs / r2-scene-layer-split-instanced: whole-batch bound 0 to -1.5 µs at S1, under the 1.84-2.2 threshold, with a likely +15 to +30 ms cold-start loss.
- r2-ripple-two-texels: bound 0.06 / 0.21 µs, offset by +0.02 to +0.08 µs on the scene row.
- Ripple clamps, texelFetchOffset, interior fast path, drop tweaks: at most 0.05 / 0.10 µs.
- gl_FragCoord → varying in the scene, emission and glow passes: at most 0.12-0.16 µs per cell pass. Only the ripple pass had a bound above noise (it became r3-ripple-pos-varying).
- Single atan in pickGlyph: about -2.5 ms startup and at most 0.05-0.1 µs per draw.
- Caustic 3x3 loop roll: not exact (constant folding into ffma).
- Pec fin, eye, trail j-loop and tailSD loop rolls; r2-startup-polyline-roll: -1 to -2.5 ms each, a per-frame loss (tailSD), or not exact (polyline).
- Scene-first build order, font-wait overlap, lazy builds, atlas build, context reorder: at most -11 ms together, under the 11.6 ms smallest cold threshold.
- KHR_parallel_shader_compile / deferred LINK_STATUS: precedent r1-startup-parallel-compile (disk-warm LOSS +60 to +65 ms).
- r2-koi-update-unbox: -70 to -75 B/frame offline, against 122-194 B thresholds.
- r2-cpu-pack-skip: 0 on cpu.mjs, and its only metric has no spread, so the win rule cannot be applied without new tooling.
- Other CPU micro-items: at most 100-190 B/frame or 0.0008 ms/frame each.
- r2-scene-pickglyph-alu: premise false (the ISA has no constant-data loads; the tables are already selects).
- r2-scene-fish-header-prefetch and related: bound 0.24 / 0.44 µs, under 0.40 / 0.48.
- r2-scene-tail-hit-reuse, r2-scene-part-boxes and other gates: subsumed by the branch-free polyline, 0-0.3 µs, or not exact.
- r2-scene-trail-prefetch-next and other trail micro-ideas: needed the refuted fetch-groups, or 0.1-0.48 µs whole-batch at best.
- Water, sky, glint, mote and crest culls and related: at most 0.08-0.36 µs, or not exact.
- ascii below-noise items: at or below noise in map A (for example celldiv 0.28-0.32 / 1.16-2.12), or not exact.
- Glow and emission below-noise items: at most 0.04-0.40 µs, a recorded LOSS (premultiplied), or not exact.
- Eye refraction merged into the fetch-hoist clause unconditionally: saves at most about 0.2 µs, against an eye_gate inverse of +0.92 / +0.56.
- preserveDrawingBuffer:true / alpha:true: refuted in map D (-24% fps at S2; alpha null).
- Bundle JSDoc drop, rolldown -m, GLSL token minify, debug-hook split: maintainer policy, or it breaks sceneLines error mapping.
- Round-1 deferred demo and behaviour items: demo-only or behaviour changes needing a maintainer decision.
- Re-prototype of p3 maxFps: not re-run; the proposal stands with a note.

Evidence: `.claude/perf-lab/evidence/r3/summary.md` ("Triage, Dropped"), `.claude/perf-lab/evidence/r3/round.json`.

</details>

## Unproven

The evidence for each item below is borderline, incomplete or missing.

- **The round-1 and integration-1 numbers rest on reconstructed files.**
  - The raw perf JSON for round 1 and integration 1 was lost in the /tmp wipe at the reboot after round 1 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26).
  - The numbers in this report for those stages come from markdown write-ups and from `round.json` / `result.json` files rebuilt from the workflow journal. Examples: r1-ascii-ramp-select, r1-scene-fish-ubo and the integration-1 tip of -31.1% / -26.4%.
  - Eight replayed edits failed because their files were already gone, among them `r1/r1-glow-branchfree-taps/impl.md` and `r1/proposals/p1-max-pixel-ratio/proposal.md` (`.claude/perf-lab/recover/replay-log.json`).
  - r1-scene-fish-ubo and r1-ascii-ramp-select have only `impl.md` left in their directories.
- **The cell-divide divtest's raw output is gone.** r1-ascii-float-celldiv's exact-lens write-up reports 0 mismatches for every q below 2^20 and every cell size up to 512, on this GPU and on SwiftShader (`.claude/perf-lab/evidence/r1/r1-ascii-float-celldiv/verify-exact/verify.md` lines 56-63). The files it names, `run-2/divtest/{gpu,swiftshader}.json` and `run-2/precision/celldiv2.txt`, are not in the lab. Only the scripts (`.claude/perf-lab/verify-exact-2/divtest.mjs`, `run-2/precision/celldiv2.py`) and the write-up, rebuilt on 2026-10-27, remain.
- **Clock regime direction.** Round 1 ran in the faster S1 regime (lower µs), not the slower one:
  - origin/main's S1 frame, as the median of the 4 standard queries, was 67.28 µs in integration 1 and 88.74 µs in round-3 map D (MID alone: 67.12 and 88.48);
  - a session observation gives about 2.2-2.4 GHz before the reboot and about 1.75 GHz after it.

  No sclk log from round 1 survived. The pre-reboot clock figure comes from a session observation, not from a lab file.
- **The reboot date.**
  - The lab notes date the /tmp loss to 2026-10-26.
  - `journalctl --list-boots` shows the round-1 boot ended 2026-10-23 00:57 EEST, with three more boots before the 2026-10-26 14:38 boot in which work resumed. Which boot after round 1 moved S1 into the slower regime is not recorded.
  - git dates the round-2 fix stage and maps to 2026-10-22, in round 1's boot (d0a6f41 at 18:57; map ablation commits 19:00 to 19:58 EEST). So their absolute µs are probably in the faster regime; map A's base S1 frame, 46.4 µs at 398ec7e (`.claude/perf-lab/evidence/r2/map/a.md`), is close to de4b18c's 46.44 in integration 1. No clock was logged for them.
  - The first round-2 hypotheses and triage ran before the reboot, and the lab gives them no date. Both were re-run on 2026-10-27.
- **r1-bundle-strip-glsl-comments.**
  - Integration 1 set keep=false despite 3 WIN / 0 LOSS, with no recorded reason.
  - The same commit, 398ec7e, was then committed onto the stack at 17:52, also with no recorded decision.
  - Its commit message states gzip 47,139 → 40,317 B, while the integration-1 run measured 48,920 → 41,104 B. The two were measured on different bases.
- **r1-koi-pose-v235 changed target after the fact.**
  - It was dropped at integration 1 because its target, step CPU, was NULL (-0.0060 ms, thr 0.0068).
  - It was re-landed in the fix stage with allocation as the target: 34,537 → 17,597 B/frame (thr 380). Its step-CPU effect has never cleared the rule.
- **r2-startup-trail-chunk-roll's two WINs.**
  - The two WINs fall at different sizes: S2 `?seed=7` 1.08x in run 1, S1 `?seed=7` 1.24x in run 3, with run 2 NULL. No single cell won twice.
  - Read per metric (cold `?seed=7` nav → gpu done), it reproduces in 2 of 3 runs, and the direction held in 81 of 81 run pairs.
  - Evidence: `.claude/perf-lab/evidence/r2/int/r2-startup-trail-chunk-roll/run3.md`.
- **The round-2 startup loop rolls before r3-startup-ir-diet.**
  - Alone, neither r2-startup-shadow-loop-roll (NULL, NULL; about -18 to -20 ms) nor r2-startup-trail-chunk-roll (2 of 3) cleared rule (b).
  - Combined as r3-startup-ir-diet, they won at both sizes in both integration runs. An example is run 1 S2 `?seed=7` cold nav → gpu done 271.14 → 228.61 ms (-42.53, thr 13.55) (`.claude/perf-lab/evidence/r3/int/r3-startup-ir-diet/`).
  - How the -40 ms splits between the two rolls on the round-3 stack was not measured.
- **r2-scene-trail-age-pads was dropped on per-draw rows.** In round 3, the abea94c-only decomposition measured whole-batch S1 DUSK 51.28 → 50.10 µs (-1.18, thr 1.06, WIN-A) in one run (`.claude/perf-lab/evidence/r3/r3-scene-trail-cull/batchq-abea94c-verdict.txt`). The share it adds inside r3-scene-trail-cull (about 0.4-0.5 µs from the age cut plus the CPU TBOX) is inferred across separate runs.
- **Deferred and never measured:**
  - r3-scene-eye-pair-refr (expected -0.1 to -0.3 µs at S1, bound 0.60, against a 0.40 threshold);
  - r3-present-desync-probe (expected 0 on Linux Chromium, and a presentation-behaviour change the pixel gate cannot see);
  - r2-cpu-pack-skip (no tool can apply the rule to its metric).

  The proposals were prototyped but are not candidates: r1 p1-p3, r3-p1-max-pixel-ratio and r3-p2-glow-switch. Evidence: `.claude/perf-lab/evidence/r3/summary.md`.
- **Kept with thin margins:**
  - r1-ascii-glow-skip-cleared: each run won a different cell. Run 2's ascii cell (S2 glow=off) tied its threshold, -2.40 against 2.40, and it counted as a win only by float rounding; its frame cell won, -2.64 against 2.16 (Perf changes row 3).
  - r1-ascii-glow-lod: won only S2 mono, at 1.13x and 1.07x (`.claude/perf-lab/evidence/int-r1/integration.md`).
  - r3-ascii-ramp-float-index: run 1's best cell was 1.05x (S2 mono -6.56 against 6.24); run 2 was 3.1x.
  - r3-ascii-border-on-cell: the measure stage's only S2 WIN cell was NOON (-2.72 against 2.40).
- **Causes that were inferred, not tested:**
  - r3-ascii-float-frontend's S1 pond regression, put down to one more VALU in the glyph → atlas dependent chain;
  - the VGPR/occupancy explanation for r3-scene-drawfish-fetch-hoist and r3-scene-eye-refr-vs;
  - r1-scene-fish-ubo's ANGLE/ACO explanation;
  - r1-ascii-space-gate realising only about 30% of its bound (about 15 of an estimated 50 µs at S2), put down to wave divergence. The figure survives only in `.claude/perf-lab/evidence/r1/round.json` (the candidate's `measure.notes`, rebuilt from the journal); its `measure.md` is lost.
- **r1-ascii-space-gate's remedy.** The atlas-readback fix became r2-ascii-space-gate-atlas, which was refuted on startup cost. No exact variant without a readback was tried.
- **The round-3 clock figure.** "Busy sclk p50 1731 MHz" is the median of only 5 samples with busy above 50%. Over all busy samples the median is 852.5 MHz. The claim that the regime did not change rests mainly on the matching S1 frame, 46.92 µs (`.claude/perf-lab/evidence/r3/smoke/clock-reboot2-s1.tsv`).
- **Round-3 implementation count.** `PAUSED.md` says "all 19 implementations"; `round.json` lists 18 results. The extra one is not identified.
- **The round cap.** The lab records it only as the round-3 triage note "the last round". The maintainer's instruction is in the session, not in `.claude/perf-lab`.

## Gaps

- **One GPU, one driver, one browser.** Every number comes from the RX 9060 XT with Mesa 26.2.2 radeonsi/ACO, through ANGLE-GL, in headless Chromium 156 on Linux. Nothing was measured or pixel-checked on any other combination:
  - other GPU vendors (NVIDIA, Intel, Apple);
  - ANGLE's D3D11 or Metal backends;
  - Firefox or Safari.

  Some exactness arguments are compiler-specific:
  - `.claude/perf-lab/evidence/r2/r2-scene-layer-split/verify-exact/verify.md` line 163 notes that another compiler could resolve a CSE differently;
  - `.claude/perf-lab/evidence/int-r1/integration.md` line 146 says fma contraction in the reshaped code was tested only on this GPU.

  A different driver could therefore change pixels where this one gives SAME.
- **SwiftShader was used only to check exactness.** gpu.ts refuses it for timing, so the software path has no cost numbers at all. It was probed directly twice:
  - `.claude/perf-lab/evidence/r1/r1-ascii-float-celldiv/verify-exact/verify.md` lines 56-63: divtest, 0 mismatches over q < 2^20. The raw output that write-up names (`run-2/divtest/{gpu,swiftshader}.json`, `run-2/precision/celldiv2.txt`) is not in the lab. Only the scripts (`.claude/perf-lab/verify-exact-2/divtest.mjs`, `run-2/precision/celldiv2.py`) and the write-up, rebuilt on 2026-10-27, remain;
  - `.claude/perf-lab/evidence/r3/r3-ascii-ramp-float-index/verify-exact/verify.md` lines 46-47: mixprobe.

  Other changes were argued safe on the software path by reading only, for example `.claude/perf-lab/evidence/int-r1/final/exact/verify.md` line 129 and `.claude/perf-lab/evidence/r3/r3-ascii-fmul/verify-exact/verify.md` lines 31 and 55. The browser suite only checks that the software path is chosen (`.claude/perf-lab/evidence/final/checks/browser.txt` line 34).
- **The no-float32 fallback was never timed.** Without `EXT_color_buffer_float`, glow.frag gets `emission.glsl` prepended and computes emission per tap. No perf, batch or cpu run hid the extension, so the cost of this path is unknown. Its pixel checks, all SAME, include:
  - integration 1: 66 `noext-f32` cells (`.claude/perf-lab/evidence/int-r1/integration.md` line 133; `.claude/perf-lab/evidence/int-r1/final/exact/verify.md` line 56);
  - r2-glow-zero-pad-emit: 46 cells (`.claude/perf-lab/evidence/r2/r2-glow-zero-pad-emit/measure.md` line 13);
  - r3-ripple-pos-varying: 4 tap configs with float and half-float refused (`.claude/perf-lab/evidence/r3/r3-ripple-pos-varying/verify-exact/verify.md` line 58).
- **Mobile and weak GPUs.** No phone, integrated GPU or battery-powered device was measured. That is where r3-p1, r3-p2 and p3 claim their main benefit (r3-p2 proposal, Risks 1). The proposals' per-pass shares and power savings may differ there.
- **Evidence lost in the reboot after round 1** (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26). `/tmp` was wiped before the durable `.claude/perf-lab` folder existed.
  - Round 1's `.md` files (107 under `r1/` and `int-r1/`) were rebuilt from session transcripts on 2026-10-27 between 18:26 and 18:27 (`.claude/perf-lab/recover/`).
  - Only 2 JSON files and no `.stderr` files survive for round 1. Rounds 2 and 3 keep 1,025 and 1,162 JSON files.
  - The costmap's `baseline/` folder is gone, and there is no queue log before 2026-10-27T18:28:03.
  - So round-1 figures cannot be re-derived from raw output. These include the costmap headline, r1 p1, r1 p2 and r1 p3, and the pre-reboot 2.2-2.4 GHz clock.
- **Per-draw sums and whole batches each miss something.**
  - **perf** (a per-draw sum) misses work between draws. The 2 µs glow-target clear is the clearest case: r3-glow-clear-once was NULL in perf but a WIN in the whole batch at S1 with glow=off: −1.81 µs per frame against a threshold of 1.28 (measure stage, against 872e201; the integration rows are in Perf changes, row 24: −1.61, thr 0.90). At S2 it stayed below noise (−0.43 and −1.14 against thresholds of about 5). The lab nodraw mode isolates the clear itself at −2.08 µs (S1) and −1.87 µs (S2) (`.claude/perf-lab/evidence/r3/r3-glow-clear-once/measure.md` lines 15-35). perf also over-counts by 0.2-2.6 µs, because each query serialises the pipeline (`.claude/perf-lab/evidence/r3/map/d.md` lines 378-380).
  - **batch** (back-to-back `koi.step`) misses what only a presented frame pays. WebGL's deferred drawing-buffer clear costs 37.6 µs per frame at S2 (22 % of the 169 µs frame) and 7.7 µs at S1 (`.claude/perf-lab/evidence/r3/map/d.md` line 55). batch also misses the low-clock 60 Hz regime (648-651 µs per S2 frame, r3-p1).
  - **Chromium's own per-frame CPU** in the present path is visible to neither perf nor cpu.mjs (p3).
  - The lab tools that see these costs, `outside.mjs` and `paced.mjs`, did not land.
  - The round-3 summary leaves r3-present-desync-probe untested (`.claude/perf-lab/evidence/r3/summary.md` line 63).
- **No map of the final tip.** The round-3 maps A-D, the bundle map and both r3 proposals were measured on 872e201. The final source tree (0378378, the same tree as the lab stack tip 431e4c3) has 11 more source commits, several of which change ascii, glow, trails, CPU and start-up. The final measure ran on e84cf1d, the same tree as 637f55d: 0378378 plus 5 tool and docs commits with no `src/` change. Against 23cd98e it covers only whole-pass GPU, whole batch, CPU step and allocation, start-up phases, and bundle bytes and GLSL share (see Combined result). Nothing finer was re-measured on the tip: no per-region ablation map, no per-program or critical-path start-up map, no CPU self-time profile (the head's allocation sites are in Combined result), and no r3-p1 or r3-p2 re-run.
- **The round cap.** Round 3 was the last round. The round-3 summary records what that left out:
  - two candidates were deferred because the per-round cap of 18 was reached, r3-scene-eye-pair-refr and r3-present-desync-probe (`.claude/perf-lab/evidence/r3/summary.md` lines 62-63, under "Deferred");
  - "no tooling round left" for r2-cpu-pack-skip (line 78);
  - start-up ordering ideas were judged "not worth a separate candidate in the last round" (line 75);
  - round 1's deferred demo and behaviour items were dropped as not perf candidates; they need a maintainer decision (line 90, under "Dropped").
  The maintainer's instruction that set the cap is not itself in the evidence folder.

## Rounds log

The work ran as three rounds. Each round went through the same stages: map, hypotheses, triage, implement, measure, verify (a reproduce lens and an exact lens), then integrate onto `perf-int/r1`. At integration, each increment had two runs, or three when the first two disagreed. Two more stages sit between round 1 and round 2: integration 1 (`int-r1`), and a fix stage at the start of round 2 that re-landed one increment integration 1 had dropped. Unless a row says otherwise, dates and times are local: EEST (+0300) up to 2026-10-25, EET (+0200) from then on. "The reboot" means the reboot after round 1 (round 1's boot ended 2026-10-23 00:57; the lab notes date the /tmp loss to 2026-10-26).

Shas in this log (tips, kept lists) are `perf-int/r1` stack shas. They are not ancestors of the PR branch; each landed commit was re-applied with an identical tree, and the "Shas in this report" table under Environment maps every stack sha to its PR sha (for example 872e201 → 7835893, 431e4c3 → 0378378).

| stage | date | base | mapped | hypotheses → implement / proposals / deferred / dropped | implemented → measured → survived → kept | tip after |
|---|---|---|---|---|---|---|
| Round 1 | 2026-10-22 | 23cd98e (origin/main) | baseline cost map: ablation switches, CPU, startup, bundle; then 4 map gaps closed | 70 in 11 areas → 18 / 3 / 32 / 13 | 18 → 18 → 13 → integrated below | - |
| Integration 1 | 2026-10-22, stack committed 17:36 | 23cd98e | - | - | 13 increments → 9 kept | de4b18c |
| (between stages) | 2026-10-22 17:52 | de4b18c | - | - | 398ec7e (comment strip) committed onto the stack; the evidence gives no reason | 398ec7e |
| Fix | 2026-10-22, d0a6f41 committed 18:57 | 398ec7e | - | - | 1 → 1 → 1 → 1 | d0a6f41 |
| Round 2 | maps 2026-10-22 (git); first hypotheses and triage before the reboot, undated; both re-run 2026-10-27; candidates 2026-10-27 19:14 to integration end 2026-10-28 00:30 | d0a6f41 | maps A (ascii/emission/glow), B (scene), C (CPU, allocation, startup, bundle) | 46 in 9 areas → 18 / 0 / 18 / 12 | 18 → 18 → 11 → 8 | 872e201 |
| Round 3 | 2026-10-28 00:44 to 22:17, paused 05:30 to 18:17 across a reboot | 872e201 | maps A-D (D: tip against main, and the costs outside the draws) | 34 in 9 areas, plus 141 below-noise items → 18 / 2 / 2 / 25 | 18 → 17 → 11 → 11 | 431e4c3 |

The four triage counts are triage items from each `round.json` `triage` (70 / 46 / 34 hypotheses become 66 / 48 / 47 items), because triage merges or splits hypotheses; they need not sum to the hypothesis count.

Each tip against origin/main, with both sides measured in one run. Each value is the median of the 4 standard queries (MID, NOON, DUSK, NIGHT), and Δ% is the median of their Δ%:

| tip | regime | S1 frame (µs) | S2 frame (µs) | evidence |
|---|---|---|---|---|
| de4b18c (after integration 1) | before the reboot | 67.28 → 46.44 (-20.84, -31.1%) | 242.88 → 178.72 (-63.94, -26.4%) | `.claude/perf-lab/evidence/int-r1/integration.md` (reconstructed; the raw JSON is lost) |
| 872e201 (after round 2) | after the reboot | 88.74 → 46.82 (-47.2%) | 243.56 → 132.36 (-45.6%) | `.claude/perf-lab/evidence/r3/map/d.md` lines 91-107 (S1) and 130-146 (S2); its MID-only headline is 88.48 → 46.92 and 243.60 → 132.36 |
| 431e4c3 (after round 3; measured as e84cf1d, the sha in the raw JSON, which has the tree of PR tip 637f55d and the same `src/` as 431e4c3) | after the reboot | 88.44 → 43.26 (-51.0%), run 1 | 243.62 → 109.58 (-55.0%), run 1 | `.claude/perf-lab/evidence/final/perf/summary.md` |

The absolute S1 numbers in row 1 and rows 2-3 come from different clock regimes, so do not compare them. See "Reboots and clock regime" below.

### Round 1 (2026-10-22, base 23cd98e)

- **Mapped:** the baseline cost map at origin/main, from about 40 ablation switches on `perf-ablate` d68e8b2, plus CPU, cold-start and bundle tables. Headline figures:
  - S1 frame 67.70 µs, split scene 36.8%, ascii 36.1% and glow 25.9%;
  - S2 frame 242.94 µs, of which ascii is 86.0%;
  - the ascii ivec2 division alone is 54.08 µs at S2;
  - cold start is 223.1 ms from mount to first draw, and 88% of that is the serial program build.

  A follow-up closed the map's 4 gaps, splitting the old ascii_atlas switch into atlasfetch 34.9 µs, glyphfetch 15.6 µs and ascii_glow 15.2 µs, with intdiv at 53.6 µs. Evidence: `.claude/perf-lab/evidence/costmap.md`, `.claude/perf-lab/evidence/map-gaps/gaps.md`.
- **Hypotheses:** 70 in 11 areas: bundle 3, ripple-fly 5, cpu-render 5, scene-water 4, architecture 10, glow 7, scene-trails-structure 9, ascii 9, cpu-sim 5, scene-fish 8, startup 5.
  - Triage: implement 18; proposals 3 (p1-max-pixel-ratio, p2-glow-quality, p3-max-fps); deferred 32; dropped 13.
  - Evidence: `.claude/perf-lab/evidence/r1/round.json` (`hypotheses`, `triage`).
- **Candidates:** 18 implemented, 18 measured, 13 survived. The 5 that failed:
  - r1-ascii-ramp-select, r1-scene-fish-ubo, r1-scene-fish-tight-gates and r1-startup-parallel-compile: LOSS;
  - r1-ascii-space-gate: not pixel-exact.

  r1-koi-pose-fastmath survived but is not bit-exact in sim state. Its exact subset, r1-koi-pose-v235, went to integration in its place. Evidence: `.claude/perf-lab/evidence/r1/round.json` (`results[].survived`).
- **Raw files:** the round's raw outputs were lost in the reboot. What remains is 114 files: markdown write-ups and a `round.json` that was rebuilt from the workflow journal on 2026-10-27.

### Integration 1 (2026-10-22, base 23cd98e, tip de4b18c)

- 13 increments were tried and 9 kept. Each kept number is the integration-run delta on the stack, from `.claude/perf-lab/evidence/int-r1/integration.md`:

  | increment | delta on the stack |
  |---|---|
  | r1-ascii-float-celldiv | S1 -5.52 / S2 -54.28 µs |
  | r1-ascii-look-branch | S2 mono -11.12 µs |
  | r1-ascii-glow-skip-cleared | S1 glow=off -0.28 µs |
  | r1-ascii-glow-lod | S2 mono -4.80 µs |
  | r1-glow-emission-prepass | -5.68 / -3.88 µs |
  | r1-glow-branchfree-taps | -3.04 / -1.72 µs |
  | r1-scene-trail-chunk-boxes | S1 DUSK -2.32 µs |
  | r1-scene-trail-unroll | -1.44 / -1.12 µs |
  | r1-scene-eye-gate | -0.52 / -0.40 µs |

- Not kept: r1-scene-trail-hit-branch, r1-scene-glyph-in-scene0-alpha, r1-koi-pose-v235 and r1-bundle-strip-glsl-comments. Their numbers are under "Rejected".
- The merge gate was SAME on 147 cells.
- Costs that were kept with the stack:
  - Cold first draw → gpu done went up 22.5 to 30.5 ms, a rule (a) LOSS in 8 of 8 cells, bisected to r1-glow-emission-prepass (PR `3cbb8ec`, stack 443f903). nav → gpu done was noise (-2.7 to +3.7 ms).
  - The bundle grew by 2,081 B gzip.
  - Step CPU was NULL.

  Evidence: `.claude/perf-lab/evidence/int-r1/integration.md`.

### Fix stage (2026-10-22, on 398ec7e, tip d0a6f41)

- r1-koi-pose-v235 was re-landed as d0a6f41 with allocation as its target. It was kept, 2 WIN / 0 LOSS:
  - S1 MID allocation went 34,537 → 17,597 B/frame (-49.0%, threshold 380).
  - Step CPU stayed NULL (-0.0082 ms, threshold 0.0134).
  - Lockstep was identical over 432,000 frames.
- Evidence: `.claude/perf-lab/evidence/r2/fix/r1-koi-pose-v235/run1.md`, `run2.md`.

### Round 2 (base d0a6f41, tip 872e201)

- **Dates.** git dates the fix stage, base checkout and maps to 2026-10-22, in round 1's boot: d0a6f41 was committed at 18:57, the `perf-r2-base` worktree was created at 19:34 (its reflog), and the map ablation commits b8c22a8, 479e1e1 and d9d7225 are dated 19:00 to 19:58 EEST. The first hypotheses and triage followed before the reboot. The lab gives them no date: their results were rebuilt from the workflow journal on 2026-10-27, and the rebuilt journal holds no timestamps (`.claude/perf-lab/evidence/r2/journal-so-far.json`). Both were re-run on 2026-10-27, before the candidates: `.claude/perf-lab/evidence/r2/journal.jsonl` starts each `hyp:*` agent and `triage` twice. `round.json` holds the re-run (46 hypotheses; the first run had 43), and the re-run triage lists 5 differences from the first (`triage.notes`). The candidates were committed from 2026-10-27 19:14, and integration finished 2026-10-28 00:30. Run wf_51defea4-3e6 used 121 agents.
- **Mapped:**
  - Map A covered ascii, emission and glow with 40 switches on `perf-ablate-r2a` d9d7225. It found ascii on the pond to be launch- and export-bound.
  - Map B covered the scene with 41 switches on `perf-ablate-r2b2` 479e1e1. drawFish was 9.56 / 8.56 µs, and the fish waves set the pass length.
  - Map C covered CPU, allocation, startup and bundle at d0a6f41. CPU was about 0.060 ms per frame and allocation 17.6 KB per frame, 62% of it HeapNumber boxing from Math.hypot. Map C also found that the round-1 comment strip had broken the tool markers.
  - Evidence: `.claude/perf-lab/evidence/r2/map/a.md`, `b.md`, `c.md`.
- **Hypotheses:** 46 in 9 areas. Triage: implement 18, proposals 0, deferred 18, dropped 12. Evidence: `.claude/perf-lab/evidence/r2/round.json`.
- **Candidates:** 18 implemented and 18 measured. 11 survived and 8 were kept. Kept, in stack order: 562ba24 r2-ascii-pos-varying, a97e72f r2-ascii-ramp-uniform-select, abe91cc r2-scene-layer-split, 7579d58 r2-koi-hypot-replica, a7f61ab r2-scene-polyline-branchfree, 0521df5 r2-glow-zero-pad-emit, 14c2fcd r2-cpu-alloc-literals and 872e201 r2-bundle-glsl-indent-strip. Each scored 2 WIN / 0 LOSS in 2 runs. Three survivors were dropped at integration (see "Rejected"). Evidence: `.claude/perf-lab/evidence/r2/summary.md`, `.claude/perf-lab/evidence/r2/int/`.

### Round 3 (2026-10-28, base 872e201, tip 431e4c3)

- **Dates and run.** Run wf_bbc5376c-52f used 109 agents.
  - The round began at 00:44: the `perf-r3-base` worktree was checked out at 00:44:06 (its reflog), and map D's first perf run started at 00:44:27 (`gpu-queue.log`).
  - Maps C, D, A and B wrote their reports between 01:10 and 02:19, and the hypotheses landed between 02:26 and 02:36.
  - The candidates were committed between 02:53 and 03:36, and measuring began at 03:36.
  - The maintainer paused the run at 05:30. The machine then rebooted: the previous boot's last entry is 05:45, and the next boot started 14:27.
  - The run resumed at 18:17, and integration committed from 20:09 to 22:17.
  - Evidence: `.claude/perf-lab/evidence/r3/PAUSED.md`; directory mtimes under `.claude/perf-lab/evidence/r3/`; `.claude/perf-lab/evidence/gpu-queue.log` (gap 05:30:13 → 18:17:53); `journalctl --list-boots`.
- **Mapped:**
  - **Map A** (ascii, emission and glow; 41 switches on `perf-ablate-r3a` bbd9ff2):
    - The ascii pond costs 18.3 / 116 µs, and its fixed floor is 12.28 / about 78 µs.
    - The pass is VALU-bound, mostly on three 32-bit integer multiplies per pixel.
    - The exact float rewrite (`ascii_fmul`) recovers 2.28-2.32 / 16.9-19.5 µs.
  - **Map B** (scene and fly; 43 switches on `perf-ablate-r3b` ae2f062):
    - The scene draws are bg 14.28 and fish 5.28 at S1 MID.
    - The per-draw and whole-batch instruments rank the regions differently.
  - **Map C** (CPU, allocation, startup and bundle):
    - Allocation is 10.7 / 9.6 KB per frame, 65% of it in koi.ts boxing.
  - **Map D** (tip against main, plus the cost outside the draws):
    - WebGL's deferred drawing-buffer clear costs 37.6 µs per presented frame at S2 and 7.7 µs at S1.
  - Evidence: `.claude/perf-lab/evidence/r3/map/a.md`, `b.md`, `c.md`, `d.md`.
- **Hypotheses:** 34 in 9 areas, each area with its own list of below-noise items, 141 in total:

  | area | hypotheses | below-noise items |
  |---|---|---|
  | ascii | 6 | 12 |
  | glow-emission | 2 | 17 |
  | scene-trails | 3 | 13 |
  | scene-fish | 3 | 16 |
  | scene-water-structure | 4 | 20 |
  | ripple | 2 | 15 |
  | cpu | 6 | 13 |
  | startup-bundle | 2 | 19 |
  | architecture | 6 | 16 |

  Triage: implement 18; proposals 2 (r3-p1-max-pixel-ratio, r3-p2-glow-switch); deferred 2; dropped 25. Evidence: `.claude/perf-lab/evidence/r3/round.json` (`hypotheses`, `triage`).
- **Candidates:** 18 implemented and 17 measured: r3-startup-fbm-roll was abandoned at implementation as not pixel-exact. 11 survived, and all 11 were kept at integration with 2 WIN / 0 LOSS in 2 runs. Kept, in stack order:
  - 852b32a r3-ascii-fmul
  - 2f8d717 r3-startup-ir-diet
  - b53494f r3-cpu-hypot-nan
  - 70d0d86 r3-scene-trail-cull
  - 861cd80 r3-glow-clear-once
  - 4a95fa2 r3-ascii-ramp-float-index (ported)
  - d287d5f r3-cpu-samplebody-scratch
  - 93576c3 r3-cpu-lighting-temps
  - 3360d40 r3-cpu-lighting-memo (ported)
  - ac5eff6 r3-ascii-border-on-cell (ported)
  - 431e4c3 r3-ripple-pos-varying

  Evidence: `.claude/perf-lab/evidence/r3/summary.md`, `.claude/perf-lab/evidence/r3/int/`.

### Reboots and clock regime

- **The reboot after round 1: /tmp lost.**
  - The scratchpad was then on tmpfs under /tmp. The reboot wiped the tools and the raw outputs of round 1, integration 1 and the early round-2 stages.
  - On 2026-10-27 they were rebuilt from session transcripts and workflow journals. `.claude/perf-lab/recover/replay-log.json` records 130 writes and 8 edits replayed, plus 8 failed edits on files that no longer existed, for example `int-r1/r1-glow-branchfree-taps/run1.md` and `r1/r1-ascii-look-branch/verify-exact/verify.md`.
  - Most of the raw perf JSON was not recovered. After this the lab moved to `.claude/perf-lab` and the scratchpad became a symlink to it; every evidence directory mtime starts 2026-10-27 18:26.
  - `journalctl --list-boots` shows that the boot which ran round 1 ended 2026-10-23 00:57 EEST. Three more boots ran from 10-23 00:57 to 10-25 02:34, and work resumed in the boot that started 2026-10-26 14:38 EET. The lab notes date the /tmp loss to 2026-10-26.
- **2026-10-28, during round 3: nothing lost.**
  - The boot ended 05:45 and the next started 14:27. Round 3 had been paused at 05:30.
  - Everything was in `.claude/perf-lab`. On resume, cached agents replayed and three interrupted agents re-ran in full: verify-exact for r3-cpu-hypot-nan, verify-exact for r3-cpu-lighting-memo, and the measure of r3-startup-ir-diet.
  - Evidence: `.claude/perf-lab/evidence/r3/PAUSED.md`.
- **Clock regime.** Round 1 and integration 1 ran in the faster regime. S1 moved into the slower regime at one of the boots after round 1; which one is not recorded:
  - S1 bursts reached about 2.2-2.4 GHz before the reboot and about 1.75 GHz after it. The same code's S1 frame went from 46.4 to 61.2 µs (a session observation; no lab file backs it).
  - Measured on origin/main, as the median of the 4 standard queries: S1 frame 67.28 µs in integration 1 against 88.74 µs in round-3 map D, about x1.32. MID alone gives 67.12 against 88.48, x1.318. S2 is unchanged: 242.88 against 243.56 µs. Sources: `.claude/perf-lab/evidence/int-r1/integration.md` lines 81 and 88, `.claude/perf-lab/evidence/int-r1/final/perf1.md` line 49, `.claude/perf-lab/evidence/r3/map/d.md` lines 91-107 and 130-146.
  - The 2026-10-28 reboot did not change the regime. The smoke run after it measured 872e201's S1 MID frame at 46.92 µs, the same as map D's MID before it. Its busy sclk p50 was 1731 MHz, taken over the samples with busy above 50%.
  - Evidence: `.claude/perf-lab/evidence/r3/smoke/perf-reboot2-s1.stderr`, `.claude/perf-lab/evidence/r3/smoke/clock-reboot2-s1.tsv`.
  - So the round-1 absolute µs are lower than they would be in rounds 2 and 3. All verdicts use in-run base/head deltas, which the regime does not affect.

### Why the loop stopped

The maintainer capped the exploration at three rounds. Round 3's triage notes call it "the last round" (`.claude/perf-lab/evidence/r3/round.json`, `triage.notes`). The loop was still finding wins when it stopped. Round 3 kept 11 of 18 candidates, as many as any earlier round, including the largest per-pass gain of round 3: r3-ascii-fmul, S2 NIGHT ascii 117.40 → 97.52 µs (-19.88, threshold 4.00) at the measure stage, and S2 MID 115.88 → 96.72 µs at integration (Perf changes row 20). The PR's largest per-pass gain is round 1's r1-ascii-float-celldiv (S2 NIGHT ascii 208.96 → 154.68 µs, row 1). Round 3's triage still had 2 deferred items, 2 proposals and 25 dropped groups. Several dropped groups were dropped because no tooling round was left, such as r2-cpu-pack-skip. Evidence: `.claude/perf-lab/evidence/r3/summary.md`.
