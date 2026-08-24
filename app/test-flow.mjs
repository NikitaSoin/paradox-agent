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
const raw = () => JSON.parse(window.localStorage.getItem("paradox.history.v1") || "[]");

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

console.log("\n2. Шаг 2 · Вопросы (только вопросы, без гипотезы)");
must(q("#refine"), "кнопка «Уточнить»");
must(!q("#view-diag").innerHTML.includes("Рабочая гипотеза"), "гипотеза НЕ показана на шаге вопросов");
must(!q("#view-diag").innerHTML.includes("Что означают три типа"), "справка о трёх типах убрана из шага 2");
const opts = document.querySelectorAll("[data-q]");
must(opts.length > 0, `варианты ответов отрисованы (${opts.length})`);
must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");
must(q(".tile"), "ситуация вынесена в плитку, а не в заголовок");
must(document.querySelectorAll(".chal > div").length === 3, "разбор ситуации на три вызова");
must(q("[data-focus]"), "неосновной вызов можно выбрать для разбора");
must(q(".card.hl"), "блок «зачем эти вопросы» подсвечен");
must(document.querySelectorAll("[data-free]").length === opts.length / 3 || document.querySelectorAll("[data-free]").length > 0, "у каждого вопроса есть поле своего ответа");
must(q("#extra"), "поле «дорасскажите своими словами»");
must(document.querySelectorAll("#view-diag .i").length >= 3, `подсказки «i» проставлены (${document.querySelectorAll("#view-diag .i").length})`);
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

console.log("\n3. Шаг 3 · Три прочтения (гипотеза и называние здесь)");
must(q("#view-diag").innerHTML.includes("Рабочая гипотеза"), "гипотеза показана ровно один раз, на этом шаге");
must(document.querySelectorAll(".reading").length === 3, "три прочтения отрисованы");
must(!q("#view-diag").innerHTML.includes("Что тогда делать"), "поле «что тогда делать» убрано из прочтений");
must(!q("#beam"), "оси на шаге прочтений ещё нет — она появляется только для парадокса");
must(!q("#view-diag").innerHTML.includes("Кейсы из библиотеки"), "кейсы ещё не показаны на шаге прочтений");
must(document.querySelectorAll("[data-name]").length === 3, "три кнопки называния — уже здесь, на шаге прочтений");
must(q("#view-diag").innerHTML.includes("Назвать может только тот"), "формулировка про выбор пользователя перенесена на этот шаг");
must(document.querySelectorAll(".reading .i").length === 3, "подсказки «i» есть и у трёх прочтений, не только на шаге вопросов");
must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");

for (const type of ["paradox", "problem", "dilemma"]) {
  console.log(`\n4.${type} — ветка «${type}»`);
  click(q(`[data-name="${type}"]`));
  await wait(140);

  if (type === "paradox") {
    must(!q("#tosheet"), "парадокс сначала ведёт на шаг оси, не сразу к решениям");
    must(!q(".beam"), "отдельных балок по осям нет — при нескольких парадоксах только плоскость");
    must(q(".plane-grid"), "координатная плоскость показана вместо выбора одной оси");
    must(document.querySelectorAll(".plane-dot").length === 1, "на плоскости одна точка положения");
    must(q(".plane-read"), "под плоскостью — текстовое чтение положения по обеим осям");
    must(!q("#view-diag").innerHTML.includes("выберите разбираемую"), "выбор одной оси из нескольких убран — работаем сразу со всеми");
    must(!q(".scale"), "отдельной расшифровки шкалы по осям нет — она была только в убранных балках");
    must(!q("#view-diag").innerHTML.includes("Паспорт натяжения"), "паспорт натяжения убран с шага оси — он теперь в конце");
    must(!q("#view-diag").innerHTML.includes("Оптимум"), "оптимум убран с шага оси — он теперь в конце");
    must(!q("[data-name]"), "называние типа уже сделано — на шаге оси кнопок нет");
    must(!q("#view-diag").innerHTML.includes("Кейсы из библиотеки"), "кейсы убраны с шага оси");
    must(q("#view-diag").innerHTML.includes("подвиньте ползунок") || q("#view-diag").innerHTML.includes("потяните точку"), "подсказка про ручную правку положения есть");
    must(document.querySelectorAll(".pole .i").length >= 2, "подсказки «i» есть у полюсов и на шаге оси");
    must(q("#toDecideParadox") && !q("#toDecideParadox").disabled, "агент направлений решений запустился в фоне сам, без клика — кнопка уже разблокирована");
    click(q("#toDecideParadox"));
    await wait(20);
  }

  must(q("#tosheet"), "кнопка «Собрать карту»");
  must(!q("#view-diag").innerHTML.includes("undefined"), "в разметке нет undefined");
  if (type === "paradox") {
    must(document.querySelectorAll(".appr").length === 4, "четыре подхода");
    must(q(".appr.rec"), "рекомендованный подход выделен");
    must(!document.querySelector(".plan"), "план дальнейших шагов убран");
    must(!q("#view-diag").innerHTML.includes("Ритм и"), "ритм и держатель убраны из шага решений");
    must(!q("#view-diag").innerHTML.includes("Ранний сигнал"), "ранний сигнал перекоса убран из шага решений");
    must(!q("#view-diag").innerHTML.includes("Паспорт"), "внутреннее «паспорт» не всплывает в обосновании подходов");
    must(q(".appr.rec").innerHTML.includes("Почему я рекомендую именно это"), "обоснование рекомендации перенесено внутрь выбранного подхода");
    must(!q(".appr .caseb"), "кейсы убраны из карточек подходов на шаге решений");
    must(!q("#view-diag").innerHTML.includes("Первый шаг"), "«первый шаг» убран из карточек подходов");
    must(!q("#first"), "поле «ваш первый шаг» убрано из шага решений");
    click(document.querySelector('[data-appr="space"]'));
    await wait(40);
  }
  click(q("#tosheet"));
  await wait(60);
  must(q(".sheet"), "карта собрана");
  must(!q(".sheet").innerHTML.includes("undefined"), "в карте нет undefined");
  must(!q(".sheet").innerHTML.includes("Ситуация</div>"), "верхний блок «Ситуация» убран из карты");
  if (type === "paradox") {
    must(!q(".sheet .plan"), "плана нет и в собранной карте");
    must(!q(".sheet").innerHTML.includes("Ритм и держатель"), "ритма и держателя нет в карте");
    must(!q(".sheet").innerHTML.includes("Ранний сигнал перекоса"), "сигнала перекоса нет в карте");
    must(q(".sheet").innerHTML.includes("Полюса"), "карта начинается сразу с полюсов");
    must(q(".sheet .plane-grid"), "координатная плоскость собрана и в финальной карте, не только на шаге 4");
    must(document.querySelectorAll(".sheet .plane-target").length >= 1, "на плоскости в карте отмечен оптимум");
    must(q(".sheet .plane-traj"), "от текущего положения к оптимуму проведена траектория");
    must(q(".sheet").innerHTML.includes("Паспорт натяжения"), "паспорт натяжения перенесён в конец, в карту");
    must(q(".sheet").innerHTML.includes("держим коридор") || q(".sheet").innerHTML.includes("Куда целиться"), "оптимум перенесён в конец, в карту");
    must(document.querySelectorAll(".sheet [data-axis]").length === 2, "над паспортом — переключатель, каким парадоксом смотрим (две оси)");
    must(q(".sheet").innerHTML.includes("Парадокс 1") && q(".sheet").innerHTML.includes("Парадокс 2"), "переключатель подписан по номерам — Парадокс 1, Парадокс 2");
    must(q(".sheet-h h2").textContent.trim().startsWith("2 парадокса"), "заголовок карты краткий — без перечисления названий обеих осей");
    must(q(".sheet-h h2 .i"), "подсказка «i» есть и у типа вызова в заголовке собранной карты");
    must(document.querySelectorAll(".sheet .pole .i").length >= 2, "подсказки «i» есть у полюсов и в собранной карте");
    must(!q(".sheet").innerHTML.includes("Первый шаг"), "«первый шаг» убран и из собранной карты");
  }
  click(q('[data-goto="decide"]'));
  await wait(40);
  if (type === "paradox") { click(q('[data-goto="axis"]')); await wait(40); }
  click(q('[data-goto="readings"]'));
  await wait(40);
  must(q('[data-name="paradox"]'), "возврат к прочтениям и называнию работает");
}

console.log("\n6. Вкладка «Теория»");
click(document.querySelector('#nav [data-view="theory"]'));
await wait(120);
const th = q("#view-theory").innerHTML;
must(q("#view-theory .k") && q("#view-theory .k").textContent === "Содержание", "в начале справочника есть явное «Содержание»");
must(document.querySelectorAll("#view-theory .book-toc button").length === 8, "содержание — по строке на раздел, в книжном формате");
must(document.querySelectorAll("#view-theory .book-toc button b").length === 8 &&
     document.querySelectorAll("#view-theory .book-toc button span").length === 8, "у каждой строки содержания есть название и пояснение, о чём раздел");
must(!q("#view-theory .toc"), "старый ряд кнопок-чипов убран");
must(document.querySelectorAll("#view-theory .trio figure").length === 3, "три вводные картинки — проблема, дилемма, парадокс");
must(!th?.includes("πρόβλημα") && !th?.includes("δίλημμα") && !th?.includes("παράδοξον"), "греко-латинские этимологии убраны из определений");
must(document.querySelectorAll("#view-theory .trio img").length === 3, "у всех трёх картинок есть src");
must(!th.includes("34 организационных парадокса"), "раздел с 34 парадоксами и первоисточниками убран");
must(!q("table.lib"), "таблицы 34 парадоксов больше нет");
must(!th.includes("Библиотека кейсов"), "раздел «Библиотека кейсов» убран");
must(!th.includes("Источники в архиве"), "раздел «Источники в архиве проекта» убран");
must(th.includes("Примеры парадоксов"), "паспорта переименованы в «Примеры парадоксов»");
must(!th.includes("exploit"), "11 примеров структурного критерия убраны из плитки");
must(!th.includes("undefined"), "в теории нет undefined");

console.log("\n7. История");
must(raw().length === 1, "прогон сохранён в историю");
must(raw()[0].stage === "sheet" && raw()[0].chosenType === "dilemma", "сохранены стадия и названный тип");
click(document.querySelector('#nav [data-view="history"]'));
await wait(60);
must(document.querySelectorAll(".hrow").length === 1, "запись отрисована");
must(q(".hrow .flag.long"), "длинное название осей в плитке истории переносится на новую строку, а не вылезает за край");
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
must(raw()[0].stage === "questions", "незавершённый прогон тоже сохраняется, на шаге вопросов");
click(q(".hrow [data-del]")); await wait(40);
must(document.querySelectorAll(".hrow").length === 1, "запись удаляется");

console.log("\n8. Отложить и начать новый");
click(q("#restart")); await wait(40);
q("#sit").value = "Третий кейс: держим свой склад ради контроля сроков, но он съедает всю маржу на низком сезоне.";
click(q("#start")); await wait(140);
must(q("#park"), "кнопка «Отложить и начать новый» есть на шаге вопросов");
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

console.log("\n9. Тема");
click(document.querySelector('[data-theme-set="dark"]'));
must(document.documentElement.getAttribute("data-theme") === "dark", "тёмная ставится");
must(window.localStorage.getItem("paradox.theme") === "dark", "выбор сохраняется");
must(document.querySelector('[data-theme-set="dark"]').getAttribute("aria-pressed") === "true", "кнопка подсвечена");
click(document.querySelector('[data-theme-set="light"]'));
must(document.documentElement.getAttribute("data-theme") === "light", "светлая ставится");
click(document.querySelector('[data-theme-set="auto"]'));
must(!document.documentElement.hasAttribute("data-theme"), "авто снимает атрибут");
must(window.localStorage.getItem("paradox.theme") === null, "авто чистит хранилище");

console.log("\n10. Сброс");
click(q("#restart"));
await wait(40);
must(q("#sit") && q("#sit").value === "", "форма очищена");

if (errors.length) { console.log("\nОШИБКИ В КОНСОЛИ:", errors); process.exit(1); }
console.log("\n✓ Весь сценарий проходит\n");
