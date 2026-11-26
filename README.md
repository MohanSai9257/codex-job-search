# Local Job Search

A local React dashboard and SQLite-backed sequential job search. No API key or cloud database is required. The job board adapters use public Greenhouse, Lever, and SmartRecruiters feeds. Other platforms need a new authorized adapter; failed sites are reported honestly.

## Run locally

Requires Node.js 20+.

```bash
git clone YOUR_REPOSITORY_URL
cd codex-job-search
npm install
npm run verify
npm run dev
```

Open http://127.0.0.1:5173. The app creates `data/jobs.sqlite` automatically. Uploaded résumés and Excel files remain local under `data/` and are excluded from Git.

Upload a PDF, DOCX, or TXT resume. Review detected roles, set preferences, import companies, and add verified official board URLs. A company without an official board URL will fail visibly. Use the Settings buttons or `npm run cli -- START`, `CONTINUE`, `STATUS`, `PAUSE`, or `'RETRY FAILED'`. A new completed run leaves old results and application notes intact. Run `npm test` and `npm run build` to verify the project.

## Use with an AI coding agent

The repository includes instructions for both Codex/OpenAI agents (`AGENTS.md` and `skill/job-search/SKILL.md`) and Claude Code (`CLAUDE.md`). Give the agent the cloned repository and ask it to read the applicable instruction file, install dependencies, and run the dashboard locally.

Codex users can install the reusable skill with:

```bash
npm run install:skill
```

Then invoke `$job-search START`, `$job-search CONTINUE`, `$job-search STATUS`, or ask Codex to use the job-search skill. The dashboard and CLI use the same SQLite database. Saved checkpoints allow `CONTINUE` to resume after interruption.

## Excel company list

Upload an `.xlsx` or `.xls` file in Settings. The first sheet should contain `Company` (or `Company Name`) and `Careers URL` columns. Row order is preserved. Company names in the Companies view link to those career pages.

Use `./scripts-backup.sh` to create a SQLite backup. Stop the app and run `./scripts-restore.sh backups/<file>.sqlite` to restore. The API binds to 127.0.0.1. Resume and job descriptions may be sent through an AI model service if you explicitly ask an agent to analyze them. The local deterministic match score is an estimate, not an employer ATS score. No application is submitted automatically.

## Current coverage

Greenhouse, Lever, and SmartRecruiters public feeds are implemented. Workday, iCIMS, Oracle, SAP SuccessFactors, Phenom, and custom sites require board-specific access and are marked failed until an authorized adapter is available. The dashboard currently supports basic job filtering and export. Job closure verification and fully automated official URL discovery need source-specific adapters. These limits prevent fabricated results.
