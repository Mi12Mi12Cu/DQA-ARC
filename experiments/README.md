# Experiment data

- `live_runs/` contains exactly the 220 journal-selected live runs: 100 main, 40 balanced allocator, 60 deadline-sweep, and 20 drift runs. Each directory contains `summary.json`, events, control epochs, resource samples, and the Mosquitto log.
- `model_profiles/` contains the eight journal-v2 raw profile datasets used by the four-model analysis and their CSV/JSON summaries.
- `replay_runs/` contains 9,800 individual replay rows, aggregate confidence intervals, and replay metadata.

Earlier pilot, smoke, order-confounded allocator, and superseded profile runs are intentionally excluded from this repository package.
