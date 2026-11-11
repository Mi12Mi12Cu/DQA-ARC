# Uploading this artifact to GitHub

The repository directory is the upload unit. Extract the release ZIP first; do not commit the outer ZIP as a file inside the repository.

## Before the first public release

1. Create an empty GitHub repository without an automatically generated README, license, or `.gitignore`.
2. Replace `REPLACE-WITH-PUBLIC-REPOSITORY-URL` in `CITATION.cff` with its final URL.
3. Replace `ANONYMIZED-ARTIFACT-URL` in `paper/main.tex` with the same URL and recompile `paper/main.pdf` if the paper will expose the public artifact during review.
4. Review `LICENSE`. The packaged notice permits scholarly inspection but is not an open-source license; replace it only if all copyright holders agree on a code/data license.
5. Run the checks below from the repository root.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run analyze
npm.cmd run validate
npm.cmd run figures
npm.cmd run manifest
```

Run `npm.cmd run manifest` last so `MANIFEST.sha256` represents the files being released.

## Push with Git

```powershell
git init
git add .
git commit -m "Release DQA-ARC artifact v1.1.0"
git branch -M main
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

GitHub Desktop can be used instead: choose **Add existing repository**, select the extracted `DQA-ARC-GitHub-Repository` directory, then publish it. The artifact validator checks the 100 MiB per-file hard limit and portable relative-path lengths.

## Suggested release record

- Tag: `v1.1.0`
- Title: `DQA-ARC reproducibility artifact v1.1.0`
- Attach the outer ZIP to the GitHub Release, not to the tracked source tree.
- Record the commit hash and release URL in the final submitted manuscript.
