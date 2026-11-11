# Analysis

`analyze_journal_results.mjs` reads raw summaries from `experiments/live_runs/` and profile JSONL from `experiments/model_profiles/`. It writes:

- `journal_live_runs.csv`: one row per discovered live run.
- `journal_live_aggregate.csv`: means and Student-$t$ 95% half-widths.
- `journal_live_paired_exact.csv`: paired differences and two-sided exact sign-flip tests.
- `journal_live_class_runs.csv` and `journal_live_class_aggregate.csv`: class-conditioned live outcomes.
- `standard_baseline_runs.csv` and `standard_baseline_aggregate.csv`: DQA-ARC/B1/B2/B3 results.
- `standard_baseline_class_runs.csv` and `standard_baseline_class_aggregate.csv`: class-specific conventional-baseline results.
- `standard_baseline_paired_exact.csv`: paired DQA-ARC comparisons with exact sign-flip tests.
- `heldout_quality_strategies.csv`: Wilson intervals and exact McNemar comparisons.
- `journal_analysis.json`: consolidated machine-readable output, including the measured stability-slope calculation.

`generate_journal_figures.mjs` combines these tables with `experiments/replay_runs/empirical_replay_aggregate.csv` to create the publication figures.

`validate_artifact.mjs` verifies the 310-run campaign inventory, all 90 conventional-baseline runs, baseline parameters, class-count consistency, MMPP state coverage, ten-seed result cells, and GitHub file/path limits. `generate_manifest.mjs` regenerates `MANIFEST.sha256` after an intentional release change.
