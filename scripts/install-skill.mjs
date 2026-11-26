import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = path.resolve("skill/job-search");
const destination = path.join(os.homedir(), ".codex", "skills", "job-search");

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
console.log(`Installed the job-search skill at ${destination}`);

