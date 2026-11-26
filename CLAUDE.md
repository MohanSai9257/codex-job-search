# Local job-search dashboard

Follow `AGENTS.md` as the project operating guide. Before changing or running the search, read `DEVELOPMENT_PROGRESS.md` and `skill/job-search/SKILL.md`.

For a fresh clone:

1. Run `npm install`.
2. Run `npm test` and `npm run build`.
3. Run `npm run dev` and open `http://127.0.0.1:5173`.

The app creates its local SQLite database automatically. Never commit `data/`, uploaded résumés, backups, or generated exports. Do not claim support for a job platform unless an adapter in `server/adapters.js` has been implemented and verified.

