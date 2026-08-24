import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { mockStep } from "./mock.mjs";
import { THEORY } from "./theory.mjs";

// Читаем .env сами, а не флагом node: флаг есть не во всех версиях Node,
// и из-за него проект «не запускался у другого человека».
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));

// agent.mjs читает переменные окружения при загрузке — импортируем его после loadEnv.
const { runStep, hasKey, providerInfo } = await import("./agent.mjs");

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 18) {
  console.error(`\n  Нужен Node.js 18 или новее. Сейчас установлен ${process.versions.node}.`);
  console.error("  Скачать: https://nodejs.org\n");
  process.exit(1);
}
const PUBLIC = join(here, "public");
const PORT = Number(process.env.PORT || 5173);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function sse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Если задан ACCESS_CODE, сайт закрыт кодом. Обязателен при публикации наружу:
// иначе ключ провайдера тратит любой, кому попала ссылка.
const ACCESS_CODE = process.env.ACCESS_CODE || "";
const COOKIE = "pa_access";

function sameCode(v) {
  if (!v) return false;
  const a = Buffer.from(String(v)), b = Buffer.from(ACCESS_CODE);
  // Сравнение постоянного времени, чтобы код нельзя было подобрать по задержке.
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieCode(req) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : "";
}

// Три способа войти, потому что у них разные сценарии:
//   ?code=... — ссылка, которую можно просто переслать участнику (основной);
//   cookie    — чтобы код спрашивался один раз, а не на каждой перезагрузке;
//   Basic     — для curl и старых заготовок ссылок вида https://код@адрес.
function authorized(req, url) {
  if (!ACCESS_CODE) return true;
  if (sameCode(url.searchParams.get("code"))) return true;
  if (sameCode(cookieCode(req))) return true;
  const h = req.headers.authorization || "";
  if (h.startsWith("Basic ")) {
    const [, pass = ""] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
    if (sameCode(pass)) return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 🔴 ДО проверки кода: платформа пингует приложение, чтобы понять, живо ли оно.
  // Если на пинг отвечать 401, хостинг считает приложение упавшим и уходит в
  // перезапуск по кругу. Поэтому точка проверки живости открыта всегда и не
  // раскрывает ничего, кроме «процесс отвечает».
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("ok");
  }

  // Страница служебная и в поиске ей делать нечего — закрываем и заголовком,
  // и robots.txt: заголовок действует на любой ответ, включая API.
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (url.pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("User-agent: *\nDisallow: /\n");
  }

  if (!authorized(req, url)) {
    res.writeHead(401, {
      // Только ASCII: кириллица в значении HTTP-заголовка невалидна и роняет ответ.
      "WWW-Authenticate": 'Basic realm="Paradox map", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    });
    return res.end("Нужен код доступа");
  }

  // Код пришёл в адресе — запоминаем в cookie и убираем его из адресной строки,
  // чтобы участник не разослал ссылку с кодом дальше случайным скриншотом.
  if (ACCESS_CODE && url.searchParams.get("code")) {
    url.searchParams.delete("code");
    res.writeHead(302, {
      "Set-Cookie": `${COOKIE}=${encodeURIComponent(ACCESS_CODE)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      Location: url.pathname + (url.search || ""),
    });
    return res.end();
  }

  if (url.pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify({ live: hasKey, ...providerInfo }));
  }

  if (url.pathname === "/api/theory") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify(THEORY));
  }

  if (url.pathname === "/api/step" && req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch { res.writeHead(400); return res.end("bad json"); }

    const send = sse(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    const stop = () => clearInterval(heartbeat);
    req.on("close", stop);

    try {
      if (!hasKey) {
        // Демо-режим: сценарий проигрывается без обращения к модели.
        for (const line of ["Читаю описание ситуации…", "Сверяю с критериями парадокса…", "Подбираю оси из библиотеки…"]) {
          send("thinking", { text: line + "\n" });
          await new Promise(r => setTimeout(r, 450));
        }
        send("done", { data: mockStep(body.step, body.ctx), demo: true });
      } else {
        const out = await runStep(body.step, body.ctx, (t) => send("thinking", { text: t }), body.provider);
        send("done", { data: out.data, usage: out.usage, provider: out.provider, demo: false });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      send("error", {
        message: msg.startsWith("REFUSAL")
          ? "Модель отклонила запрос по политике безопасности. Переформулируйте описание."
          : msg,
      });
    } finally {
      stop();
      res.end();
    }
    return;
  }

  // статика
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(PUBLIC, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
  }
});

// Одиночный сбой в запросе не должен ронять сервер во время демонстрации.
process.on("uncaughtException", (e) => console.error("[uncaught]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandled]", e?.message || e));

server.listen(PORT, () => {
  console.log(`\n  Карта натяжения — http://localhost:${PORT}`);
  if (hasKey) {
    console.log(`  Режим: живой агент — ${providerInfo.label} · ${providerInfo.model}` +
      (providerInfo.proxied ? " (через свой шлюз)" : ""));
    const others = providerInfo.all.filter(p => p.id !== providerInfo.id);
    if (others.length) console.log(`  Запасной: ${others.map(p => p.label + " · " + p.model).join(", ")}` +
      "  — переключается через PROVIDER= в .env");
    console.log("");
  } else {
    console.log("  Режим: ДЕМО (ключей нет — сценарий проигрывается без модели)");
  }
  console.log(ACCESS_CODE
    ? `  Доступ: по коду. Ссылка для участника — <адрес>/?code=${ACCESS_CODE}\n`
    : "  🔴 Доступ ОТКРЫТ ВСЕМ. Публикуете наружу — задайте ACCESS_CODE, иначе ключ тратит любой прохожий\n");
});
