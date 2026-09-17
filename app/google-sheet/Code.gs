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
  ["decide", "Итог модели"],
  ["share_contacts", "Готов поделиться контактами"],
  ["last_name", "Фамилия"],
  ["first_name", "Имя"],
  ["company", "Компания"],
  ["position", "Должность (контакты)"],
  ["email", "Email"],
  ["restated_user", "Ситуация одной фразой (поправил участник)"],
  ["pdf_url", "PDF карты"],
];

// Папка на Google Диске владельца скрипта, куда складываются PDF карт.
const PDF_FOLDER = "Теория парадоксов — карты";

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: "bad json" }); }
  if (data.secret !== SECRET) return reply({ ok: false, error: "forbidden" });
  if (data.action === "batch") return writeRows(data.records);
  if (data.action === "purge") return purgeRows(String(data.prefix || ""));
  if (data.action === "get") return readRow(data.id);
  if (data.action === "mail") return sendMail(data);
  if (data.action === "store_pdf") return storePdf(data);
  if (data.action === "last") return readLast(Number(data.n) || 3);
  if (!data.record || !data.record.id) return reply({ ok: false, error: "no id" });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const rowIdx = writeRow(ensureSheet(), data.record);
    return reply({ ok: true, row: rowIdx });
  } catch (err) {
    // Без этого Google отдаёт вместо ответа HTML-страницу, и причину не видно.
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Письмо участнику с его картой. Уходит с Gmail владельца скрипта.
function sendMail(data) {
  try {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(data.to || ""))) return reply({ ok: false, error: "bad email" });
    if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: "quota" });
    const msg = { to: data.to, subject: String(data.subject || "Теория парадоксов"),
      body: String(data.body || "").slice(0, 60000), name: "Теория парадоксов · СКОЛКОВО" };
    if (data.pdf) msg.attachments = [pdfBlob(data.pdf, data.filename)];
    MailApp.sendEmail(msg);
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function pdfBlob(base64, filename) {
  return Utilities.newBlob(Utilities.base64Decode(base64), "application/pdf", String(filename || "karta.pdf"));
}

// Копия PDF в папку на Диске; ссылка — в строку разбора. Повторная карта того же разбора
// заменяет прежний файл, а не копится рядом.
function storePdf(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const id = String(data.id || "");
    if (!id || !data.pdf) return reply({ ok: false, error: "no data" });
    const folders = DriveApp.getFoldersByName(PDF_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PDF_FOLDER);
    const name = id + " · " + String(data.filename || "karta.pdf");
    const old = folder.searchFiles("title contains '" + id.replace(/'/g, "") + "'");
    while (old.hasNext()) old.next().setTrashed(true);
    const file = folder.createFile(pdfBlob(data.pdf, name));

    const sheet = ensureSheet();
    const found = sheet.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();
    if (found) {
      const col = COLUMNS.findIndex(c => c[0] === "pdf_url") + 1;
      sheet.getRange(found.getRow(), col).setValue(file.getUrl());
    }
    return reply({ ok: true, url: file.getUrl() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Чтение — для проверки, что именно легло в таблицу. Только с паролем.
function rowToObject(values) {
  const o = {};
  COLUMNS.forEach(([key], i) => { if (values[i] !== "") o[key] = values[i]; });
  return o;
}
function readRow(id) {
  const sheet = ensureSheet();
  const found = sheet.getRange("A:A").createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return reply({ ok: false, error: "not found" });
  return reply({ ok: true, row: found.getRow(), record: rowToObject(sheet.getRange(found.getRow(), 1, 1, COLUMNS.length).getValues()[0]) });
}
function readLast(n) {
  const sheet = ensureSheet();
  const last = sheet.getLastRow();
  if (last < 2) return reply({ ok: true, rows: [] });
  const from = Math.max(2, last - n + 1);
  const values = sheet.getRange(from, 1, last - from + 1, COLUMNS.length).getValues();
  return reply({ ok: true, rows: values.map((v, i) => ({ row: from + i, record: rowToObject(v) })) });
}

// Запустите один раз вручную из редактора (выберите authorize в списке функций → «Выполнить»),
// чтобы Google спросил все разрешения сразу: таблица, почта, Диск.
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet() || (SPREADSHEET_ID && SpreadsheetApp.openById(SPREADSHEET_ID));
  MailApp.getRemainingDailyQuota();
  DriveApp.getRootFolder();
  Logger.log("Разрешения выданы");
}

// Одна строка разбора: находим по id или добавляем в конец, пишем только присланные поля.
function writeRow(sheet, rec) {
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
  return rowIdx;
}

// Пачка строк за один вызов: сервер копит записи и шлёт их вместе, поэтому при
// одновременной работе десятков людей скрипт вызывается в разы реже.
function writeRows(records) {
  if (!records || !records.length) return reply({ ok: false, error: "no records" });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(120000);
    const sheet = ensureSheet();
    let written = 0;
    for (var i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id) continue;
      writeRow(sheet, rec);
      written++;
    }
    return reply({ ok: true, written: written });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Удаление служебных строк по началу id (например, после нагрузочной проверки).
function purgeRows(prefix) {
  if (!prefix) return reply({ ok: false, error: "no prefix" });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);
    const sheet = ensureSheet();
    const last = sheet.getLastRow();
    if (last < 2) return reply({ ok: true, removed: 0 });
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    let removed = 0;
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]).indexOf(prefix) === 0) { sheet.deleteRow(i + 2); removed++; }
    }
    return reply({ ok: true, removed: removed });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply({ ok: true, service: "paradox-sheet" });
}

function ensureSheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Таблица не найдена: скрипт создан не из меню таблицы — заполните SPREADSHEET_ID");
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
