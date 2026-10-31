import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
if (!existsSync(".dev.vars")) {
  console.error(
    "Copy .dev.vars.example to .dev.vars, then run npm run db:migrate.",
  );
  process.exit(1);
}
if (!existsSync("dist/index.html")) {
  mkdirSync("dist", { recursive: true });
  writeFileSync(
    "dist/index.html",
    "<p>Use http://127.0.0.1:5173 for development.</p>",
  );
}
const children = ["dev:api", "dev:web"].map((script) =>
  spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32")
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}
children.forEach((child) => child.on("exit", (code) => stop(code ?? 1)));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
