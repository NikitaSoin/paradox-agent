"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RU = { problem: "проблема", dilemma: "дилемма", paradox: "парадокс" };
const VERB = { problem: "решить", dilemma: "выбрать", paradox: "удерживать натяжение" };
const GLYPH = (t) => `<span class="glyph ${t}"><i></i><i></i></span>`;
const FLAG = { yes: "есть", partly: "частично", no: "нет", unknown: "не ясно" };
const APPR_NAME = { super: "Выход в надсистему", split: "Дробление до дилеммы или проблемы",
  space: "Разнесение в пространстве / во времени", synth: "Синтез" };
const APPR_TERM = { super: "выход в надсистему", split: "дробление", space: "разнесение", synth: "синтез" };
const FIT = { high: "подходит", medium: "с оговорками", low: "не сейчас" };

/* ----------------------------- подсказки «i» ---------------------------- */

let GLOSS = {};
const term = (t, label) => {
  const key = String(t).toLowerCase();
  if (!GLOSS[key]) return esc(label ?? t);
  return `${esc(label ?? t)}<button class="i" data-term="${esc(key)}" aria-label="Что это значит">i</button>`;
};

function closePop() { document.querySelector(".pop")?.remove(); }

function openPop(btn) {
  closePop();
  const g = GLOSS[btn.dataset.term];
  if (!g) return;
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = `<b>${esc(btn.dataset.term)}</b><p>${esc(g.short)}</p>` +
    `<button class="more" data-theory="${esc(g.anchor)}">Подробнее в теории</button>`;
  document.body.appendChild(el);
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = (window.scrollY + r.bottom + 8) + "px";
  el.style.left = Math.max(12, Math.min(window.scrollX + r.left - 8,
    window.scrollX + window.innerWidth - w - 12)) + "px";
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

/* --------------------------- тема оформления --------------------------- */

const THEME_KEY = "paradox.theme";
function themeGet() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } }
function themeSet(mode) {
  try { mode === "auto" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, mode); } catch {}
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  themePaint();
}
function themePaint() {
  const cur = themeGet();
  document.querySelectorAll("[data-theme-set]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.themeSet === cur)));
}

/* ------------------------------- история ------------------------------- */
// Хранится только в браузере (localStorage). На сервер не уходит.

const HIST_KEY = "paradox.history.v1";
const HIST_MAX = 50;

// Совместимость со старыми записями, сохранёнными до переверстки шагов.
const LEGACY_STEP = { read: "questions", refine: "readings" };
const STAGE_LABEL = {
  questions: "вопросы", readings: "прочтения", axis: "ось", decide: "решения", sheet: "карта собрана",
  read: "вопросы", refine: "прочтения",
};

function histLoad() {
  try { const v = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function histWrite(list) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX))); }
  catch {
    // Переполнение хранилища — выкидываем самые старые записи и пробуем ещё раз.
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 10))); } catch {}
  }
  histBadge();
}
function histBadge() {
  const el = $("#histCount"); if (!el) return;
  const n = histLoad().length;
  el.textContent = String(n); el.hidden = n === 0;
}
/** Создаёт или обновляет запись текущего прогона. stage — это S.step на момент вызова. */
function histUpsert(stage) {
  if (!S.runId || !S.read) return;
  const list = histLoad();
  const i = list.findIndex(e => e.id === S.runId);
  const entry = {
    id: S.runId,
    at: i >= 0 ? list[i].at : Date.now(),
    updated: Date.now(),
    stage,
    demo: !S.live,
    situation: S.situation,
    restated: S.read.restated,
    guess: S.refine?.hypothesis?.type || null,
    chosenType: S.chosenType,
    axisIndex: S.axisIndex, positions: S.positions,
    axisName: S.refine?.axes?.length
      ? S.refine.axes.map(a => `${a.a} — ${a.b}`).join(" · ") : null,
    approachId: S.approachId, firstStep: S.firstStep,
    answers: S.answers, free: S.free, extra: S.extra,
    read: S.read, refine: S.refine, decide: S.decide,
  };
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  list.sort((a, b) => b.updated - a.updated);
  histWrite(list);
}
function histDelete(id) { histWrite(histLoad().filter(e => e.id !== id)); }
function histClear() { try { localStorage.removeItem(HIST_KEY); } catch {} histBadge(); }
function histOpen(id) {
  const e = histLoad().find(x => x.id === id);
  if (!e) return;
  const step = LEGACY_STEP[e.stage] || e.stage || "questions";
  Object.assign(S, {
    runId: e.id, situation: e.situation, read: e.read, refine: e.refine, decide: e.decide,
    answers: e.answers || {}, free: e.free || {}, extra: e.extra || "", chosenType: e.chosenType, axisIndex: e.axisIndex ?? 0,
    positions: e.positions || (e.position != null ? [e.position] : (e.refine?.axes || []).map(a => a.position?.value ?? 50)),
    approachId: e.approachId, firstStep: e.firstStep || "",
    step, error: null, busy: false, decideRequested: Boolean(e.decide),
  });
  view = "diag"; render(); window.scrollTo({ top: 0 });
}

const PROV_KEY = "paradox.provider";

const S = {
  live: false, provider: null, providers: [], step: "input", situation: "", runId: null,
  read: null, answers: {}, free: {}, extra: "", refine: null,
  chosenType: null, axisIndex: 0, positions: [], decideRequested: false,
  decide: null, approachId: null, firstStep: "", error: null, busy: false, savedNote: null,
};

/* ------------------------------- транспорт ------------------------------- */

function callStep(step, ctx, onThinking) {
  return new Promise((resolve, reject) => {
    fetch("/api/step", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, ctx, provider: S.provider }),
    }).then(async (res) => {
      if (!res.ok || !res.body) return reject(new Error("Сервер вернул " + res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const chunk of parts) {
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const dm = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!ev || !dm) continue;
          const data = JSON.parse(dm);
          if (ev === "thinking") onThinking?.(data.text);
          else if (ev === "done") resolve(data);
          else if (ev === "error") reject(new Error(data.message));
        }
      }
      reject(new Error("Поток оборвался, ответ не пришёл"));
    }).catch(reject);
  });
}

async function run(step, ctx) {
  S.busy = true; S.error = null; render();
  const pre = $("#think pre");
  if (pre) pre.textContent = "";
  try {
    const out = await callStep(step, ctx, (t) => {
      const p = $("#think pre");
      if (p) { p.textContent += t; p.scrollTop = p.scrollHeight; }
    });
    S.busy = false;
    return out.data;
  } catch (e) {
    S.busy = false; S.error = e.message; render(); return null;
  }
}

/** Сохраняет текущий разбор в историю и очищает состояние под новый. */
function parkAndReset() {
  const had = Boolean(S.read);
  if (had) histUpsert(S.step);
  const note = had ? { id: S.runId, title: S.read.restated, done: S.step === "sheet" } : null;
  Object.assign(S, {
    step: "input", situation: "", runId: null, read: null, answers: {}, free: {}, extra: "",
    refine: null, chosenType: null, axisIndex: 0, positions: [], decideRequested: false, decide: null,
    approachId: null, firstStep: "", error: null, busy: false, savedNote: note,
  });
  view = "diag"; render(); window.scrollTo({ top: 0 });
}

/** Кнопка «отложить» — показывается на всех шагах, кроме экрана ввода. */
function parkButton() {
  if (S.step === "input" || S.busy) return "";
  return `<button class="back" id="park">Отложить и начать новый разбор</button>`;
}

/* ------------------------------- экраны ------------------------------- */

const STEP_ORDER = ["input", "questions", "readings", "axis", "decide", "sheet"];
function stepsBar() {
  const i = STEP_ORDER.indexOf(S.step);
  return `<div class="steps">${STEP_ORDER.map((_, n) =>
    `<i class="${n < i ? "done" : n === i ? "now" : ""}"></i>`).join("")}</div>`;
}

function thinkBox(label) {
  return `<div class="think" id="think">
    <div class="k">${esc(label)} <span class="dots"></span></div>
    <pre></pre>
  </div>`;
}

function viewInput() {
  return `${stepsBar()}
  <div class="eyebrow">Шаг 1 · Ситуация</div>
  <h1 style="margin-top:10px">Опишите управленческий вызов, с которым имеете дело</h1>
  <p class="lede">Опишите двумя-тремя предложениями своими словами — дальше мы зададим уточняющие
  вопросы, чтобы точнее определить тип вашей ситуации. Без названий компаний и людей — они не нужны.</p>
  ${S.savedNote ? `<div class="card hl" style="margin-top:20px">
    <div class="k">${S.savedNote.done ? "Разбор завершён" : "Разбор отложен"}</div>
    <p style="font-size:.93rem">«${esc(S.savedNote.title)}» сохранён в истории${S.savedNote.done ? "" : " на том шаге, где вы остановились"}.
    К нему можно вернуться и продолжить.</p>
    <div class="acts" style="margin-top:12px">
      <button class="more" data-open-hist="${esc(S.savedNote.id)}">Открыть в истории</button>
    </div>
  </div>` : ""}
  <div class="stack" style="margin-top:20px">
    <textarea id="sit" rows="5" placeholder="Например: совет требует сократить расходы на 20%, но единственный источник роста у нас — новые продукты, и режем мы в первую очередь их.">${esc(S.situation)}</textarea>
    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
    <div class="acts" style="margin-top:0">
      <button class="go" id="start">Разобрать ситуацию</button>
      <span class="note">Описание уходит только в модель для этого прогона. Разбор сохранится в истории — в вашем браузере, не на сервере.</span>
    </div>
    ${S.busy ? thinkBox("Агент читает ситуацию") : ""}
  </div>`;
}

const CRIT_NAME = { structural: "Структурный", immeasurable: "Неизмеримость", cyclic: "Цикличность",
  economic: "Экономический", political: "Политический", emotional: "Эмоциональный" };
const CRIT_TERM = { structural: "структурный критерий", immeasurable: "неизмеримость", cyclic: "цикличность",
  economic: "экономический критерий", political: "политический критерий", emotional: "эмоциональный критерий" };

function criteriaBlock(criteria) {
  return `<div class="crit">${criteria.map(c => `<div>
    <b>${term(CRIT_TERM[c.id], CRIT_NAME[c.id] || c.id)}</b>
    <span class="flag ${c.present}">${FLAG[c.present]}</span>
    <em>${esc(c.evidence)}</em></div>`).join("")}</div>`;
}

function hypothesisCard(h) {
  return `<div class="card">
    <div class="k">Рабочая гипотеза — не диагноз</div>
    <h3>${GLYPH(h.type)}Похоже на: ${term(RU[h.type])} <span class="note" style="font-weight:400">· уверенность ${Math.round(h.confidence * 100)}%</span></h3>
    <p style="margin-top:8px;font-size:.92rem;color:var(--ink-2)">${esc(h.why)}</p>
    <div class="k" style="margin:16px 0 8px">Критерии по вашему описанию</div>
    ${criteriaBlock(h.criteria)}
    <div style="margin-top:12px"><button class="more" data-theory="t-crit">Что означает каждый критерий</button></div>
  </div>`;
}

function challengesCard(list) {
  if (!list?.length) return "";
  return `<div class="card">
    <div class="k">Что лежит в этой ситуации</div>
    <p class="note" style="margin-bottom:12px">Живая ситуация редко состоит из одного вызова.
    Разбираем тот, что помечен как основной — можно переключиться на любой другой.</p>
    <div class="chal">${list.map(c => `<div>
      <div class="t">
        <div class="chal-type">${GLYPH(c.type)}<b>${term(RU[c.type], RU[c.type])}</b></div>
        <p class="chal-def">${esc(GLOSS[RU[c.type]]?.short || "")}</p>
        <div class="chal-sub"><b>${esc(c.title)}</b><span>${esc(c.why)}</span></div>
      </div>
      ${c.primary
        ? '<span class="cur">разбираем</span>'
        : `<button class="icon" data-focus="${esc(c.title)}">Разобрать этот</button>`}
    </div>`).join("")}</div>
  </div>`;
}

function viewQuestions() {
  const r = S.read;
  const q = r.questions.map((qq, i) => {
    const sel = S.answers[qq.id];
    const free = S.free[qq.id] || "";
    const opts = (qq.options || []).map(o =>
      `<button class="pick" data-q="${esc(qq.id)}" data-v="${esc(o.label)}"
         aria-pressed="${!free && sel === o.label}"><b>${esc(o.label)}</b></button>`).join("");
    return `<div class="card"><div class="k">Вопрос ${i + 1}</div>
      <h4 style="margin-bottom:12px">${esc(qq.text)}</h4>
      ${opts ? `<div class="stack-s">${opts}</div>` : ""}
      <label class="f own"><b>${opts ? "Или впишите свой ответ" : "Ваш ответ"}</b>
        <input type="text" data-free="${esc(qq.id)}" value="${esc(free)}"
               placeholder="Своими словами — точнее, чем вариант из списка"></label>
      <p class="note" style="margin-top:10px">Проверяет: ${esc(qq.tests)}</p></div>`;
  }).join("");

  const answered = r.questions.filter(qq => (S.free[qq.id] || "").trim() || S.answers[qq.id]).length;

  return `${stepsBar()}
  <div class="eyebrow">Шаг 2 из 6 · Вопросы</div>
  <h1 style="margin-top:10px">Уточняющие вопросы по вашей ситуации</h1>
  <div class="stack" style="margin-top:22px">
    <div class="tile"><div class="k">Ситуация, как я её понял</div><p>${esc(r.restated)}</p></div>
    ${challengesCard(r.challenges)}

    <div class="card hl">
      <div class="k">Зачем эти вопросы</div>
      <p style="font-size:.93rem">${esc(r.question_plan)}</p>
    </div>

    <div class="stack">${q}</div>

    <div class="card">
      <div class="k">Дорасскажите своими словами</div>
      <p class="note" style="margin-bottom:10px">${esc(r.ask_more ||
        "Если варианты выше не описывают вашу ситуацию точно — допишите здесь всё, что считаете важным. Это уточнит разбор сильнее, чем ответы из списка.")}</p>
      <textarea id="extra" rows="3" placeholder="Необязательно, но помогает">${esc(S.extra)}</textarea>
    </div>

    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
    ${S.busy ? thinkBox("Агент уточняет картину") : ""}
  </div>
  <div class="acts">
    <button class="go" id="refine" ${S.busy ? "disabled" : ""}>Уточнить · ответов ${answered} из ${r.questions.length}</button>
    <button class="back" data-goto="input">Переписать ситуацию</button>
    ${parkButton()}
  </div>`;
}

function beamRead(ax, pos) {
  return pos < 35 ? `Перекос к «${ax.a.toLowerCase()}» — ${100 - pos} против ${pos}`
    : pos > 65 ? `Перекос к «${ax.b.toLowerCase()}» — ${pos} против ${100 - pos}`
    : `Примерно в равновесии — ${100 - pos} против ${pos}`;
}

/** Оси и их положение, с правкой пользователя, для передачи агенту на шаг решений. */
function chosenAxesCtx() {
  return (S.refine.axes || []).map((a, i) => ({ ...a, userPosition: S.positions[i] ?? a.position?.value ?? 50 }));
}

function polesCard(ax) {
  return `<div class="poles">
    <div class="pole a"><div class="pk">${term("полюс", "Полюс")} A</div><h4>${esc(ax.a)}</h4>
      <p><b>Даёт.</b> ${esc(ax.gives_a)}</p><p class="bad"><b>${term("перекос", "Перекос")}.</b> ${esc(ax.over_a)}</p></div>
    <div class="pole b"><div class="pk">${term("полюс", "Полюс")} B</div><h4>${esc(ax.b)}</h4>
      <p><b>Даёт.</b> ${esc(ax.gives_b)}</p><p class="bad"><b>${term("перекос", "Перекос")}.</b> ${esc(ax.over_b)}</p></div>
  </div>`;
}

function beamCard(ax, i, pos) {
  return `<div class="card">
    <div class="k">Где вы сейчас — ${esc(ax.a)} / ${esc(ax.b)}</div>
    <div class="beam-lbl"><span>${esc(ax.a)}</span><span>${esc(ax.b)}</span></div>
    <input type="range" class="beam" data-axis="${i}" min="0" max="100" value="${pos}" aria-label="Положение на оси: ${esc(ax.a)} — ${esc(ax.b)}">
    <div class="beam-read" data-beamread="${i}">${esc(beamRead(ax, pos))}</div>
    <p class="note" style="margin-top:10px">${esc(ax.position.why)}</p>
    <div class="scale">
      <div><b>У полюса A</b>${esc(ax.scale_meaning.left)}</div>
      <div><b>Середина</b>${esc(ax.scale_meaning.mid)}</div>
      <div><b>У полюса B</b>${esc(ax.scale_meaning.right)}</div>
    </div>
  </div>`;
}

/** Плоскость двух осей: положение показывается точкой, а не отдельной линией.
 * optX/optY — если заданы, дополнительно рисуют цель (оптимум) и траекторию к ней. */
function planeCard(axX, axY, ix, iy, posX, posY, optX, optY) {
  const hasOpt = optX != null && optY != null;
  return `<div class="plane-wrap">
    <div class="plane-lbl top">${esc(axY.a)}</div>
    <div class="plane-lbl side left">${esc(axX.a)}</div>
    <div class="plane-grid" data-ix="${ix}" data-iy="${iy}">
      ${hasOpt ? `<svg class="plane-traj" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="${posX}" y1="${posY}" x2="${optX}" y2="${optY}"/>
        </svg>
        <div class="plane-target" style="left:${optX}%;top:${optY}%" title="Оптимум"></div>` : ""}
      <div class="plane-dot" data-x="${ix}" data-y="${iy}" style="left:${posX}%;top:${posY}%"></div>
    </div>
    <div class="plane-lbl side right">${esc(axX.b)}</div>
    <div class="plane-lbl bottom">${esc(axY.b)}</div>
    <p class="plane-read" data-x="${ix}" data-y="${iy}">${esc(beamRead(axX, posX))} · ${esc(beamRead(axY, posY))}</p>
  </div>`;
}

function passportCard(ax) {
  return `<div class="sect"><div class="k">${ax.optimum.exists ? "Куда целиться: точка есть" : "Устойчивой точки нет — держим коридор"}${term("оптимум", "")}</div>
      <p style="font-size:.92rem;color:var(--ink-2)">${esc(ax.optimum.where)}</p>
      <p style="font-size:.92rem;margin-top:10px"><b>Как двигаться.</b> ${esc(ax.optimum.how_to_move)}</p></div>
    <div class="sect"><div class="k">Паспорт ${term("натяжение", "натяжения")}</div>
      <div class="meta">
        <div><b>${term("триггер", "Триггер")}</b><span>${esc(ax.trigger)}</span></div>
        <div><b>${term("темпоральность", "Темпоральность")}</b><span>${esc(ax.temporal)}</span></div>
        <div><b>Уровень</b><span>${esc(ax.level)}</span></div>
        <div><b>${term("конститутивность", "Конститутивность")}</b><span>${esc(ax.verdict)}</span></div>
        <div><b>Типичная ошибка</b><span>${esc(ax.mistake)}</span></div>
      </div></div>`;
}

function viewReadings() {
  const r = S.refine;
  return `${stepsBar()}
  <div class="eyebrow">Шаг 3 из 6 · Три прочтения</div>
  <h1 style="margin-top:10px">Одну и ту же ситуацию можно прочесть тремя способами</h1>
  <div class="stack" style="margin-top:22px">
    ${hypothesisCard(r.hypothesis)}
    <div class="card"><div class="k">Как это выглядит в каждой рамке</div>
      <div class="stack" style="gap:20px">${r.readings.map(rd => `<div class="reading">
        <h4>${GLYPH(rd.type)}Если это ${term(RU[rd.type], RU[rd.type])} — способ ${VERB[rd.type]}</h4>
        <p>${esc(rd.looks)}</p>
        <p class="cost"><b>Цена ошибки.</b> ${esc(rd.cost_if_wrong)}</p></div>`).join("")}</div>
    </div>

    <div class="card">
      <div class="k">Назвать может только тот, кто внутри ситуации</div>
      <p style="font-size:.93rem;color:var(--ink-2)">Тип вызова во многом субъективен: любую проблему
      можно развернуть в парадокс и наоборот. От того, как вы назовёте свою, зависит способ действия.
      Инструмент оставляет этот выбор вам.</p>
      <div class="stack-s" style="margin-top:16px">
        ${["problem", "dilemma", "paradox"].map(t =>
          `<button class="pick" data-name="${t}"><b>${GLYPH(t)}Это ${RU[t]}</b><span>Способ: ${VERB[t]}</span></button>`).join("")}
      </div>
    </div>

    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
    ${S.busy ? thinkBox("Агент собирает направления решений") : ""}
  </div>
  <div class="acts">
    <button class="back" data-goto="questions">Назад к вопросам</button>
    ${parkButton()}
  </div>`;
}

function viewAxis() {
  const r = S.refine;
  const axes = r.axes || [];
  if (!S.positions.length && axes.length) S.positions = axes.map(a => a.position?.value ?? 50);
  const multi = axes.length > 1;
  const planes = axes.length === 2
    ? planeCard(axes[0], axes[1], 0, 1, S.positions[0], S.positions[1])
    : axes.length === 3
    ? `<div class="planes3">
        ${planeCard(axes[0], axes[1], 0, 1, S.positions[0], S.positions[1])}
        ${planeCard(axes[0], axes[2], 0, 2, S.positions[0], S.positions[2])}
        ${planeCard(axes[1], axes[2], 1, 2, S.positions[1], S.positions[2])}
      </div>`
    : "";
  return `${stepsBar()}
  <div class="eyebrow">Шаг 4 из 6 · ${multi ? "Оси натяжения" : "Ось натяжения"}</div>
  <h1 style="margin-top:10px">${multi ? `${axes.length} парадокса держим одновременно` : "Полюса и положение на оси"}</h1>
  ${multi ? `<p class="lede">В ситуации не одно натяжение, а ${axes.length}. Выбирать, с каким работать
    дальше, не нужно — держим оба сразу: вместе они образуют ${axes.length === 2 ? "плоскость" : "пространство"}
    с ${axes.length} измерениями, а не одну линию.</p>` : ""}
  <div class="stack" style="margin-top:22px">
    ${axes.length === 0 ? `<p class="note">Агент не выделил ось натяжения — вернитесь к прочтениям и уточните ситуацию.</p>` : `
      ${axes.map((ax, i) => (multi
        ? `<div class="axgroup"><div class="eyebrow">Парадокс ${i + 1} · ${esc(ax.a)} — ${esc(ax.b)}</div>${polesCard(ax)}</div>`
        : polesCard(ax))).join("")}
      <p class="plane-hint big">${multi
        ? "Не согласны с оценкой — поставьте точку сами: нажмите в нужное место на плоскости или перетащите маркер."
        : "Не согласны с оценкой — подвиньте ползунок сами."}</p>
      ${multi ? planes : axes.map((ax, i) => beamCard(ax, i, S.positions[i])).join("")}
    `}

    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
    ${S.busy ? thinkBox("Агент собирает направления решений") : ""}
  </div>
  <div class="acts">
    <button class="go" id="toDecideParadox" ${S.decide ? "" : "disabled"}>${S.decide ? "Далее — к направлениям решений" : "Считаем направления решений…"}</button>
    <button class="back" data-goto="readings">Назад к прочтениям</button>
    ${parkButton()}
  </div>`;
}

function viewDecideParadox() {
  const d = S.decide;
  return `${stepsBar()}
  <div class="eyebrow">Шаг 5 из 6 · Области и направления принятия решений</div>
  <h1 style="margin-top:10px">Четыре подхода к вашей оси</h1>
  <p class="lede">Готового решения здесь нет и не будет: инструмент даёт примеры и вопросы,
  решение принимаете вы. Выберите подход, к которому готовы сделать первый шаг.</p>
  <div class="stack" style="margin-top:22px">
    ${d.approaches.map(a => `<div class="appr ${a.id === d.recommended ? "rec" : ""}" >
      <div class="appr-h">
        <h3>${term(APPR_TERM[a.id], APPR_NAME[a.id])}</h3>
        <span class="flag ${a.fit === "high" ? "yes" : a.fit === "medium" ? "partly" : "no"}">${FIT[a.fit]}</span>
        ${a.id === d.recommended ? '<span class="flag yes">рекомендую</span>' : ""}
      </div>
      <p style="font-size:.9rem;color:var(--ink-2)">${esc(a.why)}</p>
      <ul class="qs">${a.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul>
      ${a.id === d.recommended ? `<div class="card hl" style="margin-top:12px">
        <div class="k">Почему я рекомендую именно это</div>
        <p style="font-size:.9rem">${esc(d.recommended_why)}</p></div>` : ""}
      <div class="acts" style="margin-top:14px">
        <button class="pick" data-appr="${esc(a.id)}" aria-pressed="${S.approachId === a.id}"
                style="width:auto;padding:8px 16px"><b>Выбрать этот подход</b></button>
      </div>
    </div>`).join("")}
  </div>
  <div class="acts">
    <button class="go" id="tosheet" ${S.approachId ? "" : "disabled"}>Собрать карту</button>
    <button class="back" data-goto="axis">Назад к оси</button>
    ${parkButton()}
  </div>`;
}

function viewDecideSimple() {
  const d = S.decide, t = S.chosenType;
  const body = t === "problem" ? `
    <div class="card"><div class="k">Формулировка без встроенного решения</div>
      <p style="font-size:1rem">${esc(d.frame)}</p></div>
    <div class="card"><div class="k">Гипотезы о причине</div>
      <div class="meta">${d.causes.map(c => `<div><b>${esc(c.hypothesis)}</b><span>Проверка: ${esc(c.check)}</span></div>`).join("")}</div></div>
    <div class="card"><div class="k">Работа</div><div class="meta">
      <div><b>Признак «решено»</b><span>${esc(d.done)}</span></div>
      <div><b>Первый шаг</b><span>${esc(d.first_step)}</span></div></div></div>
    <div class="card"><div class="k">Контрольный вопрос</div>
      <p style="font-size:.93rem;color:var(--ink-2)">${esc(d.return_check)}</p></div>` : `
    <div class="poles">
      <div class="pole a"><div class="pk">Альтернатива A</div><p>${esc(d.alt_a)}</p>
        <p class="bad"><b>Цена отказа.</b> ${esc(d.cost_a)}</p></div>
      <div class="pole b"><div class="pk">Альтернатива B</div><p>${esc(d.alt_b)}</p>
        <p class="bad"><b>Цена отказа.</b> ${esc(d.cost_b)}</p></div></div>
    <div class="card"><div class="k">Выбор</div><div class="meta">
      <div><b>Общий критерий</b><span>${esc(d.criterion)}</span></div>
      <div><b>Срок</b><span>${esc(d.deadline)}</span></div>
      <div><b>Что изменило бы выбор</b><span>${esc(d.what_would_change)}</span></div></div></div>
    <div class="card"><div class="k">Контрольный вопрос</div>
      <p style="font-size:.93rem;color:var(--ink-2)">${esc(d.return_check)}</p></div>`;
  return `${stepsBar()}
  <div class="eyebrow">Шаг 5 из 6 · Работа с типом «${RU[t]}»</div>
  <h1 style="margin-top:10px">${t === "problem" ? "Проблема закрывается решением" : "Дилемма закрывается выбором"}</h1>
  <div class="stack" style="margin-top:22px">${body}</div>
  <div class="acts">
    <button class="go" id="tosheet">Собрать карту</button>
    <button class="back" data-goto="readings">Назад к прочтениям</button>
    ${parkButton()}
  </div>`;
}

function viewSheet() {
  const t = S.chosenType, d = S.decide;
  const date = new Date().toLocaleDateString("ru-RU");
  let body = "";
  if (t === "paradox" && S.refine.axes?.length) {
    const axes = S.refine.axes;
    const ai = Math.min(S.axisIndex, axes.length - 1);
    const ax = axes[ai];
    const pos = S.positions[ai] ?? ax.position.value;
    const multi = axes.length > 1;
    const whereNow = !multi
      ? `<div class="beam-lbl"><span>${esc(ax.a)}</span><span>${esc(ax.b)}</span></div>
         <div class="beam-track">
           <input type="range" min="0" max="100" value="${pos}" disabled aria-hidden="true">
           <div class="beam-traj" style="left:${Math.min(pos, ax.optimum.target)}%;width:${Math.abs(ax.optimum.target - pos)}%"></div>
           <div class="beam-target" style="left:${ax.optimum.target}%" title="Оптимум"></div>
         </div>
         <p class="beam-optlbl">⊙ Оптимум — ориентир, куда двигаться</p>`
      : axes.length === 2
      ? planeCard(axes[0], axes[1], 0, 1, S.positions[0], S.positions[1], axes[0].optimum.target, axes[1].optimum.target)
      : `<div class="planes3">
          ${planeCard(axes[0], axes[1], 0, 1, S.positions[0], S.positions[1], axes[0].optimum.target, axes[1].optimum.target)}
          ${planeCard(axes[0], axes[2], 0, 2, S.positions[0], S.positions[2], axes[0].optimum.target, axes[2].optimum.target)}
          ${planeCard(axes[1], axes[2], 1, 2, S.positions[1], S.positions[2], axes[1].optimum.target, axes[2].optimum.target)}
        </div>`;
    const a = d.approaches.find(x => x.id === S.approachId) || d.approaches[0];
    body = `
      <div class="sect"><div class="k">${term("полюс", "Полюса")}</div>
        ${axes.map((axx, i) => (multi
          ? `<div class="axgroup"><div class="eyebrow">Парадокс ${i + 1} · ${esc(axx.a)} — ${esc(axx.b)}</div>${polesCard(axx)}</div>`
          : polesCard(axx))).join("")}</div>
      <div class="sect"><div class="k">Где мы сейчас${multi ? " · ⊙ — куда двигаться" : ""}</div>${whereNow}</div>
      <div class="sect"><div class="k">Выбранный подход · ${esc(APPR_NAME[a.id])}</div>
        <p style="font-size:.92rem;color:var(--ink-2)">${esc(a.why)}</p>
        <ul class="qs">${a.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>
      ${multi ? `<div class="stack-s noprint" style="margin:2px 0 -8px">
        ${axes.map((axx, i) => `<div>
          <div class="eyebrow" style="margin:0 0 4px">Парадокс ${i + 1}</div>
          <button class="pick" data-axis="${i}" aria-pressed="${i === ai}"><b>${esc(axx.a)} — ${esc(axx.b)}</b></button>
        </div>`).join("")}
      </div>` : ""}
      ${passportCard(ax)}`;
  } else if (t === "paradox") {
    body = `<div class="sect"><div class="k">Ось не заполнена</div>
      <p style="font-size:.93rem;color:var(--ink-2)">Агент не выделил ось натяжения — вернитесь
      к прочтениям и уточните ситуацию.</p></div>`;
  } else if (t === "problem") {
    body = `<div class="sect"><div class="k">Формулировка</div><p>${esc(d.frame)}</p></div>
      <div class="sect"><div class="k">Работа</div><div class="meta">
        <div><b>Признак «решено»</b><span>${esc(d.done)}</span></div>
        <div><b>Первый шаг</b><span>${esc(d.first_step)}</span></div>
        <div><b>Проверка возврата</b><span>${esc(d.return_check)}</span></div></div></div>`;
  } else {
    body = `<div class="sect"><div class="k">Альтернативы</div><div class="meta">
        <div><b>A</b><span>${esc(d.alt_a)} — цена отказа: ${esc(d.cost_a)}</span></div>
        <div><b>B</b><span>${esc(d.alt_b)} — цена отказа: ${esc(d.cost_b)}</span></div>
        <div><b>Критерий</b><span>${esc(d.criterion)}</span></div>
        <div><b>Срок</b><span>${esc(d.deadline)}</span></div>
        <div><b>Проверка возврата</b><span>${esc(d.return_check)}</span></div></div></div>`;
  }
  return `${stepsBar()}
  <div class="eyebrow noprint">Готово</div>
  <h1 class="noprint" style="margin:10px 0 20px">Ваша карта</h1>
  <div class="sheet">
    <div class="sheet-h">
      <div><h2>${t === "paradox"
        ? term("парадокс", S.refine.axes?.length > 1 ? `${S.refine.axes.length} парадокса` : "Парадокс")
        : term(RU[t], RU[t][0].toUpperCase() + RU[t].slice(1))}</h2>
        <p class="note">${GLYPH(t)}способ: ${VERB[t]}</p></div>
      <span class="note" style="font-family:var(--mono);font-size:.7rem">${date}</span>
    </div>
    ${body}
  </div>
  <div class="acts noprint">
    <button class="go" onclick="window.print()">Распечатать</button>
    <button class="back" data-goto="decide">Назад</button>
    ${parkButton()}
  </div>`;
}

/* ------------------------------- теория ------------------------------- */

let THEORY = null;
async function loadTheory() {
  if (THEORY) return THEORY;
  THEORY = await (await fetch("/api/theory")).json();
  return THEORY;
}

function viewTheory(T) {
  const sec = (id, title, html) => `<section class="sec" id="t-${id}"><h2>${title}</h2><div class="stack" style="margin-top:14px">${html}</div></section>`;
  return `
  <div class="eyebrow">Справочник</div>
  <h1 style="margin-top:10px">Проблема, дилемма, парадокс</h1>
  <p class="lede">Прежде чем что-то решать, полезно понять, с вызовом какого рода вы имеете дело —
  у каждого свой способ действия, и перепутать их дорого. Проблему устраняют, дилемму разрешают
  выбором, а парадокс не решается раз и навсегда — с ним нужно научиться постоянно работать,
  удерживая обе стороны натяжения одновременно.</p>
  <div class="trio">
    <figure><img src="/img/problem.jpg" alt="Проблема: дорога завалена камнями"><figcaption>Проблема — препятствие с решением</figcaption></figure>
    <figure><img src="/img/dilemma.jpg" alt="Дилемма: развилка дорог"><figcaption>Дилемма — выбор между дорогами</figcaption></figure>
    <figure><img src="/img/paradox.jpg" alt="Парадокс: человек тянет канат в обе стороны"><figcaption>Парадокс — натяжение, которое держат</figcaption></figure>
  </div>
  <div class="k" style="margin:22px 0 10px">Содержание</div>
  <div class="book-toc">${[
    ["types", "Три типа управленческого вызова", "Что такое проблема, дилемма и парадокс — и чем один отличается от другого"],
    ["cost", "Цена неправильного диагноза", "Что бывает, если перепутать один тип вызова с другим"],
    ["crit", "Критерии парадокса", "По каким признакам отличить парадокс от дилеммы или обычной проблемы"],
    ["tests", "Диагностические тесты", "Короткие вопросы к себе, которые помогают проверить гипотезу о типе вызова"],
    ["appr", "Четыре подхода к парадоксу", "Что можно делать с парадоксом, если решили не устранять его, а удерживать"],
    ["algo", "Алгоритм работы с парадоксом", "Как это выглядит по шагам: диагноз → настройка → цикл"],
    ["pos", "Две позиции", "Два взгляда на то, стоит ли искать выход из парадокса или с ним нужно научиться жить"],
    ["pass", "Примеры парадоксов", "Шесть разобранных примеров: полюса, кейсы, типичные ошибки"],
  ].map(([id, n, d]) => `<button data-jump="t-${id}"><b>${n}</b><span>${d}</span></button>`).join("")}</div>

  ${sec("types", "Три типа управленческого вызова", T.types.map(t => `<div class="card">
    <h3>${GLYPH(t.id)}${esc(t.name)} — способ: ${esc(t.verb)}</h3>
    <p class="note" style="margin-top:6px">${esc(t.core)}</p>
    <p style="margin-top:10px;font-size:.93rem;color:var(--ink-2)">${esc(t.def)}</p>
    <div class="k" style="margin:14px 0 6px">Признаки</div>
    <ul class="qs">${t.signs.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <div class="meta" style="margin-top:14px">
      <div><b>Инструменты</b><span>${esc(t.tools)}</span></div>
      <div><b>Время</b><span>${esc(t.time)}</span></div>
      <div><b>После действия</b><span>${esc(t.after)}</span></div>
      <div><b>Цена ошибки</b><span>${esc(t.cost)}</span></div>
    </div></div>`).join(""))}

  ${sec("cost", "Цена неправильного диагноза", `<div class="card"><div class="meta">
    ${T.misdiagnosis.map(m => `<div><b>${esc(m.real)} → ${esc(m.wrong)}</b>
      <span><b>${esc(m.name)}.</b> ${esc(m.what)} ${esc(m.cost)}</span></div>`).join("")}
    </div></div>`)}

  ${sec("crit", "Критерии парадокса — 4+2", T.criteria.map(c => `<div class="card">
    <h4>${esc(c.name)} ${c.necessary ? '<span class="flag yes">необходимый</span>' : ""} ${c.signal ? '<span class="flag partly">сигнальный</span>' : ""}</h4>
    <p style="margin-top:8px;font-size:.92rem;color:var(--ink-2)">${esc(c.text)}</p>
    ${c.examples.length && c.id !== "structural" ? `<ul class="qs" style="margin-top:10px">${c.examples.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  </div>`).join(""))}

  ${sec("tests", "Диагностические тесты", `<div class="card"><div class="meta">
    ${T.tests.map(t => `<div><b>${esc(t.name)}</b><span>${esc(t.q)}${t.yes !== "—" ? ` <em style="color:var(--ink-3)">→ если да, это ${esc(t.yes)}</em>` : ""}</span></div>`).join("")}
    </div></div>`)}

  ${sec("appr", "Четыре подхода к работе с парадоксом", `<div class="card"><div class="meta">
    ${T.approaches.map(a => `<div><b>${esc(a.name)}</b><span>${esc(a.def)}</span></div>`).join("")}
    </div></div>`)}

  ${sec("algo", "Алгоритм: Диагноз → Настройка → Цикл", `<div class="card">
    <div class="k">Диагноз</div><p style="font-size:.92rem;color:var(--ink-2)">${esc(T.algorithm.diagnosis)}</p>
    <div class="k" style="margin-top:16px">Настройка — один раз</div>
    <ul class="qs">${T.algorithm.setup.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    <div class="k" style="margin-top:16px">Цикл — постоянно</div>
    <p style="font-size:.92rem;color:var(--ink-2)">${esc(T.algorithm.cycle)}</p></div>`)}

  ${sec("pos", "Две позиции работы с парадоксом", `
    <div class="card"><h4>${esc(T.positions.hold.name)}</h4>
      <p style="margin-top:8px;font-size:.92rem;color:var(--ink-2)">${esc(T.positions.hold.thesis)}</p>
      <ul class="qs" style="margin-top:10px">${T.positions.hold.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
    <div class="card"><h4>${esc(T.positions.dissolve.name)}</h4>
      <p style="margin-top:8px;font-size:.92rem;color:var(--ink-2)">${esc(T.positions.dissolve.thesis)}</p>
      <div class="k" style="margin-top:14px">Методы растворения</div>
      <ul class="qs">${T.positions.dissolve.methods.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
    <div class="card flat"><p style="font-size:.92rem;color:var(--ink-2)">${esc(T.positions.note)}</p></div>`)}

  ${sec("pass", "Примеры парадоксов", T.passports.map(p => `<div class="card">
    <h3>${esc(p.name)}</h3>
    <p class="note" style="margin-top:4px">${esc(p.sl)} · ${esc(p.verdict)}</p>
    <div class="poles" style="margin-top:14px">
      <div class="pole a"><div class="pk">Полюс A</div><h4>${esc(p.a.n)}</h4><p>${esc(p.a.is)}</p>
        <p style="margin-top:6px"><b>Даёт.</b> ${esc(p.a.gives)}</p>
        <p class="bad"><b>Перекос.</b> ${esc(p.a.over)}</p></div>
      <div class="pole b"><div class="pk">Полюс B</div><h4>${esc(p.b.n)}</h4><p>${esc(p.b.is)}</p>
        <p style="margin-top:6px"><b>Даёт.</b> ${esc(p.b.gives)}</p>
        <p class="bad"><b>Перекос.</b> ${esc(p.b.over)}</p></div></div>
    <div class="meta" style="margin-top:14px">
      <div><b>Уровень</b><span>${esc(p.level)}</span></div>
      <div><b>Темпоральность</b><span>${esc(p.temporal)}</span></div>
      <div><b>Триггер</b><span>${esc(p.trigger)}</span></div>
      <div><b>Способ работы</b><span>${esc(p.way)}</span></div>
      <div><b>Типичная ошибка</b><span>${esc(p.mistake)}</span></div></div></div>`).join(""))}`;
}

function viewHistory() {
  const list = histLoad();
  if (!list.length) {
    return `<div class="eyebrow">История</div>
    <h1 style="margin-top:10px">Здесь будут ваши разборы</h1>
    <p class="lede">Каждый прогон сохраняется автоматически, начиная с первого чтения ситуации.
    К нему можно вернуться, досмотреть и допройти с того места, где остановились.</p>
    <div class="empty" style="margin-top:24px">Пока ни одного разбора.</div>`;
  }
  return `<div class="eyebrow">История · ${list.length} ${list.length === 1 ? "разбор" : list.length < 5 ? "разбора" : "разборов"}</div>
  <h1 style="margin-top:10px">Ваши разборы</h1>
  <p class="lede">Хранятся только в этом браузере и на сервер не отправляются. Нажмите на запись,
  чтобы открыть её и продолжить с того места, где остановились.</p>
  <div class="hist" style="margin-top:24px">
    ${list.map(e => {
      const d = new Date(e.updated);
      const when = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " · " +
                   d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const named = e.chosenType
        ? `<span class="flag yes">${GLYPH(e.chosenType)}${RU[e.chosenType]}</span>`
        : e.guess ? `<span class="flag partly">гипотеза: ${RU[e.guess]}</span>` : "";
      return `<div class="hrow" data-open="${esc(e.id)}" role="button" tabindex="0">
        <div>
          <h4>${esc(e.restated)}</h4>
          <p class="sit">${esc(e.situation.length > 160 ? e.situation.slice(0, 160) + "…" : e.situation)}</p>
          <div class="tags">
            ${named}
            <span class="flag">${STAGE_LABEL[e.stage] || e.stage}</span>
            ${e.stage !== "sheet" ? '<span class="flag partly">не завершён</span>' : ""}
            ${e.axisName ? `<span class="flag long">${esc(e.axisName)}</span>` : ""}
            ${e.demo ? '<span class="flag no">демо</span>' : ""}
          </div>
        </div>
        <div class="hrow-acts">
          <span class="when">${when}</span>
          <button class="icon" data-del="${esc(e.id)}">Удалить</button>
        </div>
      </div>`;
    }).join("")}
  </div>
  <div class="acts"><button class="back" id="clearHist">Очистить историю целиком</button></div>`;
}

/* ------------------------------- рендер ------------------------------- */

let view = "diag";

async function goTheory(anchor) {
  closePop();
  view = "theory";
  $("#view-theory").innerHTML = viewTheory(await loadTheory());
  render();
  requestAnimationFrame(() => {
    const el = anchor && document.getElementById(anchor);
    (el || document.body).scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Запускает разбор направлений решений сразу по приходу на шаг оси, не дожидаясь клика «Далее». */
function maybeAutoDecide() {
  if (S.step !== "axis" || S.chosenType !== "paradox" || S.decide || S.decideRequested || S.busy) return;
  S.decideRequested = true;
  (async () => {
    const ctx = { situation: S.situation, read: S.read, refine: S.refine,
      chosenType: "paradox", chosenAxes: chosenAxesCtx() };
    const data = await run("decide_paradox", ctx);
    if (data) { S.decide = data; S.approachId = data.recommended || null; }
    else { S.decideRequested = false; }
    render();
  })();
}

function render() {
  const d = $("#view-diag"), h = $("#view-history"), t = $("#view-theory");
  d.hidden = view !== "diag"; h.hidden = view !== "history"; t.hidden = view !== "theory";
  document.querySelectorAll("#nav button").forEach(b =>
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  histBadge();
  if (view === "history") { h.innerHTML = viewHistory(); return; }
  if (view !== "diag") return;
  maybeAutoDecide();
  d.innerHTML =
    S.step === "input" ? viewInput() :
    S.step === "questions" ? viewQuestions() :
    S.step === "readings" ? viewReadings() :
    S.step === "axis" ? viewAxis() :
    S.step === "decide" ? (S.chosenType === "paradox" ? viewDecideParadox() : viewDecideSimple()) :
    S.step === "sheet" ? viewSheet() : "";
  const sit = $("#sit"); if (sit) sit.focus();
}

/* ------------------------------- события ------------------------------- */

document.addEventListener("click", async (e) => {
  const info = e.target.closest(".i");
  if (info) { e.stopPropagation(); openPop(info); return; }

  const toTheory = e.target.closest("[data-theory]");
  if (toTheory) { await goTheory(toTheory.dataset.theory); return; }

  if (!e.target.closest(".pop")) closePop();

  const focus = e.target.closest("[data-focus]");
  if (focus) {
    const data = await run("read", { situation: S.situation, focus: focus.dataset.focus, extra: S.extra });
    if (data) {
      S.read = data; S.answers = {}; S.free = {}; S.step = "questions";
      histUpsert("questions"); render(); window.scrollTo({ top: 0 });
    }
    return;
  }

  const th = e.target.closest("[data-theme-set]");
  if (th) { themeSet(th.dataset.themeSet); return; }

  const pv = e.target.closest("[data-prov]");
  if (pv) {
    S.provider = pv.dataset.prov;
    try { localStorage.setItem(PROV_KEY, S.provider); } catch {}
    provPaint();
    return;
  }

  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); histDelete(del.dataset.del); render(); return; }

  if (e.target.closest("#clearHist")) {
    if (window.confirm("Удалить все сохранённые разборы? Отменить это будет нельзя.")) { histClear(); render(); }
    return;
  }

  const open = e.target.closest("[data-open]");
  if (open && open.classList.contains("hrow")) { histOpen(open.dataset.open); return; }

  const nav = e.target.closest("#nav button");
  if (nav) {
    view = nav.dataset.view;
    if (view === "theory") $("#view-theory").innerHTML = viewTheory(await loadTheory());
    render();
    if (view === "theory") window.scrollTo({ top: 0 });
    return;
  }
  const jump = e.target.closest("[data-jump]");
  if (jump) { document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: "smooth" }); return; }

  if (e.target.closest("#park")) {
    if (S.step !== "sheet" && !window.confirm(
      "Отложить текущий разбор и начать новый?\n\nОн сохранится в истории на том шаге, где вы остановились, и к нему можно будет вернуться.")) return;
    parkAndReset(); return;
  }

  const oh = e.target.closest("[data-open-hist]");
  if (oh) { histOpen(oh.dataset.openHist); return; }

  if (e.target.closest("#restart")) {
    if (S.read && S.step !== "input" && !window.confirm(
      "Начать новый разбор?\n\nТекущий сохранится в истории на том шаге, где вы остановились.")) return;
    parkAndReset(); return;
  }

  const goto = e.target.closest("[data-goto]");
  if (goto) { S.step = goto.dataset.goto; S.error = null; render(); return; }

  if (e.target.closest("#start")) {
    S.savedNote = null;
    S.situation = $("#sit").value.trim();
    if (S.situation.length < 15) { S.error = "Добавьте пару предложений — по одной фразе разобрать нечего."; render(); return; }
    const data = await run("read", { situation: S.situation });
    if (data) {
      S.read = data; S.answers = {}; S.step = "questions";
      S.runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
      histUpsert("questions");
      render(); window.scrollTo({ top: 0 });
    }
    return;
  }

  const q = e.target.closest("[data-q]");
  if (q) {
    S.answers[q.dataset.q] = S.answers[q.dataset.q] === q.dataset.v ? undefined : q.dataset.v;
    render(); return;
  }

  if (e.target.closest("#refine")) {
    const ex = $("#extra"); if (ex) S.extra = ex.value.trim();
    const answers = S.read.questions.map(qq => ({
      question: qq.text,
      answer: (S.free[qq.id] || "").trim() || S.answers[qq.id] || "",
    }));
    const data = await run("refine", { situation: S.situation, read: S.read, answers, extra: S.extra });
    if (data) {
      S.refine = data; S.axisIndex = 0; S.decide = null; S.decideRequested = false;
      S.positions = (data.axes || []).map(a => a.position?.value ?? 50);
      S.step = "readings"; histUpsert("readings");
      render(); window.scrollTo({ top: 0 });
    }
    return;
  }

  const axb = e.target.closest("[data-axis]");
  if (axb) {
    S.axisIndex = Number(axb.dataset.axis);
    histUpsert(S.step); render(); return;
  }

  const nameBtn = e.target.closest("[data-name]");
  if (nameBtn) {
    S.chosenType = nameBtn.dataset.name;
    if (S.chosenType === "paradox") {
      // Для парадокса сначала смотрим ось (оси) — направления решений запускаются
      // в фоне сразу, не дожидаясь клика «Далее» (см. maybeAutoDecide). Для проблемы
      // и дилеммы ось не нужна, туда не заходим — сразу считаем разбор.
      S.step = "axis"; histUpsert("axis"); render(); window.scrollTo({ top: 0 });
      return;
    }
    const step = "decide_" + S.chosenType;
    const ctx = { situation: S.situation, read: S.read, refine: S.refine,
      chosenType: S.chosenType, chosenAxes: chosenAxesCtx() };
    const data = await run(step, ctx);
    if (data) {
      S.decide = data; S.approachId = data.recommended || null; S.step = "decide";
      histUpsert("decide"); render(); window.scrollTo({ top: 0 });
    }
    return;
  }

  if (e.target.closest("#toDecideParadox")) {
    if (!S.decide) return; // ещё считается в фоне — кнопка должна быть недоступна
    S.step = "decide"; histUpsert("decide"); render(); window.scrollTo({ top: 0 });
    return;
  }

  const ap = e.target.closest("[data-appr]");
  if (ap) { S.approachId = ap.dataset.appr; render(); return; }

  if (e.target.closest("#tosheet")) {
    const f = $("#first"); if (f) S.firstStep = f.value.trim();
    S.step = "sheet"; histUpsert("sheet"); render(); window.scrollTo({ top: 0 }); return;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest?.(".hrow[data-open]");
  if (row) { e.preventDefault(); histOpen(row.dataset.open); }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset?.free !== undefined) {
    S.free[e.target.dataset.free] = e.target.value;
    const card = e.target.closest(".card");
    const has = e.target.value.trim().length > 0;
    card?.querySelectorAll("[data-q]").forEach(b => {
      if (has) b.setAttribute("aria-pressed", "false");
      else if (S.answers[e.target.dataset.free] === b.dataset.v) b.setAttribute("aria-pressed", "true");
    });
    const btn = $("#refine");
    if (btn && S.read) {
      const n = S.read.questions.filter(q => (S.free[q.id] || "").trim() || S.answers[q.id]).length;
      btn.textContent = `Уточнить · ответов ${n} из ${S.read.questions.length}`;
    }
    return;
  }
  if (e.target.id === "extra") { S.extra = e.target.value; return; }
  if (e.target.classList?.contains("beam")) {
    const i = Number(e.target.dataset.axis);
    setAxisPosition(i, Number(e.target.value));
  }
});

/** Правит положение по одной оси везде, где оно показано: балка и точки на всех плоскостях. */
function setAxisPosition(i, value) {
  S.positions[i] = value;
  const ax = S.refine.axes[i];
  const readEl = document.querySelector(`[data-beamread="${i}"]`);
  if (readEl) readEl.textContent = beamRead(ax, value);
  document.querySelectorAll(".plane-dot").forEach(d => {
    if (Number(d.dataset.x) === i) d.style.left = value + "%";
    if (Number(d.dataset.y) === i) d.style.top = value + "%";
  });
  document.querySelectorAll(".plane-read").forEach(el => {
    if (Number(el.dataset.x) === i || Number(el.dataset.y) === i) {
      const axX = S.refine.axes[Number(el.dataset.x)], axY = S.refine.axes[Number(el.dataset.y)];
      el.textContent = `${beamRead(axX, S.positions[Number(el.dataset.x)])} · ${beamRead(axY, S.positions[Number(el.dataset.y)])}`;
    }
  });
}

let dragPlane = null;
function planePointFromEvent(e) {
  const rect = dragPlane.el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
  const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
  return { x: Math.round(x), y: Math.round(y) };
}
function applyPlanePoint(e) {
  const p = planePointFromEvent(e);
  if (p) { setAxisPosition(dragPlane.ix, p.x); setAxisPosition(dragPlane.iy, p.y); }
}
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".plane-grid");
  if (!el) return;
  // На мыши тянем откуда угодно. На пальце непрерывное перетаскивание начинаем
  // только с самого маркера — иначе квадрат перехватит вертикальный свайп
  // и страницу нельзя будет проскроллить. Касание по полю ставит точку на отпускании.
  const fromDot = Boolean(e.target.closest(".plane-dot"));
  const drag = e.pointerType !== "touch" || fromDot;
  dragPlane = { el, ix: Number(el.dataset.ix), iy: Number(el.dataset.iy), drag, moved: false };
  if (!drag) return;
  (fromDot ? e.target.closest(".plane-dot") : el).setPointerCapture?.(e.pointerId);
  applyPlanePoint(e);
});
document.addEventListener("pointermove", (e) => {
  if (!dragPlane) return;
  if (!dragPlane.drag) { dragPlane.moved = true; return; }
  applyPlanePoint(e);
});
document.addEventListener("pointerup", (e) => {
  // Касание без протяжки = поставить точку сюда. Протяжку не трогаем: это был скролл.
  if (dragPlane && !dragPlane.drag && !dragPlane.moved) applyPlanePoint(e);
  dragPlane = null;
});
document.addEventListener("pointercancel", () => { dragPlane = null; });

function provPaint() {
  const box = $("#prov");
  if (!box) return;
  if (S.providers.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = S.providers.map(p =>
    `<button data-prov="${esc(p.id)}" title="${esc(p.model)}" aria-pressed="${p.id === S.provider}">${esc(p.label)}</button>`).join("");
  const cur = S.providers.find(p => p.id === S.provider);
  const chip = $("#mode");
  chip.lastElementChild.textContent = cur ? cur.model : "демо-режим";
}

(async function init() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    S.live = cfg.live;
    S.providers = cfg.all || [];
    let saved = null;
    try { saved = localStorage.getItem(PROV_KEY); } catch {}
    S.provider = (saved && S.providers.some(p => p.id === saved)) ? saved : cfg.id;
    const chip = $("#mode");
    chip.className = "chip " + (cfg.live ? "live" : "demo");
    chip.lastElementChild.textContent = cfg.live ? cfg.model : "демо-режим";
    provPaint();
  } catch { /* оставляем как есть */ }
  try { GLOSS = (await loadTheory()).glossary || {}; } catch {}
  themePaint();
  histBadge();
  render();
})();
