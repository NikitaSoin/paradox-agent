// Прогон всего сценария в jsdom против демо-данных: ловит ошибки шаблонов
// (обращение к несуществующим полям) до того, как их увидит человек.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { mockStep } from "./mock.mjs";
import { THEORY } from "./theory.mjs";

const html = readFileSync("public/index.html", "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;
global.Node = window.Node; global.TextDecoder = TextDecoder;
window.scrollTo = () => {};
window.confirm = () => true;
window.print = () => {};

// Заглушка сети: /api/config, /api/theory и SSE-поток /api/step из демо-данных.
const fakeFetch = async (url, opts) => {
  if (url === "/api/config") return { ok: true, json: async () => ({ live: false, model: "claude-opus-5" }) };
  if (url === "/api/theory") return { ok: true, json: async () => THEORY };
  if (url === "/api/step") {
    const { step } = JSON.parse(opts.body);
    const payload = `event: thinking\ndata: ${JSON.stringify({ text: "…" })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ data: mockStep(step), demo: true })}\n\n`;
    const bytes = new TextEncoder().encode(payload);
    let sent = false;
    return { ok: true, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { value: bytes, done: false }) }) } };
  }
  throw new Error("не заглушено: " + url);
};
global.fetch = fakeFetch;
window.fetch = fakeFetch;
window.TextDecoder = TextDecoder;
window.TextEncoder = TextEncoder;

const code = readFileSync("public/app.js", "utf8");
new window.Function(code.replace(/^"use strict";/, ""))();

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const click = (el) => { if (!el) throw new Error("нет элемента для клика"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
const must = (cond, msg) => { if (!cond) throw new Error("ПРОВАЛ: " + msg); console.log("  ok — " + msg); };

function opts0Questions() {
  return JSON.parse(window.localStorage.getItem("__q") || "0") || document.querySelectorAll(".card [data-free]").length;
}
const errors = [];
window.addEventListener("error", e => errors.push("error: " + e.message));
window.addEventListener("unhandledrejection", e => errors.push("rejection: " + (e.reason?.message || e.reason)));
process.on("unhandledRejection", r => errors.push("node rejection: " + (r?.message || r)));

await wait(60);

console.log("\n1. Экран входа");
must(q("#sit"), "поле ввода ситуации");
q("#sit").value = "Совет требует сократить расходы на 20%, но единственный источник роста — новые продукты, и режем мы их.";
click(q("#start"));
await wait(120);

console.log("\n2. Чтение и вопросы");
must(q("#refine"), "кнопка «Уточнить»");
must(document.querySelectorAll(".crit > div").length === 6, "шесть критериев в таблице");
const opts = document.querySelectorAll("[data-q]");
must(opts.length > 0, `варианты ответов отрисованы (${opts.length})`);
must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");
must(q(".tile"), "ситуация вынесена в плитку, а не в заголовок");
must(document.querySelectorAll(".chal > div").length === 3, "разбор ситуации на три вызова");
must(q("[data-focus]"), "неосновной вызов можно выбрать для разбора");
must(q(".card.hl"), "блок «зачем эти вопросы» подсвечен");
must(document.querySelectorAll("[data-free]").length === opts0Questions(), "у каждого вопроса есть поле своего ответа");
must(q("#extra"), "поле «дорасскажите своими словами»");
must(document.querySelectorAll("#view-diag .i").length >= 5, `подсказки «i» проставлены (${document.querySelectorAll("#view-diag .i").length})`);
must(document.querySelectorAll('[data-theory]').length >= 2, "ссылки в теорию есть");
opts.forEach((b, i) => { if (i % 3 === 0) click(b); });
await wait(40);
const free = document.querySelector("[data-free]");
free.value = "Свой развёрнутый ответ, которого не было в вариантах";
free.dispatchEvent(new window.Event("input", { bubbles: true }));
await wait(30);
must(q("#refine").textContent.includes("ответов"), "счётчик ответов пересчитался");
q("#extra").value = "Дополнительная деталь про ситуацию";
q("#extra").dispatchEvent(new window.Event("input", { bubbles: true }));

const iBtn = document.querySelector("#view-diag .i");
click(iBtn); await wait(30);
must(q(".pop"), "подсказка открывается");
must(q(".pop [data-theory]"), "из подсказки есть переход в теорию");
click(document.body); await wait(20);
must(!q(".pop"), "подсказка закрывается по клику вне");

click(q("#refine"));
await wait(140);

console.log("\n3. Три прочтения");
must(document.querySelectorAll(".reading").length >= 3, "три прочтения отрисованы");
must(q("#beam"), "балка натяжения");
must(document.querySelectorAll(".scale div").length === 3, "что означают положения на оси");
must(document.querySelectorAll("[data-name]").length === 3, "три кнопки называния");
must(q("#view-diag").innerHTML.includes("Кейсы из библиотеки"), "кейсы показаны");
must(q("#view-diag").innerHTML.includes("Чем это про вас"), "у кейса есть суть и связь с ситуацией");
must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");

for (const type of ["paradox", "problem", "dilemma"]) {
  console.log(`\n4.${type} — ветка «${type}»`);
  click(q(`[data-name="${type}"]`));
  await wait(140);
  must(q("#tosheet"), "кнопка «Собрать карту»");
  must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");
  if (type === "paradox") {
    must(document.querySelectorAll(".appr").length === 4, "четыре подхода");
    must(q(".appr.rec"), "рекомендованный подход выделен");
    must(document.querySelectorAll(".plan > div").length >= 3, "план дальнейших шагов показан");
    must(q("#view-diag").innerHTML.includes("Ритм") && q("#view-diag").innerHTML.includes("держ"), "ритм и держатель показаны");
    must(document.querySelectorAll(".caseb [data-theory]").length >= 1, "из кейса можно перейти к полному тексту");
    click(document.querySelector('[data-appr="space"]'));
    await wait(40);
    q("#first").value = "Вынести ядро развития в отдельный P&L до 30 числа";
  }
  click(q("#tosheet"));
  await wait(60);
  must(q(".sheet"), "карта собрана");
  must(!q(".sheet").innerHTML.includes("undefined"), "в карте нет undefined");
  click(q('[data-goto="decide"]'));
  await wait(40);
  click(q('[data-goto="refine"]'));
  await wait(40);
  must(q('[data-name="paradox"]'), "возврат к называнию работает");
}

console.log("\n5. Вкладка «Теория»");
click(document.querySelector('#nav [data-view="theory"]'));
await wait(120);
const th = q("#view-theory").innerHTML;
must(th.includes("34 организационных парадокса"), "раздел с 34 парадоксами");
must(document.querySelectorAll("table.lib tbody tr").length === 34, "34 строки в таблице");
must(document.querySelectorAll("#view-theory .caseb").length === 29, "29 кейсов");
must(!th.includes("undefined"), "в теории нет undefined");
must(document.querySelectorAll('#view-theory [id^="case-"]').length >= 20, "у кейсов в справочнике есть якоря");

console.log("\n6. История");
const raw = () => JSON.parse(window.localStorage.getItem("paradox.history.v1") || "[]");
must(raw().length === 1, "прогон сохранён в историю");
must(raw()[0].stage === "sheet" && raw()[0].chosenType === "dilemma", "сохранены стадия и названный тип");
click(document.querySelector('#nav [data-view="history"]'));
await wait(60);
must(document.querySelectorAll(".hrow").length === 1, "запись отрисована");
must(!q("#view-history").innerHTML.includes("undefined"), "в истории нет undefined");
must(q("#histCount").textContent === "1" && !q("#histCount").hidden, "счётчик в навигации");
click(q(".hrow"));
await wait(60);
must(!q("#view-diag").hidden && q(".sheet"), "запись открылась на собранной карте");

click(q("#restart")); await wait(40);
q("#sit").value = "Держим двух поставщиков ради надёжности, но объём размывается и оба дают нам худшую цену.";
click(q("#start")); await wait(140);
click(document.querySelector('#nav [data-view="history"]')); await wait(60);
must(document.querySelectorAll(".hrow").length === 2, "второй прогон добавился отдельной записью");
must(raw()[0].stage === "read", "незавершённый прогон тоже сохраняется");
click(q(".hrow [data-del]")); await wait(40);
must(document.querySelectorAll(".hrow").length === 1, "запись удаляется");

console.log("\n7. Отложить и начать новый");
click(q("#restart")); await wait(40);
q("#sit").value = "Третий кейс: держим свой склад ради контроля сроков, но он съедает всю маржу на низком сезоне.";
click(q("#start")); await wait(140);
must(q("#park"), "кнопка «Отложить и начать новый» есть на шаге чтения");
const before = raw().length;
click(q("#park")); await wait(60);
must(q("#sit"), "после отложения открыт экран ввода");
must(q("#sit").value === "", "поле ввода пустое");
must(raw().length === before, "отложенный разбор остался в истории, не задвоился");
must(q(".card.hl") && q("#view-diag").innerHTML.includes("Разбор отложен"), "показано уведомление о сохранении");
must(q("[data-open-hist]"), "из уведомления можно открыть запись в истории");
click(q("[data-open-hist]")); await wait(60);
must(!q("#view-diag").hidden && q("#refine"), "запись открылась на том шаге, где остановились");
click(q("#park")); await wait(60);
click(document.querySelector('#nav [data-view="history"]')); await wait(60);
must(q("#view-history").innerHTML.includes("не завершён"), "незавершённые помечены в списке");

console.log("\n8. Тема");
click(document.querySelector('[data-theme-set="dark"]'));
must(document.documentElement.getAttribute("data-theme") === "dark", "тёмная ставится");
must(window.localStorage.getItem("paradox.theme") === "dark", "выбор сохраняется");
must(document.querySelector('[data-theme-set="dark"]').getAttribute("aria-pressed") === "true", "кнопка подсвечена");
click(document.querySelector('[data-theme-set="light"]'));
must(document.documentElement.getAttribute("data-theme") === "light", "светлая ставится");
click(document.querySelector('[data-theme-set="auto"]'));
must(!document.documentElement.hasAttribute("data-theme"), "авто снимает атрибут");
must(window.localStorage.getItem("paradox.theme") === null, "авто чистит хранилище");

console.log("\n9. Сброс");
click(q("#restart"));
await wait(40);
must(q("#sit") && q("#sit").value === "", "форма очищена");

if (errors.length) { console.log("\nОШИБКИ В КОНСОЛИ:", errors); process.exit(1); }
console.log("\n✓ Весь сценарий проходит\n");
