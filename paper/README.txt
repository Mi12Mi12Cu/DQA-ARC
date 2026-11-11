Deadline- and Quality-Aware Application-State Control for MQTT--LLM Pipelines

This folder is a self-contained IEEEtran LaTeX submission package.

Contents
--------
main.tex            Main manuscript source
references.bib      BibTeX database (30 cited references)
main.bbl            Generated IEEE bibliography
sections/           Modular manuscript sections
figures/            Publication figures in PNG format
main.pdf            Compiled manuscript

The compiled paper is 13 pages and reports 310 selected live runs, including
the B1 occupancy-threshold, B2 static-reservation, and B3 combined baselines.
The machine-readable tables used by the paper are in ../analysis/results/.

Build
-----
Run these commands from this directory:

pdflatex -interaction=nonstopmode -halt-on-error main.tex
bibtex main
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex

The document uses the standard IEEEtran class and commonly available LaTeX
packages: amsmath, amssymb, booktabs, graphicx, multirow, url, xcolor, cite,
and microtype.

Before public submission, replace ANONYMIZED-ARTIFACT-URL in main.tex with the
archival repository URL. The placeholder is intentional; no repository URL is
invented by the manuscript-generation scripts.
