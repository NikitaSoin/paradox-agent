/**
 * Приёмник ответов тренажёра «Теория парадоксов» → Google-таблица.
 *
 * Установка (один раз):
 *  1. Создать Google-таблицу. Меню «Расширения» → «Apps Script» (англ.: Extensions → Apps Script).
 *     Нет такого меню — открыть script.google.com → «Новый проект» и заполнить SPREADSHEET_ID ниже.
 *  2. Стереть всё в Code.gs, вставить этот файл целиком.
 *  3. Ниже в SECRET вписать своё слово-пароль (то же — в SHEETS_SECRET на хостинге).
 *  4. Сохранить. Синяя кнопка «Развернуть» справа вверху → «Новое развертывание» →
 *     шестерёнка у «Выберите тип» → «Веб-приложение»:
 *       Выполнять от имени — «Я», У кого есть доступ — «Все». Разрешить доступ.
 *  5. Скопировать URL веб-приложения (…/exec) → SHEETS_URL на хостинге.
 *
 * Если потом правите скрипт: Развернуть → Управление развёртываниями → карандаш →
 * Версия «Новая» → Развернуть. Иначе по адресу работает старая версия.
 *
 * Одна строка = один разбор. Строка находится по ID разбора и обновляется
 * на каждом шаге; контакты дописываются в ту же строку.
 */

const SECRET = "ЗАМЕНИТЕ-НА-СВОЙ-ПАРОЛЬ";

// Нужен, только если скрипт создан отдельно на script.google.com, а не из меню таблицы.
// Это кусок адреса таблицы между /d/ и /edit:
// https://docs.google.com/spreadsheets/d/ВОТ_ЭТО/edit
const SPREADSHEET_ID = "";
const SHEET_NAME = "Ответы";

// Порядок колонок. Ключ — как присылает сервер, значение — заголовок в таблице.
// Новые колонки добавлять только в конец: старые строки не сдвинутся.
const COLUMNS = [
  ["id", "ID разбора"],
  ["created", "Начат"],
  ["updated", "Обновлён"],
  ["stage", "Дошёл до шага"],
  ["demo", "Демо-режим"],
  ["consent", "Галочка «анонимно учесть»"],
  ["industry", "Отрасль"],
  ["role", "Должность (шаг 1)"],
  ["situation", "Описание ситуации"],
  ["restated", "Ситуация одной фразой (модель)"],
  ["challenges", "Вызовы в ситуации (модель)"],
  ["hypothesis", "Гипотеза модели"],
  ["answers", "Вопросы и ответы"],
  ["extra", "Дорассказал"],
  ["chosen_type", "Тип, выбранный участником"],
  ["axes", "Оси и положение на них"],
  ["approaches", "Выбранные подходы"],
  ["first_step", "Первый шаг (участник)"],
  ["decide", "Итог модели (JSON)"],
  ["share_contacts", "Готов поделиться контактами"],
  ["last_name", "Фамилия"],
  ["first_name", "Имя"],
  ["company", "Компания"],
  ["position", "Должность (контакты)"],
  ["email", "Email"],
];

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad json" }); }
  if (data.secret !== SECRET) return reply({ ok: false, error: "forbidden" });
  if (!data.record || !data.record.id) return reply({ ok: false, error: "no id" });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ensureSheet();
    const rec = data.record;
    const found = sheet.getRange("A:A").createTextFinder(String(rec.id)).matchEntireCell(true).findNext();
    const rowIdx = found ? found.getRow() : sheet.getLastRow() + 1;
    const range = sheet.getRange(rowIdx, 1, 1, COLUMNS.length);
    const row = found ? range.getValues()[0] : COLUMNS.map(() => "");
    // Пишем только присланные поля: запись контактов не стирает ответы, и наоборот.
    COLUMNS.forEach(([key], i) => {
      if (rec[key] === undefined || rec[key] === null) return;
      let v = rec[key];
      if (typeof v === "object") v = JSON.stringify(v);
      if (typeof v === "string" && v.length > 49000) v = v.slice(0, 49000) + "…"; // лимит ячейки 50 000
      // Текст, начинающийся с = + - @, таблица приняла бы за формулу.
      if (typeof v === "string" && /^[=+\-@]/.test(v)) v = "'" + v;
      row[i] = v;
    });
    range.setValues([row]);
    return reply({ ok: true, row: rowIdx });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply({ ok: true, service: "paradox-sheet" });
}

function ensureSheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  const head = sheet.getRange(1, 1, 1, COLUMNS.length);
  const titles = COLUMNS.map(c => c[1]);
  if (head.getValues()[0].join("|") !== titles.join("|")) {
    head.setValues([titles]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
