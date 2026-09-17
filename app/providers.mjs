// Единственный провайдер — DeepSeek. Интерфейс:
//   run({ system, user, schema, maxTokens, effort }) -> { json, usage }
// system — массив блоков [{ text }].
// Текст рассуждений модели наружу не отдаётся: пока модель думает, интерфейс
// показывает анимацию, а не поток слов.

const trim = (u) => (u || "").replace(/\/+$/, "");

/* ------------------------------ DeepSeek ----------------------------- */
// API совместим с OpenAI. Схему модель не гарантирует, поэтому схема уходит
// в промпт, ответ проверяется по обязательным полям и при промахе
// переспрашивается один раз.

function deepseekProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const base = trim(process.env.DEEPSEEK_BASE_URL) || "https://api.deepseek.com";
  // Замер 06.09.2026 на шаге «первичное чтение» (один прогон, разброс большой):
  // flash/high 40s, pro/low 64s, pro/high 84s; на «уточнении» pro/low 41s, flash/high 49s,
  // pro/high 53s. Время задаёт число сгенерированных токенов (~80–100 в секунду у обеих),
  // а не модель как таковая. Берём pro как более точную, а скорость возвращаем глубиной
  // рассуждений: обычным шагам — low. DEEPSEEK_MODEL= и DEEPSEEK_EFFORT= перебивают.
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  // Глубина рассуждений. DeepSeek принимает low/high/max; без параметра думает на high,
  // и раньше мы так и жили — параметр не передавался. Думающий режим включён явно,
  // чтобы не зависеть от умолчаний API. «medium» шага отдаём как low: по замеру это
  // экономит до трети времени шага, а формат и полнота ответа не страдают.
  const dsEffort = (e) => process.env.DEEPSEEK_EFFORT ||
    ({ low: "low", medium: "low", high: "high", max: "max" }[e] || "high");

  // DEEPSEEK_THINKING=off выключает рассуждения совсем — для замеров скорости.
  const THINKING = (process.env.DEEPSEEK_THINKING || "on") !== "off";

  async function once({ system, user, schema, maxTokens, effort }) {
    const sys = system.map(b => b.text).join("\n\n") +
      "\n\n## ФОРМАТ ОТВЕТА\nВерни ОДИН объект JSON строго по этой схеме и ничего кроме него — " +
      "без пояснений, без markdown-ограждений. Заполни все обязательные поля; " +
      "поля типа string не оставляй пустыми, кроме тех, где это явно разрешено описанием.\n" +
      JSON.stringify(schema);

    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(600000),
      body: JSON.stringify({
        model, max_tokens: maxTokens, stream: true,
        ...(THINKING
          ? { thinking: { type: "enabled" }, reasoning_effort: dsEffort(effort) }
          : { thinking: { type: "disabled" } }),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`DeepSeek вернул ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "", usage = null, finishReason = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev; try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.usage) usage = ev.usage;
        const d = ev.choices?.[0]?.delta;
        if (!d) continue;
        if (d.content) out += d.content;
        if (ev.choices?.[0]?.finish_reason) finishReason = ev.choices[0].finish_reason;
      }
    }
    return { text: out, usage, finishReason };
  }

  return {
    id: "deepseek", label: "DeepSeek", model,
    proxied: Boolean(process.env.DEEPSEEK_BASE_URL),
    async run(opts) {
      const first = await once(opts);
      let json;
      try {
        json = parseJson(first.text);
        const missing = missingKeys(json, opts.schema);
        if (missing.length) throw new Error("нет полей: " + missing.join(", "));
      } catch (e) {
        // DeepSeek иногда отдаёт пустой или обрезанный ответ на тяжёлой схеме —
        // такое видно по finish_reason/длине текста. Логируем перед починкой,
        // чтобы это было заметно, а не тонуло в обычном потоке запросов.
        console.error(`[deepseek] чиню ответ: ${e.message} (finish=${first.finishReason}, len=${first.text.length})`);
        // Если модель упёрлась в лимит токенов, повтор с тем же лимитом упрётся
        // в ту же стену — на починку даём заметно больше места.
        const hitLimit = first.finishReason === "length" || first.text.length === 0;
        const repair = await once({
          ...opts,
          maxTokens: hitLimit ? Math.min(Math.round(opts.maxTokens * 1.6), 32000) : opts.maxTokens,
          user: opts.user +
            "\n\n---\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА ПРОВЕРКУ: " + e.message +
            (hitLimit ? "\nПохоже, ты исчерпал лимит токенов на рассуждения, не дойдя до ответа. " +
              "Рассуждай короче и переходи к ответу раньше." : "") +
            "\nВот что ты вернул:\n" + first.text.slice(0, 4000) +
            "\nВерни исправленный JSON целиком, строго по схеме.",
        });
        json = parseJson(repair.text);
        const missing = missingKeys(json, opts.schema);
        if (missing.length) throw new Error("DeepSeek не заполнил поля: " + missing.join(", "));
        return { json, usage: repair.usage };
      }
      return { json, usage: first.usage };
    },
  };
}

/* ------------------------------- утилиты ------------------------------ */

function parseJson(text) {
  const t = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error("PARSE: ответ не разобрался как JSON. Начало: " + t.slice(0, 200));
}

/** Проверяет только верхний уровень и первый уровень вложенности — этого хватает, чтобы поймать обрезанный ответ. */
function missingKeys(obj, schema, path = "") {
  if (!schema || schema.type !== "object" || !schema.required) return [];
  const out = [];
  for (const k of schema.required) {
    if (obj?.[k] === undefined || obj?.[k] === null) { out.push(path + k); continue; }
    const sub = schema.properties?.[k];
    if (sub?.type === "object") out.push(...missingKeys(obj[k], sub, path + k + "."));
  }
  return out;
}

/* ------------------------------- выбор -------------------------------- */

/** Провайдер DeepSeek; null, если ключа нет (тогда сайт работает в демо-режиме). */
export function pickProvider() {
  return deepseekProvider();
}
