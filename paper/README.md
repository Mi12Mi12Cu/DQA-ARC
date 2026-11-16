# DQA-ARC journal manuscript

This folder contains the complete, self-contained LaTeX source and the evidence tables used for the admission-control comparison.

## Contents

- `main.tex`: full manuscript with every section inline; it contains no section-level `\input` directives.
- `references.bib`: 30 bibliography entries.
- `figures/`: all manuscript figures, including the FIFO/B1--B3 comparison and the four-value B1 threshold sweep.
- `results/`: aggregate results, exact paired tests, class-conditioned results, and the run-inclusion audit.
- `validation_summary.json`: experiment-cell and run-count validation.

## Build

Run the following commands from this directory:

```text
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

The supplied `main.pdf` was built with MiKTeX pdfLaTeX and BibTeX.

## Statistical scope

The manuscript analyzes 430 prespecified live runs from 522 executed runs. The audit accounts for all 92 exclusions by policy and design-stage category. The B1 sensitivity and FIFO evidence contains 150 runs across 15 cells, with ten paired seeds per cell. No run is excluded using its measured outcome.
