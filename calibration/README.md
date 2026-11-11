# Calibration

The controller converts an Erlang--B offered-load budget into a deadline by inverting the empirical truncated mean of measured completion time. It seeds each class/configuration distribution from `experiments/model_profiles/` and appends completed live jobs to a rolling window of 200 observations.

The primary two-class Qwen2.5--3B files are:

- `profile_both_calibration_20261109T031430Z.jsonl`
- `profile_both_evaluation_20261109T033230Z.jsonl`

The remaining six raw files provide calibration/evaluation GPU profiles for Qwen2.5--1.5B, Qwen2.5--7B, and Llama~3.1--8B. Calibration and held-out items are disjoint. Each raw file has an accompanying CSV and JSON summary.
