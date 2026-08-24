// Слой провайдеров. Оба реализуют один интерфейс:
//   run({ system, user, schema, maxTokens, onThinking }) -> { json, usage }
// system — массив блоков [{ text, cache }]; кэширование использует только Anthropic.

import Anthropic from "@anthropic-ai/sdk";

const trim = (u) => (u || "").replace(/\/+$/, "");

/* ----------------------------- Anthropic ----------------------------- */

function anthropicProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const baseURL = trim(process.env.ANTHROPIC_BASE_URL) || undefined;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });

  return {
    id: "anthropic", label: "Anthropic", model,
    proxied: Boolean(baseURL),
    async run({ system, user, schema, maxTokens, effort = "medium", onThinking }) {
      const stream = client.messages.stream({
        model, max_tokens: maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort, format: { type: "json_schema", schema } },
        system: cacheBreakpoint(system),
        messages: [{ role: "user", content: user }],
      });
      stream.on("thinking", (d) => onThinking?.(d));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("REFUSAL");
      const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
      return { json: parseJson(text), usage: msg.usage };
    },
  };
}

/* ------------------------------ DeepSeek ----------------------------- */
// API совместим с OpenAI. Схему модель не гарантирует, поэтому схема уходит
// в промпт, ответ проверяется по обязательным полям и при промахе
// переспрашивается один раз.

function deepseekProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const base = trim(process.env.DEEPSEEK_BASE_URL) || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  async function once({ system, user, schema, maxTokens, onThinking }) {
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
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`DeepSeek вернул ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "", usage = null;
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
        if (d.reasoning_content) onThinking?.(d.reasoning_content);
        if (d.content) out += d.content;
      }
    }
    return { text: out, usage };
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
        // Одна попытка починки: возвращаем модели её же ответ и ошибку.
        const repair = await once({
          ...opts,
          user: opts.user +
            "\n\n---\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА ПРОВЕРКУ: " + e.message +
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

/** Одна точка кэширования — на последнем блоке, помеченном cache. */
function cacheBreakpoint(blocks) {
  const last = blocks.map((b, i) => (b.cache ? i : -1)).filter(i => i >= 0).pop();
  return blocks.map((b, i) => ({ type: "text", text: b.text,
    ...(i === last ? { cache_control: { type: "ephemeral" } } : {}) }));
}

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

/** Провайдер по идентификатору; null, если ключа для него нет. */
export function getProvider(id) {
  if (id === "anthropic") return anthropicProvider();
  if (id === "deepseek") return deepseekProvider();
  return null;
}

export function pickProvider() {
  const want = (process.env.PROVIDER || "").toLowerCase();
  const a = anthropicProvider(), d = deepseekProvider();
  if (want === "deepseek") return d || a;
  if (want === "anthropic") return a || d;
  return a || d;
}

export function listProviders() {
  return [anthropicProvider(), deepseekProvider()].filter(Boolean)
    .map(p => ({ id: p.id, label: p.label, model: p.model, proxied: p.proxied }));
}
