import crypto from "node:crypto";
import { discover } from "./adapters.js";
import { db, config, checkpoint, progress } from "./db.js";
import { jobKey, scoreJob, sponsorship } from "./logic.js";

const owner = crypto.randomUUID();
const tx = (operation) => db.transaction(operation)();
const dateKey = (value) => {
  if (!value) return null;
  const parsed = new Date(value.endsWith?.("Z") ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

export function isWithinSearchWindow(postedAt, searchFrom, searchTo) {
  const posted = dateKey(postedAt);
  if (!posted) return true;
  const from = dateKey(searchFrom);
  const to = dateKey(searchTo);
  return (!from || posted >= from) && (!to || posted <= to);
}

export function start(force = false) {
  const active = db.prepare(
    "SELECT id FROM runs WHERE status IN ('running','paused','interrupted') ORDER BY id DESC LIMIT 1"
  ).get();
  if (active && !force) throw Error(`Unfinished run ${active.id}. Use CONTINUE.`);

  const resume = db.prepare("SELECT * FROM resumes ORDER BY id DESC LIMIT 1").get();
  if (!resume) throw Error("Upload a resume first");

  const companies = db.prepare(
    "SELECT * FROM companies WHERE enabled=1 ORDER BY position"
  ).all();
  if (!companies.length) throw Error("Add companies first");

  const searchTo = new Date().toISOString();
  let id;
  tx(() => {
    const info = db.prepare(
      "INSERT INTO runs(resume_id,config,owner,heartbeat_at) VALUES(?,?,?,CURRENT_TIMESTAMP)"
    ).run(resume.id, JSON.stringify(config()), owner);
    id = info.lastInsertRowid;

    const previousSearch = db.prepare(
      "SELECT MAX(ended_at) last_search FROM company_runs WHERE company_id=? AND status='completed'"
    );
    const insert = db.prepare(
      "INSERT INTO company_runs(run_id,company_id,position,name,url,search_from,search_to) VALUES(?,?,?,?,?,?,?)"
    );

    for (const company of companies) {
      const searchFrom = previousSearch.get(company.id)?.last_search || null;
      insert.run(
        id,
        company.id,
        company.position,
        company.name,
        company.url,
        searchFrom,
        searchTo
      );
    }
    checkpoint(id, null, "created");
  });
  return Number(id);
}

export function continueRun() {
  const run = db.prepare(
    "SELECT * FROM runs WHERE status IN ('running','paused','interrupted') ORDER BY id DESC LIMIT 1"
  ).get();
  if (!run) throw Error("No unfinished run");
  if (
    run.owner &&
    run.owner !== owner &&
    run.status === "running" &&
    run.heartbeat_at &&
    Date.now() - Date.parse(run.heartbeat_at + "Z") < 60000
  ) {
    throw Error("Another active session owns this run");
  }
  db.prepare(
    "UPDATE runs SET status='running',owner=?,heartbeat_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(owner, run.id);
  return run.id;
}

export function pause(id) {
  db.prepare(
    "UPDATE runs SET status='paused',owner=NULL,checkpoint_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(id);
}

function markProcessed(runId, companyId, url, stage) {
  tx(() => {
    db.prepare(
      "INSERT OR IGNORE INTO discovered_urls(run_id,company_id,url) VALUES(?,?,?)"
    ).run(runId, companyId, url);
    db.prepare(
      "UPDATE discovered_urls SET processed=1 WHERE run_id=? AND company_id=? AND url=?"
    ).run(runId, companyId, url);
    checkpoint(runId, companyId, stage, url);
  });
}

export function processJob(runId, companyRun, job) {
  const run = db.prepare("SELECT * FROM runs WHERE id=?").get(runId);
  const resume = db.prepare("SELECT * FROM resumes WHERE id=?").get(run.resume_id);
  const analysis = db.prepare(
    "SELECT * FROM resume_analysis WHERE resume_id=?"
  ).get(run.resume_id);
  const searchConfig = JSON.parse(run.config);
  const key = jobKey(job);
  const sponsorshipResult = sponsorship(job.description);
  const match = scoreJob(
    job,
    resume.text,
    { skills: JSON.parse(analysis?.skills || "[]") },
    searchConfig
  );

  let reason = null;
  if (!job.description) reason = "Missing job description";
  else if (
    ["Sponsorship Unavailable", "Work Authorization Restricted"].includes(sponsorshipResult.status) &&
    searchConfig.visa !== "ignore"
  ) reason = sponsorshipResult.status;
  else if (
    searchConfig.visa === "confirmed-only" &&
    sponsorshipResult.status !== "Sponsorship Available"
  ) reason = "Sponsorship not confirmed";
  else if (
    searchConfig.excludedRoles?.some((role) =>
      job.title.toLowerCase().includes(role.toLowerCase())
    )
  ) reason = "Excluded role";
  else if (
    searchConfig.targetRoles?.length &&
    !searchConfig.targetRoles.some((role) =>
      job.title.toLowerCase().includes(role.toLowerCase()) ||
      role.toLowerCase().includes(job.title.toLowerCase())
    )
  ) reason = "Outside target roles";
  else if (
    job.required_years &&
    searchConfig.maxExperience != null &&
    Number(job.required_years) > Number(searchConfig.maxExperience)
  ) reason = "Experience requirement";
  else if (
    job.required_years &&
    searchConfig.minExperience != null &&
    Number(job.required_years) < Number(searchConfig.minExperience)
  ) reason = "Experience requirement";
  else if (
    searchConfig.locations?.length &&
    !searchConfig.locations.some((location) =>
      job.location.toLowerCase().includes(location.toLowerCase())
    ) &&
    !/remote/i.test(job.location)
  ) reason = "Location";
  else if (match.score < (searchConfig.minScore || 0)) reason = "Score below minimum";

  tx(() => {
    db.prepare(
      "INSERT OR IGNORE INTO discovered_urls(run_id,company_id,url) VALUES(?,?,?)"
    ).run(runId, companyRun.company_id, job.url);

    if (reason) {
      db.prepare(
        "INSERT OR IGNORE INTO excluded_jobs(run_id,company_id,job_key,title,url,reason) VALUES(?,?,?,?,?,?)"
      ).run(runId, companyRun.company_id, key, job.title, job.url, reason);
    } else {
      db.prepare(
        `INSERT INTO jobs(company_id,job_key,title,location,url,apply_url,description,req_id,posted_at,salary,employment_type,work_mode,required_years,sponsorship,sponsorship_quote)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(company_id,job_key) DO UPDATE SET
           title=excluded.title,location=excluded.location,description=excluded.description,
           last_seen_at=CURRENT_TIMESTAMP,sponsorship=excluded.sponsorship,
           sponsorship_quote=excluded.sponsorship_quote`
      ).run(
        companyRun.company_id,
        key,
        job.title,
        job.location,
        job.url,
        job.apply_url || job.url,
        job.description,
        job.req_id || null,
        job.posted_at || null,
        job.salary || null,
        job.employment_type || null,
        job.work_mode || null,
        job.required_years || null,
        sponsorshipResult.status,
        sponsorshipResult.quote
      );
      const saved = db.prepare(
        "SELECT id FROM jobs WHERE company_id=? AND job_key=?"
      ).get(companyRun.company_id, key);
      db.prepare(
        "INSERT OR REPLACE INTO job_results(run_id,job_id,outcome,score,details) VALUES(?,?,'matched',?,?)"
      ).run(runId, saved.id, match.score, JSON.stringify(match));
      db.prepare("INSERT OR IGNORE INTO applications(job_id) VALUES(?)").run(saved.id);
    }

    db.prepare(
      "UPDATE discovered_urls SET processed=1 WHERE run_id=? AND company_id=? AND url=?"
    ).run(runId, companyRun.company_id, job.url);
    checkpoint(runId, companyRun.company_id, "job", job.url);
  });
}

export async function processRun(id, { limit = Infinity, discoverFn = discover } = {}) {
  let done = 0;
  while (done < limit) {
    const run = db.prepare("SELECT * FROM runs WHERE id=?").get(id);
    if (!run || run.status !== "running") break;

    const companyRun = db.prepare(
      "SELECT * FROM company_runs WHERE run_id=? AND status IN ('pending','searching') ORDER BY position LIMIT 1"
    ).get(id);
    if (!companyRun) {
      db.prepare(
        "UPDATE runs SET status='completed',ended_at=CURRENT_TIMESTAMP,owner=NULL,checkpoint_at=CURRENT_TIMESTAMP WHERE id=?"
      ).run(id);
      break;
    }

    db.prepare(
      "UPDATE company_runs SET status='searching',stage='discovering',started_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE id=?"
    ).run(companyRun.id);
    checkpoint(id, companyRun.company_id, "discovering");

    try {
      if (!companyRun.url) throw Error("Official careers URL missing; verification required");
      const found = await discoverFn(companyRun.url);
      db.prepare("UPDATE company_runs SET stage='processing' WHERE id=?").run(companyRun.id);
      checkpoint(id, companyRun.company_id, "processing");

      for (const job of found) {
        const existing = db.prepare(
          "SELECT processed FROM discovered_urls WHERE run_id=? AND company_id=? AND url=?"
        ).get(id, companyRun.company_id, job.url);
        if (existing?.processed) continue;
        if (!isWithinSearchWindow(job.posted_at, companyRun.search_from, companyRun.search_to)) {
          markProcessed(id, companyRun.company_id, job.url, "outside-date-window");
          continue;
        }
        processJob(id, companyRun, job);
      }

      tx(() => {
        db.prepare(
          "UPDATE company_runs SET status='completed',stage='done',ended_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?"
        ).run(companyRun.id);
        checkpoint(id, companyRun.company_id, "done");
      });
    } catch (error) {
      tx(() => {
        db.prepare(
          "UPDATE company_runs SET status='failed',stage='failed',error=?,ended_at=CURRENT_TIMESTAMP WHERE id=?"
        ).run(String(error.message), companyRun.id);
        db.prepare(
          "INSERT INTO logs(run_id,company_id,level,message) VALUES(?,?,'error',?)"
        ).run(id, companyRun.company_id, String(error.stack || error));
        checkpoint(id, companyRun.company_id, "failed");
      });
    }
    done++;
  }
  return progress(id);
}

export function retryFailed(id) {
  db.prepare(
    "UPDATE company_runs SET status='pending',stage='pending',error=NULL WHERE run_id=? AND status IN ('failed','blocked')"
  ).run(id);
  db.prepare(
    "UPDATE runs SET status='running',owner=?,ended_at=NULL WHERE id=?"
  ).run(owner, id);
}
