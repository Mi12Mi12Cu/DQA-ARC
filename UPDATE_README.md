# DQA-ARC incremental GitHub update

This folder contains only the files that must be added to or replaced in the existing DQA-ARC GitHub repository. It does not duplicate the original repository.

## Merge procedure

1. Open this update folder and your existing DQA-ARC repository side by side.
2. Copy every item from this folder into the root of the existing repository.
3. Preserve the directory structure and allow replacement of files with the same names.
4. Do not delete the existing `experiments/live_runs/` contents. The 212 directories in this update are additions.
5. Commit and push the merged repository.

After merging, `experiments/live_runs/` should contain 522 directories: the previous 310 selected runs, 120 FIFO/threshold experiment runs, and 92 design-stage runs represented in the exclusion audit.

## Code additions and replacements

- `controller/lib/admission.mjs`: FIFO admission and conventional-policy handling.
- `controller/run_journal_campaign.mjs`: `theta-main`, `theta-drift`, `fifo-main`, and `fifo-drift` phases with complete-run matching.
- `analysis/analyze_journal_results.mjs`: FIFO comparisons, B1 sensitivity, Holm adjustment, class results, and full run audit.
- `analysis/generate_journal_figures.mjs`: updated conventional-baseline figure and B1 sensitivity figure.
- `analysis/validate_professor_experiments.mjs`: validates 15 cells and 150 evidence runs.
- `tests/test_core.mjs`: FIFO admission tests.
- `analysis/build_single_file_manuscript.mjs` and `analysis/render_manuscript_preview.mjs`: paper packaging and preview utilities.
- `package.json`: adds the validation and single-file paper scripts.

## Results and artifacts

- `analysis/results/`: all final aggregate, paired-test, class-specific, sensitivity, and audit files.
- `experiments/live_runs/`: 212 directories that are absent from the previous 310-run repository package.
- `figures/`: updated Figure 7 and new Figure 8 in PNG and SVG formats.
- `paper/`: final self-contained `main.tex`, bibliography, figures, evidence tables, and compiled PDF.
- `raw_run_update_index.csv`: classification and original path of every raw directory supplied here.
- `UPDATE_MANIFEST.sha256`: SHA-256 digest list for the incremental package before it is merged.

## Validation after merging

From the merged repository root, run:

```text
npm.cmd ci
npm.cmd test
npm.cmd run validate:professor
npm.cmd run analyze
npm.cmd run figures
npm.cmd run manifest
```

Run `npm.cmd run manifest` last so the repository-level `MANIFEST.sha256` covers both the existing files and this update.

Expected professor-experiment validation:

```json
{
  "expectedCells": 15,
  "validatedRuns": 150,
  "b1ThresholdRuns": 120,
  "fifoRuns": 30,
  "status": "validated"
}
```

The complete analysis should select 430 of 522 executed runs and account for 92 exclusions without outcome-based filtering.
