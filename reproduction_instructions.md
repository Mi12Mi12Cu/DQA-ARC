# Reproduction instructions

Run all commands from the repository root. The archived results can be reanalyzed without Mosquitto, Ollama, or a GPU; only Node.js and the npm dependencies are needed for that path.

## 1. Install dependencies

Requirements:

- Node.js 20 or later (recorded: 24.22.1)
- Mosquitto 2.1.2 for live runs
- Ollama 0.40.14 for profiling and live inference
- Qwen2.5--1.5B/3B/7B and Llama~3.1--8B for the complete profile campaign
- MiKTeX or TeX Live with IEEEtran for paper compilation

```powershell
npm.cmd ci
npm.cmd test
```

The live runner expects Mosquitto at `C:\Program Files\mosquitto\mosquitto.exe` by default. Pass `--mosquitto <path>` to `controller/run_live_experiment.mjs` when installed elsewhere.

## 2. Start the inference endpoints

The ordinary Ollama service at `http://127.0.0.1:11434` supplies the GPU-capable endpoint. Start a CPU-only endpoint in a second PowerShell process:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11435"
$env:CUDA_VISIBLE_DEVICES = "-1"
$env:OLLAMA_LLM_LIBRARY = "cpu_avx2"
ollama serve
```

Pull the models before profiling:

```powershell
ollama pull qwen2.5:1.5b
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
ollama pull llama3.1:8b
```

## 3. Export the deterministic task corpus

```powershell
npm.cmd run tasks:export
```

This verifies and writes the balanced 240-item corpus in `datasets/`.

## 4. Generate profiles

```powershell
npm.cmd run profile:journal
```

The campaign writes raw JSONL observations and CSV/JSON summaries to `experiments/model_profiles/`. The archived journal-v2 files are already present. The controller's primary calibration file is:

```text
experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
```

## 5. Execute the live campaign

Each run starts an isolated Mosquitto process on loopback port 18884. The campaign runner is resumable and skips only an exact matching completed configuration.

```powershell
node controller/run_journal_campaign.mjs --phase main --duration 120 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
node controller/run_journal_campaign.mjs --phase allocator --duration 60 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
node controller/run_journal_campaign.mjs --phase sweep --duration 60 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
node controller/run_journal_campaign.mjs --phase drift --duration 60 --best-fixed-deadline 8 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
node controller/run_journal_campaign.mjs --phase standard-main --duration 120 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
node controller/run_journal_campaign.mjs --phase standard-drift --duration 60 --profile experiments/model_profiles/profile_both_calibration_20261109T031430Z.jsonl
```

The phases contain 100 main runs, 40 balanced allocator runs, 60 deadline-sweep runs, 20 model-service-drift runs, and 90 conventional-baseline runs. The baseline study fixes capacity at 8, the B1/B3 occupancy threshold at 6, the B2/B3 CPU-priority reservation at 2 slots, and the application deadline at 8 seconds. New run directories are written to `experiments/live_runs/`.

## 6. Execute empirical replay

```powershell
npm.cmd run simulate
```

Replay resamples the measured calibration service distributions and held-out correctness outcomes. It writes 9,800 individual run rows, aggregate confidence intervals, and metadata to `experiments/replay_runs/`.

## 7. Rebuild analysis and figures

```powershell
npm.cmd run analyze
npm.cmd run validate
npm.cmd run figures
```

Analysis writes the aggregate live table, class-specific outcomes, exact paired comparisons, conventional-baseline tables, held-out quality strategies, and consolidated JSON to `analysis/results/`. Figures are written to `figures/` as SVG and PNG.

The archived conventional-baseline directories use short names such as `std_mmpp_b3_s601` to avoid Windows path-length failures. The complete campaign and policy names remain recorded in each run's `summary.json`.

## 8. Compile the paper

From `paper/`:

```powershell
pdflatex -interaction=nonstopmode -halt-on-error main.tex
bibtex main
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

Hardware, model-runtime, and background-load differences will change absolute latency and may change configuration selection. Preserve the disclosed seeds and paired schedules when comparing policies.
