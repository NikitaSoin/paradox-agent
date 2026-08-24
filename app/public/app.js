"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RU = { problem: "проблема", dilemma: "дилемма", paradox: "парадокс" };
const VERB = { problem: "решить", dilemma: "выбрать", paradox: "удерживать натяжение" };
const GLYPH = (t) => `<span class="glyph ${t}"><i></i><i></i></span>`;
const FLAG = { yes: "есть", partly: "частично", no: "нет", unknown: "не ясно" };
const APPR_NAME = { super: "Выход в надсистему", split: "Дробление до дилеммы или проблемы",
  space: "Разнесение в пространстве / во времени", synth: "Синтез" };
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
/** Создаёт или обновляет запись текущего прогона. */
function histUpsert(stage) {
  if (!S.runId || !S.read) return;
  const list = histLoad();
  const i = list.findIndex(e => e.id === S.runId);
  const entry = {
    id: S.runId,
    at: i >= 0 ? list[i].at : Date.now(),
    updated: Date.now(),
    stage,                                  // read | refine | decide | sheet
    demo: !S.live,
    situation: S.situation,
    restated: S.read.restated,
    guess: S.read.hypothesis?.type || null,
    chosenType: S.chosenType,
    axisIndex: S.axisIndex, position: S.position,
    axisName: S.refine?.axes?.[S.axisIndex]
      ? `${S.refine.axes[S.axisIndex].a} — ${S.refine.axes[S.axisIndex].b}` : null,
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
  Object.assign(S, {
    runId: e.id, situation: e.situation, read: e.read, refine: e.refine, decide: e.decide,
    answers: e.answers || {}, free: e.free || {}, extra: e.extra || "", chosenType: e.chosenType, axisIndex: e.axisIndex ?? 0,
    position: e.position ?? 50, approachId: e.approachId, firstStep: e.firstStep || "",
    step: e.stage === "sheet" ? "sheet" : e.stage === "decide" ? "decide"
      : e.stage === "refine" ? "refine" : "read",
    error: null, busy: false,
  });
  view = "diag"; render(); window.scrollTo({ top: 0 });
}

const PROV_KEY = "paradox.provider";

const S = {
  live: false, provider: null, providers: [], step: "input", situation: "", runId: null,
  read: null, answers: {}, free: {}, extra: "", refine: null,
  chosenType: null, axisIndex: 0, position: 50,
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
  if (had) histUpsert(S.step === "sheet" ? "sheet" : S.step === "decide" ? "decide"
    : S.step === "refine" ? "refine" : "read");
  const note = had ? { id: S.runId, title: S.read.restated, done: S.step === "sheet" } : null;
  Object.assign(S, {
    step: "input", situation: "", runId: null, read: null, answers: {}, free: {}, extra: "",
    refine: null, chosenType: null, axisIndex: 0, position: 50, decide: null,
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

const STEP_ORDER = ["input", "read", "refine", "decide", "sheet"];
function stepsBar() {
  const i = STEP_ORDER.indexOf(S.step === "name" ? "refine" : S.step);
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
  <p class="lede">Два-три предложения своими словами: что за напряжение, между чем и чем вас тянет,
  почему это встало именно сейчас. Без названий компаний и людей — они не нужны.</p>
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

function typeRef() {
  return `<div class="card flat">
    <div class="k">Что означают три типа</div>
    <div class="meta">
      ${["problem", "dilemma", "paradox"].map(t =>
        `<div><b>${GLYPH(t)}${term(RU[t])}</b><span>Способ: ${VERB[t]}</span></div>`).join("")}
    </div>
    <div style="margin-top:12px"><button class="more" data-theory="t-types">Чем они отличаются и чем грозит путаница</button></div>
  </div>`;
}

function challengesCard(list) {
  if (!list?.length) return "";
  return `<div class="card">
    <div class="k">Что лежит в этой ситуации</div>
    <p class="note" style="margin-bottom:12px">Живая ситуация редко состоит из одного вызова.
    Разбираем тот, что помечен как основной — можно переключиться на любой другой.</p>
    <div class="chal">${list.map(c => `<div>
      <div class="t"><b>${GLYPH(c.type)}${esc(c.title)}</b>
        <span>${term(RU[c.type])} · ${esc(c.why)}</span></div>
      ${c.primary
        ? '<span class="cur">разбираем</span>'
        : `<button class="icon" data-focus="${esc(c.title)}">Разобрать этот</button>`}
    </div>`).join("")}</div>
  </div>`;
}

function viewRead() {
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
  <div class="eyebrow">Шаг 2 · Чтение и вопросы</div>
  <h1 style="margin-top:10px">Что я понял и что нужно уточнить</h1>
  <div class="stack" style="margin-top:22px">
    <div class="tile"><div class="k">Ситуация, как я её понял</div><p>${esc(r.restated)}</p></div>
    ${challengesCard(r.challenges)}
    ${hypothesisCard(r.hypothesis)}
    ${typeRef()}
    ${r.axes?.length ? `<div class="card"><div class="k">Кандидатные ${term("ось", "оси")} натяжения</div>
      <div class="stack-s">${r.axes.map(a => `<div class="reading">
        <h4>${esc(a.a)} — ${esc(a.b)}</h4>
        <p>${esc(a.why)}</p>
        <p class="cost">${a.library_name ? "Из библиотеки: " + esc(a.library_name) : "Своя ось — в библиотеке такой нет"}</p>
      </div>`).join("")}</div></div>` : ""}

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

function axisBlock(ax, editable) {
  const pos = editable ? S.position : ax.position.value;
  const read = pos < 35 ? `Перекос к «${ax.a.toLowerCase()}» — ${100 - pos} против ${pos}`
    : pos > 65 ? `Перекос к «${ax.b.toLowerCase()}» — ${pos} против ${100 - pos}`
    : `Примерно в равновесии — ${100 - pos} против ${pos}`;
  return `<div class="stack">
    <div class="poles">
      <div class="pole a"><div class="pk">Полюс A</div><h4>${esc(ax.a)}</h4>
        <p><b>Даёт.</b> ${esc(ax.gives_a)}</p><p class="bad"><b>${term("перекос", "Перекос")}.</b> ${esc(ax.over_a)}</p></div>
      <div class="pole b"><div class="pk">Полюс B</div><h4>${esc(ax.b)}</h4>
        <p><b>Даёт.</b> ${esc(ax.gives_b)}</p><p class="bad"><b>${term("перекос", "Перекос")}.</b> ${esc(ax.over_b)}</p></div>
    </div>
    <div class="card">
      <div class="k">Где вы сейчас</div>
      <div class="beam-lbl"><span>${esc(ax.a)}</span><span>${esc(ax.b)}</span></div>
      <input type="range" id="beam" min="0" max="100" value="${pos}" ${editable ? "" : "disabled"} aria-label="Положение на оси">
      <div class="beam-read" id="beamread">${esc(read)}</div>
      <p class="note" style="margin-top:10px">${esc(ax.position.why)}</p>
      <div class="scale">
        <div><b>У полюса A</b>${esc(ax.scale_meaning.left)}</div>
        <div><b>Середина</b>${esc(ax.scale_meaning.mid)}</div>
        <div><b>У полюса B</b>${esc(ax.scale_meaning.right)}</div>
      </div>
    </div>
    <div class="card">
      <div class="k">${ax.optimum.exists ? "Оптимум есть" : "Устойчивого оптимума нет"}</div>
      <p style="font-size:.92rem;color:var(--ink-2)">${esc(ax.optimum.where)}</p>
      <p style="font-size:.92rem;margin-top:10px"><b>Как двигаться.</b> ${esc(ax.optimum.how_to_move)}</p>
    </div>
    <div class="card">
      <div class="k">Паспорт натяжения</div>
      <div class="meta">
        <div><b>${term("триггер", "Триггер")}</b><span>${esc(ax.trigger)}</span></div>
        <div><b>${term("темпоральность", "Темпоральность")}</b><span>${esc(ax.temporal)}</span></div>
        <div><b>Уровень</b><span>${esc(ax.level)}</span></div>
        <div><b>${term("конститутивность", "Конститутивность")}</b><span>${esc(ax.verdict)}</span></div>
        <div><b>Типичная ошибка</b><span>${esc(ax.mistake)}</span></div>
      </div>
    </div>
  </div>`;
}

function caseCard(c) {
  return `<div class="caseb ${c.sign === "+" ? "pos" : "neg"}">
    <div class="tag">${c.sign === "+" ? "позитивный" : "негативный"} · ${esc(c.axis)}</div>
    <h4>${esc(c.company)}</h4>
    <p style="color:var(--ink-2)">${esc(c.summary || "")}</p>
    <p style="margin-top:8px"><b>Чем это про вас.</b> ${esc(c.why_relevant)}</p>
    <div style="margin-top:9px"><button class="more" data-theory="${esc(caseAnchor(c.company))}">Полный кейс с фактурой</button></div>
  </div>`;
}

/** Якорь конкретного кейса в справочнике; если не нашли — общий раздел. */
function caseAnchor(company) {
  const slug = (company || "").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "");
  return slug ? "case-" + slug : "t-cases";
}

function viewRefine() {
  const r = S.refine;
  const axes = r.axes || [];
  const ax = axes[S.axisIndex];
  return `${stepsBar()}
  <div class="eyebrow">Шаг 3 · Три прочтения</div>
  <h1 style="margin-top:10px">Одну и ту же ситуацию можно прочесть тремя способами</h1>
  <p class="lede">${esc(r.what_changed)}</p>
  <div class="stack" style="margin-top:22px">
    ${hypothesisCard(r.hypothesis)}
    <div class="card"><div class="k">Как это выглядит в каждой рамке</div>
      <div class="stack" style="gap:20px">${r.readings.map(rd => `<div class="reading">
        <h4>${GLYPH(rd.type)}Если это ${RU[rd.type]} — способ ${VERB[rd.type]}</h4>
        <p>${esc(rd.looks)}</p>
        <p><b>Что тогда делать.</b> ${esc(rd.action)}</p>
        <p class="cost"><b>Цена ошибки.</b> ${esc(rd.cost_if_wrong)}</p></div>`).join("")}</div>
    </div>

    ${axes.length ? `<div>
      <div class="eyebrow" style="margin-bottom:10px">Ось натяжения${axes.length > 1 ? ` · ${axes.length} оси, выберите разбираемую` : ""}</div>
      ${axes.length > 1 ? `<div class="stack-s" style="margin-bottom:14px">${axes.map((a, i) =>
        `<button class="pick" data-axis="${i}" aria-pressed="${i === S.axisIndex}"><b>${esc(a.a)} — ${esc(a.b)}</b></button>`).join("")}</div>` : ""}
      ${axisBlock(ax, true)}
    </div>` : ""}

    ${r.cases?.length ? `<div class="card"><div class="k">Кейсы из библиотеки</div>
      ${r.cases.map(caseCard).join("")}</div>` : ""}

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
  <div class="acts"><button class="back" data-goto="read">Вернуться к вопросам</button>${parkButton()}</div>`;
}

const APPR_TERM = { super: "выход в надсистему", split: "дробление", space: "разнесение", synth: "синтез" };

function planBlock(d) {
  const r = d.rhythm;
  return `${d.plan?.length ? `<div class="card"><div class="k">Что дальше — после первого шага</div>
    <div class="plan">${d.plan.map(p => `<div>
      <div class="h">${esc(p.horizon)}</div>
      <div class="w">${esc(p.what)}</div>
      <div class="d">Сделано, когда: ${esc(p.done_when)}</div></div>`).join("")}</div></div>` : ""}
  ${r ? `<div class="card"><div class="k">${term("ритм", "Ритм")} и ${term("держатель")}</div>
    <div class="meta">
      <div><b>Как часто</b><span>${esc(r.cadence)}</span></div>
      <div><b>Кто держит</b><span>${esc(r.holder)}</span></div>
      <div><b>Куда пристегнуть</b><span>${esc(r.where)}</span></div>
      <div><b>Первый пересмотр</b><span>${esc(r.first_review)}</span></div>
    </div></div>` : ""}`;
}

function viewDecideParadox() {
  const d = S.decide;
  return `${stepsBar()}
  <div class="eyebrow">Шаг 4 · Области и направления принятия решений</div>
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
      <p style="font-size:.9rem;margin-top:12px"><b>Первый шаг.</b> ${esc(a.first_step)}</p>
      ${a.case_company ? `<div class="caseb"><div class="tag">кейс-близнец</div>
        <h4>${esc(a.case_company)}</h4>
        <p style="color:var(--ink-2)">${esc(a.case_summary || "")}</p>
        <p style="margin-top:8px"><b>Чем это про вас.</b> ${esc(a.case_why)}</p>
        <div style="margin-top:9px"><button class="more" data-theory="${esc(caseAnchor(a.case_company))}">Полный кейс с фактурой</button></div>
      </div>` : (a.case_why ? `<p class="note" style="margin-top:12px">Кейса в библиотеке нет: ${esc(a.case_why)}</p>` : "")}
      <div class="acts" style="margin-top:14px">
        <button class="pick" data-appr="${esc(a.id)}" aria-pressed="${S.approachId === a.id}"
                style="width:auto;padding:8px 16px"><b>Выбрать этот подход</b></button>
      </div>
    </div>`).join("")}

    <div class="card"><div class="k">Почему этот</div>
      <p style="font-size:.92rem;color:var(--ink-2)">${esc(d.recommended_why)}</p></div>
    ${planBlock(d)}
    <div class="card"><div class="k">Ранний сигнал ${term("перекос", "перекоса")}</div>
      <p style="font-size:.92rem;color:var(--ink-2)">${esc(d.watch)}</p></div>

    <div class="card">
      <div class="k">Ваш первый шаг</div>
      <input type="text" id="first" value="${esc(S.firstStep)}" placeholder="Одно конкретное действие с датой">
    </div>
  </div>
  <div class="acts">
    <button class="go" id="tosheet" ${S.approachId ? "" : "disabled"}>Собрать карту</button>
    <button class="back" data-goto="refine">Назад к прочтениям</button>
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
  <div class="eyebrow">Шаг 4 · Работа с типом «${RU[t]}»</div>
  <h1 style="margin-top:10px">${t === "problem" ? "Проблема закрывается решением" : "Дилемма закрывается выбором"}</h1>
  <div class="stack" style="margin-top:22px">${body}</div>
  <div class="acts">
    <button class="go" id="tosheet">Собрать карту</button>
    <button class="back" data-goto="refine">Назад к прочтениям</button>
    ${parkButton()}
  </div>`;
}

function viewSheet() {
  const t = S.chosenType, d = S.decide;
  const date = new Date().toLocaleDateString("ru-RU");
  let body = "";
  if (t === "paradox" && S.refine.axes?.[S.axisIndex]) {
    const ax = S.refine.axes[S.axisIndex];
    const a = d.approaches.find(x => x.id === S.approachId) || d.approaches[0];
    body = `
      <div class="sect"><div class="k">Полюса</div>
        <div class="poles">
          <div class="pole a"><div class="pk">Полюс A</div><h4>${esc(ax.a)}</h4>
            <p><b>Даёт.</b> ${esc(ax.gives_a)}</p><p class="bad"><b>Перекос.</b> ${esc(ax.over_a)}</p></div>
          <div class="pole b"><div class="pk">Полюс B</div><h4>${esc(ax.b)}</h4>
            <p><b>Даёт.</b> ${esc(ax.gives_b)}</p><p class="bad"><b>Перекос.</b> ${esc(ax.over_b)}</p></div>
        </div></div>
      <div class="sect"><div class="k">Где мы сейчас</div>
        <div class="beam-lbl"><span>${esc(ax.a)}</span><span>${esc(ax.b)}</span></div>
        <input type="range" min="0" max="100" value="${S.position}" disabled aria-hidden="true">
        <p class="note" style="margin-top:10px">${esc(ax.optimum.exists ? ax.optimum.where : "Устойчивого оптимума нет. " + ax.optimum.where)}</p></div>
      <div class="sect"><div class="k">Выбранный подход · ${esc(APPR_NAME[a.id])}</div>
        <p style="font-size:.92rem;color:var(--ink-2)">${esc(a.why)}</p>
        <ul class="qs">${a.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul>
        <p style="margin-top:14px"><b>Первый шаг.</b> ${esc(S.firstStep || a.first_step)}</p></div>
      ${d.plan?.length ? `<div class="sect"><div class="k">Что дальше</div>
        <div class="plan">${d.plan.map(p => `<div><div class="h">${esc(p.horizon)}</div>
          <div class="w">${esc(p.what)}</div>
          <div class="d">Сделано, когда: ${esc(p.done_when)}</div></div>`).join("")}</div></div>` : ""}
      ${d.rhythm ? `<div class="sect"><div class="k">Ритм и держатель</div><div class="meta">
        <div><b>Как часто</b><span>${esc(d.rhythm.cadence)}</span></div>
        <div><b>Кто держит</b><span>${esc(d.rhythm.holder)}</span></div>
        <div><b>Куда пристегнуть</b><span>${esc(d.rhythm.where)}</span></div>
        <div><b>Первый пересмотр</b><span>${esc(d.rhythm.first_review)}</span></div></div></div>` : ""}
      <div class="sect"><div class="k">Ранний сигнал перекоса</div>
        <p style="font-size:.92rem;color:var(--ink-2)">${esc(d.watch)}</p></div>`;
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
      <div><h2>${esc(S.refine.axes?.[S.axisIndex] ? S.refine.axes[S.axisIndex].a + " — " + S.refine.axes[S.axisIndex].b : S.read.restated)}</h2>
        <p class="note">${GLYPH(t)}${RU[t]} · способ: ${VERB[t]}</p></div>
      <span class="note" style="font-family:var(--mono);font-size:.7rem">${date}</span>
    </div>
    <div class="sect"><div class="k">Ситуация</div><p style="font-size:.93rem">${esc(S.read.restated)}</p></div>
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
  <p class="lede">Материал исследования Школы управления СКОЛКОВО. Всё, на что опирается агент
  в соседней вкладке, лежит здесь — включая источники.</p>
  <div class="toc">${[["types", "Три типа"], ["cost", "Цена ошибки"], ["crit", "Критерии"],
    ["tests", "Тесты"], ["appr", "Четыре подхода"], ["algo", "Алгоритм"], ["pos", "Две позиции"],
    ["pass", "Шесть паспортов"], ["lib", "34 парадокса"], ["cases", "Кейсы"], ["src", "Источники"]]
    .map(([id, n]) => `<button data-jump="t-${id}">${n}</button>`).join("")}</div>

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
    ${c.examples.length ? `<ul class="qs" style="margin-top:10px">${c.examples.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
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

  ${sec("pass", "Шесть паспортов по сетке из 11 параметров", T.passports.map(p => `<div class="card">
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
      <div><b>Типичная ошибка</b><span>${esc(p.mistake)}</span></div></div></div>`).join(""))}

  ${sec("lib", "34 организационных парадокса с первоисточниками", `<div class="card flat scroll">
    <table class="lib"><thead><tr><th>№</th><th>Парадокс</th><th>Полюса</th><th>Smith &amp; Lewis</th><th>Источник</th></tr></thead>
    <tbody>${T.library.map(p => `<tr><td class="n">${p.n}</td>
      <td><b>${esc(p.ru)}</b><br><span class="note">${esc(p.en)}</span></td>
      <td>${esc(p.a)}<br><span class="note">против</span><br>${esc(p.b)}</td>
      <td>${esc(p.sl)}</td><td class="src">${esc(p.src)}</td></tr>`).join("")}</tbody></table></div>`)}

  ${sec("cases", "Библиотека кейсов", T.cases.map(c => `<div class="caseb ${c.sign === "+" ? "pos" : "neg"}" id="${esc(caseAnchor(c.company))}">
    <div class="tag">${c.sign === "+" ? "позитивный" : "негативный"} · ${esc(c.axis)}${c.region ? " · " + esc(c.region) : ""}</div>
    <h4>${esc(c.company)}</h4><p style="color:var(--ink-2)">${esc(c.text)}</p>
    ${c.move ? `<p style="margin-top:8px"><b>Ключевой ход.</b> ${esc(c.move)}</p>` : ""}</div>`).join(""))}

  ${sec("src", "Источники в архиве проекта", `<div class="card flat"><div class="meta">
    ${T.sources.map(s => `<div><b style="flex-basis:280px;font-family:var(--mono);text-transform:none;letter-spacing:0;font-size:.72rem">${esc(s.file)}</b><span>${esc(s.gives)}</span></div>`).join("")}
    </div></div>`)}`;
}

function viewHistory() {
  const list = histLoad();
  const STAGE = { read: "чтение", refine: "прочтения", decide: "решения", sheet: "карта собрана" };
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
            <span class="flag">${STAGE[e.stage] || e.stage}</span>
            ${e.stage !== "sheet" ? '<span class="flag partly">не завершён</span>' : ""}
            ${e.axisName ? `<span class="flag">${esc(e.axisName)}</span>` : ""}
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

function render() {
  const d = $("#view-diag"), h = $("#view-history"), t = $("#view-theory");
  d.hidden = view !== "diag"; h.hidden = view !== "history"; t.hidden = view !== "theory";
  document.querySelectorAll("#nav button").forEach(b =>
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  histBadge();
  if (view === "history") { h.innerHTML = viewHistory(); return; }
  if (view !== "diag") return;
  d.innerHTML =
    S.step === "input" ? viewInput() :
    S.step === "read" ? viewRead() :
    S.step === "refine" ? viewRefine() :
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
    if (data) { S.read = data; S.answers = {}; S.free = {}; histUpsert("read"); render(); window.scrollTo({ top: 0 }); }
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
      S.read = data; S.answers = {}; S.step = "read";
      S.runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
      histUpsert("read");
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
      S.refine = data; S.axisIndex = 0;
      S.position = data.axes?.[0]?.position?.value ?? 50;
      S.step = "refine"; histUpsert("refine");
      render(); window.scrollTo({ top: 0 });
    }
    return;
  }

  const axb = e.target.closest("[data-axis]");
  if (axb) {
    S.axisIndex = Number(axb.dataset.axis);
    S.position = S.refine.axes[S.axisIndex].position.value;
    histUpsert(S.decide ? "decide" : "refine"); render(); return;
  }

  const nameBtn = e.target.closest("[data-name]");
  if (nameBtn) {
    S.chosenType = nameBtn.dataset.name;
    const step = "decide_" + S.chosenType;
    const ctx = { situation: S.situation, read: S.read, refine: S.refine,
      chosenType: S.chosenType, chosenAxis: S.refine.axes?.[S.axisIndex] || null };
    const data = await run(step, ctx);
    if (data) {
      S.decide = data; S.approachId = data.recommended || null; S.step = "decide";
      histUpsert("decide"); render(); window.scrollTo({ top: 0 });
    }
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
  if (e.target.id === "beam") {
    S.position = Number(e.target.value);
    const ax = S.refine.axes[S.axisIndex];
    const p = S.position;
    $("#beamread").textContent = p < 35 ? `Перекос к «${ax.a.toLowerCase()}» — ${100 - p} против ${p}`
      : p > 65 ? `Перекос к «${ax.b.toLowerCase()}» — ${p} против ${100 - p}`
      : `Примерно в равновесии — ${100 - p} против ${p}`;
  }
});

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
