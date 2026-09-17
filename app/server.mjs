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
// Таблица прописана прямо в коде, чтобы на хостинге не заводить переменные.
// Переменные окружения, если заданы, перебивают. Ключ DeepSeek так не храним:
// репозиторий публичный, а ключ — это деньги.
// Метка версии, чтобы по /api/sheets-check было видно, что хостинг подтянул свежий код.
const VERSION = "2026-09-17-sheets";
const SHEETS_URL = process.env.SHEETS_URL ??
  "https://script.google.com/macros/s/AKfycbxb59Tktz2jnSCJxOCVEhS0qsrWIADKKbHUU7gEUbtMDGZqXW98FMfr9-DI0Wh9GOB0Kg/exec";
const SHEETS_SECRET = process.env.SHEETS_SECRET ?? "Snm081105";
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

// Не больше 5 писем в час с одного адреса и 80 в сутки на всех (лимит Gmail — 100).
const mailLog = new Map();
let mailDay = { day: "", n: 0 };
function mailAllowed(ip) {
  const now = Date.now(), day = new Date().toISOString().slice(0, 10);
  if (mailDay.day !== day) mailDay = { day, n: 0 };
  if (mailDay.n >= 80) return false;
  const recent = (mailLog.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= 5) return false;
  recent.push(now); mailLog.set(ip, recent); mailDay.n++;
  return true;
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

  // Отправка карты на почту — через тот же скрипт Google (MailApp).
  // Ограничение частоты: сервер не должен превращаться в рассылку спама.
  if (url.pathname === "/api/mail" && req.method === "POST") {
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": MIME[".json"] }); res.end(JSON.stringify(obj)); };
    let body;
    try { body = await readBody(req); } catch { return json(400, { ok: false, error: "Некорректный запрос" }); }
    const to = String(body?.to || "").trim(), text = String(body?.text || "");
    const pdf = typeof body?.pdf === "string" && /^[A-Za-z0-9+/=]*$/.test(body.pdf) && body.pdf.length < 12_000_000 ? body.pdf : "";
    const filename = String(body?.filename || "karta.pdf").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to) || to.length > 200) return json(400, { ok: false, error: "Проверьте адрес почты." });
    if (!text || text.length > 60000) return json(400, { ok: false, error: "Нечего отправлять" });
    if (!SHEETS_URL) return json(503, { ok: false, error: "Отправка почты не настроена." });
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (!mailAllowed(ip)) return json(429, { ok: false, error: "Слишком много писем подряд. Попробуйте через час." });
    try {
      const r = await fetch(SHEETS_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: SHEETS_SECRET, action: "mail", to, subject: "Теория парадоксов — ваша карта", body: text, pdf, filename }),
        signal: AbortSignal.timeout(45000),
      });
      const out = JSON.parse(await r.text());
      if (!out.ok) console.error("[mail] скрипт ответил:", out.error);
      return json(out.ok ? 200 : 502, out.ok ? { ok: true } : { ok: false, error: "Не получилось отправить. Попробуйте чуть позже." });
    } catch (e) {
      console.error("[mail] нет связи:", e?.message || e);
      return json(502, { ok: false, error: "Не получилось отправить. Попробуйте чуть позже." });
    }
  }

  // Копия PDF карты — в папку на Google Диске владельца скрипта, ссылка — в строку разбора.
  if (url.pathname === "/api/pdf-store" && req.method === "POST") {
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": MIME[".json"] }); res.end(JSON.stringify(obj)); };
    let body;
    try { body = await readBody(req); } catch { return json(400, { ok: false }); }
    const id = String(body?.id || ""), pdf = String(body?.pdf || "");
    if (!/^[\w-]{6,80}$/.test(id) || !pdf || pdf.length > 12_000_000 || !/^[A-Za-z0-9+/=]+$/.test(pdf)) return json(400, { ok: false });
    if (!SHEETS_URL) return json(204, { ok: false });
    try {
      const r = await fetch(SHEETS_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: SHEETS_SECRET, action: "store_pdf", id, pdf,
          filename: String(body?.filename || "karta.pdf").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) }),
        signal: AbortSignal.timeout(60000),
      });
      const out = JSON.parse(await r.text());
      if (!out.ok) console.error("[pdf-store] скрипт ответил:", out.error);
      return json(out.ok ? 200 : 502, { ok: Boolean(out.ok) });
    } catch (e) {
      console.error("[pdf-store] нет связи:", e?.message || e);
      return json(502, { ok: false });
    }
  }

  // Самопроверка связи с таблицей: открыть в браузере /api/sheets-check.
  // Ничего не пишет — только спрашивает скрипт «ты жив?».
  if (url.pathname === "/api/sheets-check") {
    const out = { version: VERSION, configured: Boolean(SHEETS_URL), reachable: false, answer: null, error: null };
    if (SHEETS_URL) {
      try {
        const r = await fetch(SHEETS_URL, { signal: AbortSignal.timeout(45000) });
        const text = await r.text();
        out.answer = text.slice(0, 120);
        out.reachable = r.ok && text.includes('"ok":true');
      } catch (e) { out.error = String(e?.cause?.code || e?.message || e); }
    }
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify(out, null, 2));
  }

  // Запись разбора в Google-таблицу. Адрес скрипта и пароль живут только на сервере,
  // поэтому браузер шлёт сюда, а не в Google напрямую. Не задан SHEETS_URL — тихо ничего не делаем.
  if (url.pathname === "/api/record" && req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch { res.writeHead(400); return res.end("bad json"); }
    const record = body?.record;
    if (!record?.id || JSON.stringify(record).length > 300000) { res.writeHead(400); return res.end("bad record"); }
    if (!SHEETS_URL) { res.writeHead(204); return res.end(); }
    // Скрипт Google после простоя просыпается 10–30 секунд — ждём долго и пробуем дважды.
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const r = await fetch(SHEETS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: SHEETS_SECRET, record }),
          signal: AbortSignal.timeout(45000),
        });
        const text = await r.text();
        try { ok = r.ok && JSON.parse(text).ok === true; } catch { ok = false; }
        if (!ok) console.error(`[sheets] запись не прошла (попытка ${attempt}): ${r.status} ${text.slice(0, 200)}`);
      } catch (e) {
        console.error(`[sheets] нет связи (попытка ${attempt}):`, e?.cause?.code || e?.message || e);
      }
    }
    res.writeHead(ok ? 200 : 502, { "Content-Type": MIME[".json"] });
    return res.end(JSON.stringify({ ok }));
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
        await new Promise(r => setTimeout(r, 1400));
        send("done", { data: mockStep(body.step, body.ctx), demo: true });
      } else {
        const out = await runStep(body.step, body.ctx);
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
  console.log(`\n  Теория парадоксов — http://localhost:${PORT}`);
  if (hasKey) {
    console.log(`  Режим: живой агент — ${providerInfo.label} · ${providerInfo.model}` +
      (providerInfo.proxied ? " (через свой шлюз)" : ""));
    console.log("");
  } else {
    console.log("  Режим: ДЕМО (ключа DeepSeek нет — сценарий проигрывается без модели)");
  }
  console.log(SHEETS_URL ? "  Ответы: пишутся в Google-таблицу" : "  Ответы: в таблицу не пишутся (SHEETS_URL не задан)");
  console.log(ACCESS_CODE
    ? `  Доступ: по коду. Ссылка для участника — <адрес>/?code=${ACCESS_CODE}\n`
    : "  🔴 Доступ ОТКРЫТ ВСЕМ. Публикуете наружу — задайте ACCESS_CODE, иначе ключ тратит любой прохожий\n");
});
