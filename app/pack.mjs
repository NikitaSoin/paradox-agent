// Собирает архив для передачи другому человеку.
// Кладёт только исходники: без .env, без node_modules, без истории и логов.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, cpSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WITH_KEYS = process.argv.includes("--with-keys");
const NAME = WITH_KEYS ? "paradox-agent-with-keys" : "paradox-agent";
const stage = join(here, ".pack", NAME);
const zip = join(here, `${NAME}.zip`);

const INCLUDE = ["server.mjs", "agent.mjs", "providers.mjs", "mock.mjs", "theory.mjs",
  "test-flow.mjs", "pack.mjs", "package.json", "package-lock.json",
  "README.md", ".env.example", ".gitignore", "start.command", "start.bat",
  "kb", "public"];

rmSync(join(here, ".pack"), { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });

for (const item of INCLUDE) {
  const src = join(here, item);
  if (!existsSync(src)) { console.log(`  пропущен (нет файла): ${item}`); continue; }
  cpSync(src, join(stage, item), { recursive: true });
}

if (WITH_KEYS) {
  const env = join(here, ".env");
  if (!existsSync(env)) { console.error("Нет файла .env — нечего класть в сборку."); process.exit(1); }
  cpSync(env, join(stage, ".env"));
  writeFileSync(join(stage, "ПРОЧТИ_МЕНЯ.txt"),
    "В этом архиве лежит файл .env с рабочими ключами API.\n\n" +
    "Это значит:\n" +
    "— запросы к модели тратят бюджет владельца ключей;\n" +
    "— не выкладывайте архив в общий доступ, репозиторий или чат, где его увидят посторонние;\n" +
    "— не коммитьте .env в git (он уже в .gitignore).\n\n" +
    "Запуск: двойной клик по start.command (macOS) или start.bat (Windows).\n" +
    "Либо в терминале: npm install && npm start — затем http://localhost:5173\n", "utf8");
} else {
  // Страховка: без флага секретов в сборке быть не должно.
  const leaks = [];
  (function walk(dir, rel = "") {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e), r = rel ? rel + "/" + e : e;
      if (statSync(p).isDirectory()) { walk(p, r); continue; }
      if (e === ".env") leaks.push(r);
    }
  })(stage);
  if (leaks.length) { console.error("ОСТАНОВЛЕНО: в сборку попали секреты:", leaks); process.exit(1); }
}

execFileSync("zip", ["-rq", zip, NAME], { cwd: join(here, ".pack") });
rmSync(join(here, ".pack"), { recursive: true, force: true });

const mb = (statSync(zip).size / 1024 / 1024).toFixed(2);
console.log(`\n  Готово: ${zip}  (${mb} МБ)`);
if (WITH_KEYS) {
  console.log("\n  ⚠  ВНУТРИ ЛЕЖАТ РАБОЧИЕ КЛЮЧИ API.");
  console.log("     Получатель сможет тратить ваш бюджет. Не выкладывайте архив в общий доступ.");
  console.log("     Получателю: распаковать и запустить start.command (macOS) или start.bat (Windows).\n");
} else {
  console.log("  Внутри нет .env и node_modules — ключи не уедут.");
  console.log("  Получателю: распаковать, npm install, скопировать .env.example в .env и вписать свои ключи.\n");
}
