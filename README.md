# DQA-ARC

Deadline- and Quality-Aware Application-State Retention Control (DQA-ARC) is an MQTT 5 application-layer mechanism for retaining bounded request state until correlated LLM completion or expiry. MQTT PUBACK remains a protocol-delivery acknowledgment; application completion is carried as a separate MQTT message using Response Topic and Correlation Data.

This repository contains the executable controller, traffic generators, LLM profiling code, 240-item task corpus, 310 selected live Mosquitto--LLM runs, 10,800 profile observations, 9,800 empirical replay runs, aggregate analyses, exact paired tests, publication figures, and the compiled journal manuscript.

## Main findings

- Under stationary Poisson traffic, guarded control increases correct on-time goodput from 2.590 to 2.655 results/s relative to fixed--3 (exact paired $p=0.0234$), with more blocking and less expiry.
- The five-point sweep finds no significant guarded advantage over the best fixed deadline under stationary Poisson traffic.
- During a simultaneous 2-to-6 requests/s rate change and Qwen2.5--3B to 7B service change, guarded control lowers blocking by 9.61 percentage points, lowers expiry by 3.31 points, and increases goodput by 0.317/s.
- DQA-ARC has lower blocking than occupancy-threshold admission (B1), static class reservation (B2), and combined threshold/reservation (B3) under Poisson, MMPP, and rate/model drift (all exact paired $p=0.00195$).
- Under drift, DQA-ARC gains 0.527 correct on-time results/s over B1 and 1.273/s over B3. Under MMPP, B1 gains 0.186/s by blocking 7.66 percentage points more traffic and nearly eliminating post-admission expiry.
- Under the evaluated MMPP, guarded control is worse than fixed: 1.820 versus 2.088 correct results/s ($p=0.00391$).
- Class-conditioned allocation beats static compact selection but not maximum-context or token-max selection on the live Qwen2.5--3B study.
- Token-bucket shaping nearly eliminates broker blocking under MMPP input but moves sufficient loss to the shaper that total admission utility deteriorates.

These are single-host, loopback results. The repository contains no Raspberry Pi, wireless, WAN, or external power-meter claims.

## Repository layout

```text
DQA-ARC/
|-- README.md
|-- LICENSE
|-- CITATION.cff
|-- package.json
|-- package-lock.json
|-- requirements.txt
|-- MANIFEST.sha256
|-- reproduction_instructions.md
|-- UPLOAD_TO_GITHUB.md         final URL, validation, and push checklist
|-- controller/                 live controller and journal campaign runners
|-- subscribers/                LLM profiling and configuration evaluation
|-- workloads/                  traffic generators and empirical replay
|-- calibration/                calibration/profile selection documentation
|-- datasets/                   task generator and exported 240-item corpus
|-- experiments/
|   |-- live_runs/              310 selected raw live runs
|   |-- model_profiles/         eight journal-v2 profile datasets + summaries
|   `-- replay_runs/            9,800-run replay data and aggregates
|-- baselines/                  baseline definitions and mapping to code
|-- analysis/                   analysis code and final CSV/JSON tables
|-- figures/                    publication SVG and PNG figures
|-- config/                     isolated Mosquitto configuration
|-- tests/                      deterministic core checks
`-- paper/                      self-contained LaTeX source and PDF
```

## Quick validation

Install Node.js 20 or later, then run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run analyze
npm.cmd run validate
npm.cmd run figures
```

The first two commands validate the code and deterministic task/statistics/queueing/traffic behavior. Analysis rebuilds the journal tables from the archived raw events. The artifact validator checks the 310-run campaign counts, baseline parameters, zero-error summaries, MMPP state coverage, and ten-repetition result cells before the figures are regenerated.

`MANIFEST.sha256` records the SHA-256 digest of every packaged file at release time.

See [reproduction_instructions.md](reproduction_instructions.md) for environment setup and the complete experiment commands.
See [UPLOAD_TO_GITHUB.md](UPLOAD_TO_GITHUB.md) for the final URL, license, validation, and publishing checklist.

## Primary result files

- `analysis/results/journal_live_aggregate.csv`: means and 95% intervals for all selected live conditions.
- `analysis/results/journal_live_paired_exact.csv`: paired differences and two-sided exact sign-flip tests.
- `analysis/results/standard_baseline_aggregate.csv`: DQA-ARC/B1/B2/B3 means and 95% intervals.
- `analysis/results/standard_baseline_class_aggregate.csv`: GPU- and CPU-preferred class outcomes.
- `analysis/results/standard_baseline_paired_exact.csv`: exact paired conventional-baseline comparisons.
- `analysis/results/heldout_quality_strategies.csv`: four-model held-out strategy results and exact McNemar comparisons.
- `experiments/replay_runs/empirical_replay_aggregate.csv`: replay means and 95% intervals.
- `analysis/results/journal_analysis.json`: machine-readable consolidated analysis.
- `figures/fig_j7_standard_baselines.png`: three-panel conventional-baseline comparison.
- `paper/main.pdf`: compiled 13-page journal paper.

Original run metadata preserves the collection-machine paths recorded at experiment time. Analysis uses repository-relative locations and does not depend on those archived absolute path strings.


## Artifact URL and license

The DQA-ARC research artifact is hosted at:

https://github.com/Mi12Mi12Cu/DQA-ARC

The repository contains the implementation, experimental data, analysis scripts, publication figures, and journal manuscript.

The repository is currently private and accessible only to authorized collaborators. Public access will be enabled following approval by the authors and in accordance with the target journal's artifact-availability requirements.

The included LICENSE file defines the current usage restrictions. An open-source software license and, where appropriate, a separate dataset license may be selected before public release.
