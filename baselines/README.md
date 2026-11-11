# Baselines

Deadline policies are implemented in `controller/run_live_experiment.mjs`:

- `fixed`: constant application deadline.
- `analytical`: direct Erlang--B mean-budget deadline.
- `calibrated`: empirical truncated-mean inversion.
- `adaptive`: calibrated feedforward plus blocking feedback.
- `guarded`: adaptive control plus FIFO class feasibility and rerouting.

Allocation rules are also selected by the live runner:

- `static-compact`: compact--24 for every request.
- `static-max`: extended--48 for every request.
- `token-max`: largest feasible prompt-plus-output budget.
- `quality-aware`: highest calibration accuracy for each request class subject to the latency constraint.

The fixed-deadline sweep uses 1, 2, 3, 5, and 8 seconds. The drift comparison uses the sweep-selected fixed--8 baseline.

## Conventional admission-control baselines

The live runner also implements three profile-independent admission rules. With application-state capacity $n=8$, occupancy threshold $\theta=6$, and two CPU-priority guard slots:

- `occupancy-threshold` (B1): admit either preferred class only while occupancy is below 6.
- `static-reservation` (B2): admit CPU-preferred requests below occupancy 8 and GPU-preferred requests below occupancy 6.
- `threshold-reservation` (B3): admit CPU-preferred requests below occupancy 6 and GPU-preferred requests below occupancy 4.

All three use the same quality-aware inference allocator and fixed 8-second application deadline as disclosed in the paper. Run the Poisson/MMPP and rate/model-drift matrices with the `standard-main` and `standard-drift` phases described in `reproduction_instructions.md`. Admission decisions are implemented and unit-tested in `controller/lib/admission.mjs`.
