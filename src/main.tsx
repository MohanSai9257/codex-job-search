import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Moon, Sun } from "lucide-react";
import "./style.css";

type Company = { id: number; name: string; url?: string | null; last_searched_at?: string | null };
type Job = { id: number; company: string; title: string; first_seen_at?: string | null };
type State = {
  companies?: Company[];
  config?: { minExperience?: number | null; maxExperience?: number | null; visa?: string; selectedExcelId?: number };
  excels?: { id: number; filename: string; company_count: number }[];
  resume?: { filename: string } | null;
};
type SettingsDraft = {
  selectedExcelId: number | "";
  minExperience: string;
  maxExperience: string;
  visa: string;
};

const api = async (path: string, options?: RequestInit) => {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleDateString();
};

const wasSearchedToday = (value?: string | null) => {
  if (!value) return false;
  const searched = new Date(value.endsWith("Z") ? value : `${value}Z`);
  const today = new Date();
  return searched.getFullYear() === today.getFullYear() &&
    searched.getMonth() === today.getMonth() &&
    searched.getDate() === today.getDate();
};

function App() {
  const [tab, setTab] = useState("Companies");
  const [state, setState] = useState<State>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("appearance") === "dark");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);

  const refresh = async () => {
    try {
      const [nextState, nextJobs] = await Promise.all([api("/state"), api("/jobs")]);
      setState(nextState);
      setJobs(nextJobs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("appearance", dark ? "dark" : "light");
  }, [dark]);

  const openSettings = () => {
    const current = state.config || {};
    setSettingsDraft({
      selectedExcelId: current.selectedExcelId || "",
      minExperience: current.minExperience == null ? "" : String(current.minExperience),
      maxExperience: current.maxExperience == null ? "" : String(current.maxExperience),
      visa: current.visa || "exclude-restricted",
    });
    setTab("Settings");
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    try {
      await api("/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minExperience: settingsDraft.minExperience === "" ? null : Number(settingsDraft.minExperience),
          maxExperience: settingsDraft.maxExperience === "" ? null : Number(settingsDraft.maxExperience),
          visa: settingsDraft.visa,
        }),
      });
      if (
        settingsDraft.selectedExcelId &&
        settingsDraft.selectedExcelId !== state.config?.selectedExcelId
      ) {
        await api(`/excels/${settingsDraft.selectedExcelId}/select`, { method: "POST" });
      }
      setMessage("Saved");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    }
  };

  const uploadResume = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    try {
      await api("/resume", { method: "POST", body });
      setMessage("Resume uploaded");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload resume");
    }
  };

  const uploadExcel = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    try {
      const uploaded = await api("/excels", { method: "POST", body });
      setSettingsDraft((current) => current ? { ...current, selectedExcelId: uploaded.id } : current);
      setMessage("Excel uploaded. Select Save to use it.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload Excel");
    }
  };

  const config = state.config || {};

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <nav className="mx-auto flex max-w-5xl items-center gap-8 px-5" aria-label="Main navigation">
          <button className={`top-nav ${tab === "Companies" ? "active" : ""}`} onClick={() => setTab("Companies")}>Companies</button>
          <button className={`top-nav ${tab === "List" ? "active" : ""}`} onClick={() => setTab("List")}>
            <CalendarDays size={17} aria-hidden="true" /> List
          </button>
          <button className={`top-nav ${tab === "Settings" ? "active" : ""}`} onClick={openSettings}>Settings</button>
          <button className="appearance-button" onClick={() => setDark((value) => !value)}>
            {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            Appearance
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        {message && <button className="message" onClick={() => setMessage("")}>{message}</button>}

        {tab === "Companies" && (
          <SimpleTable headers={["Company Name", "Searched", "Date"]}>
            {(state.companies || []).map((company) => (
              <tr key={company.id}>
                <td>
                  {company.url ? (
                    <a className="company-link" href={company.url} target="_blank" rel="noopener noreferrer">
                      {company.name}
                    </a>
                  ) : company.name}
                </td>
                <td>
                  {wasSearchedToday(company.last_searched_at) && (
                    <span className="searched-tick" aria-label="Searched today">✓</span>
                  )}
                </td>
                <td>{formatDate(company.last_searched_at)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}

        {tab === "List" && (
          <SimpleTable headers={["Company Name", "Job", "Date"]}>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.company}</td>
                <td>{job.title}</td>
                <td>{formatDate(job.first_seen_at)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}

        {tab === "Settings" && (
          <div className="settings">
            <label className="field">
              Excel
              <select
                value={settingsDraft?.selectedExcelId ?? config.selectedExcelId ?? ""}
                onChange={(event) => setSettingsDraft((current) => current ? {
                  ...current,
                  selectedExcelId: Number(event.target.value),
                } : current)}
              >
                {(state.excels || []).map((excel) => (
                  <option key={excel.id} value={excel.id}>
                    {excel.filename}
                  </option>
                ))}
              </select>
              <input type="file" accept=".xlsx,.xls" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadExcel(file);
              }} />
            </label>

            <label className="field">
              Resume upload
              <input type="file" accept=".pdf,.docx,.txt" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadResume(file);
              }} />
              {state.resume?.filename && <span className="file-name">{state.resume.filename}</span>}
            </label>

            <div className="experience-fields">
              <label className="field">
                Min experience
                <input
                  type="number"
                  min="0"
                  placeholder="Optional"
                  value={settingsDraft?.minExperience ?? ""}
                  onChange={(event) => setSettingsDraft((current) => current ? {
                    ...current,
                    minExperience: event.target.value,
                  } : current)}
                />
              </label>
              <label className="field">
                Max experience
                <input
                  type="number"
                  min="0"
                  placeholder="Optional"
                  value={settingsDraft?.maxExperience ?? ""}
                  onChange={(event) => setSettingsDraft((current) => current ? {
                    ...current,
                    maxExperience: event.target.value,
                  } : current)}
                />
              </label>
            </div>

            <label className="field">
              Sponsorship
              <select
                value={settingsDraft?.visa ?? "exclude-restricted"}
                onChange={(event) => setSettingsDraft((current) => current ? {
                  ...current,
                  visa: event.target.value,
                } : current)}
              >
                <option value="exclude-restricted">Exclude restricted</option>
                <option value="confirmed-only">Confirmed only</option>
                <option value="ignore">Do not filter</option>
              </select>
            </label>

            <button className="save-button" onClick={saveSettings}>Save</button>
          </div>
        )}
      </main>
    </div>
  );
}

function SimpleTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
