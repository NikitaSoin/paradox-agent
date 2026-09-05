#!/bin/bash
# Разворачивает новый проект: папка, скелет, ключи, репозиторий на GitHub, первый пуш.
#
#   ./новый-проект.sh имя-проекта ["описание"]
#
# Ключи берутся из ~/.config/ai-projects/keys.env и в репозиторий НЕ попадают.
set -euo pipefail

NAME="${1:-}"
DESC="${2:-}"
KEYS="$HOME/.config/ai-projects/keys.env"
BASE="$HOME"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$NAME" ]; then
  echo "Как пользоваться:  ./новый-проект.sh имя-проекта [\"описание\"]"; exit 1
fi

DIR="$BASE/$NAME"
[ -e "$DIR" ] && { echo "Папка $DIR уже существует — остановился, ничего не трогаю."; exit 1; }

echo "→ Папка $DIR"
mkdir -p "$DIR/app/public"

echo "→ Инструкция и заготовка CLAUDE.md"
# Инструкцию ищем рядом со скриптом, затем в исходном проекте, затем тянем с GitHub.
GUIDE=""
for p in "$HERE/СТАРТ_НОВОГО_ПРОЕКТА.md" "$HOME/AI-agent_paradox/СТАРТ_НОВОГО_ПРОЕКТА.md"; do
  [ -f "$p" ] && { GUIDE="$p"; break; }
done
if [ -n "$GUIDE" ]; then
  cp "$GUIDE" "$DIR/"
  echo "   взята из $GUIDE"
elif curl -fsSL "https://raw.githubusercontent.com/NikitaSoin/paradox-agent/main/%D0%A1%D0%A2%D0%90%D0%A0%D0%A2_%D0%9D%D0%9E%D0%92%D0%9E%D0%93%D0%9E_%D0%9F%D0%A0%D0%9E%D0%95%D0%9A%D0%A2%D0%90.md" -o "$DIR/СТАРТ_НОВОГО_ПРОЕКТА.md" 2>/dev/null; then
  echo "   скачана с GitHub"
else
  echo "   🔴 инструкцию найти не удалось — положите СТАРТ_НОВОГО_ПРОЕКТА.md в проект вручную"
fi
cat > "$DIR/CLAUDE.md" <<EOF
# $NAME

${DESC:-Одно предложение: что это и для кого.}

> 🔴 Техническая база, деплой и грабли — в \`СТАРТ_НОВОГО_ПРОЕКТА.md\`. Читай его
> перед тем, как что-то придумывать заново.
> Эта папка и есть рабочая копия репозитория, ветка \`main\`. Правим здесь,
> отсюда же пушим. Ключи (\`app/.env\`) в репозиторий не уезжают — на хостинге
> задаются переменными окружения в панели.

## Роли
Пользователь — продакт-оунер: ставит задачи, принимает решения о продукте.
Разработка, дизайн, аналитика — на ИИ.

Правила работы:
- Не выдумывать факты. Если чего-то нет в материалах проекта — так и сказать.
- Перед «готово» — прогнать тесты и показать результат, а не утверждать на словах.

## Структура
\`\`\`
app/            приложение
  server.mjs      node:http: статика + API, без фреймворка
  public/         фронтенд без сборки
  .env            ключи, в git не уходит
\`\`\`

## Ограничения
(что нельзя нарушать)
EOF

echo "→ .gitignore"
cat > "$DIR/.gitignore" <<'EOF'
.env
.env.local
app/.env
node_modules/
dist/
archive/
extracted/
*.zip
*.command
*.bat
.DS_Store
EOF

echo "→ package.json и точка входа для хостинга"
cat > "$DIR/package.json" <<EOF
{
  "name": "$NAME",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node app/server.mjs" },
  "engines": { "node": ">=18" }
}
EOF
cat > "$DIR/index.js" <<'EOF'
// Точка входа для хостинга: панель может запускать `node index.js` вместо
// `npm start`. Своей логики здесь нет и быть не должно.
import "./app/server.mjs";
EOF

echo "→ Ключи из $KEYS"
if [ -f "$KEYS" ]; then
  cp "$KEYS" "$DIR/app/.env"; chmod 600 "$DIR/app/.env"
  # .env.example — те же имена, значения пустые
  grep -oE '^[A-Za-z_]+=' "$KEYS" | sed 's/$//' > "$DIR/app/.env.example"
  echo "ACCESS_CODE=" >> "$DIR/app/.env.example"
  echo "   ключи скопированы, .env.example собран"
else
  echo "   🔴 $KEYS не найден — .env не создан, впишите ключи вручную"
fi

echo "→ git"
cd "$DIR"
git init -q
git branch -M main
git add -A
git -c user.useConfigOnly=false commit -qm "Заготовка проекта: скелет, инструкция, точка входа для хостинга"

# Проверка, что ключи точно не в коммите
if git ls-files | grep -qE '(^|/)\.env$'; then
  echo "🔴 СТОП: .env попал в коммит. Не пушу."; exit 1
fi
echo "   проверка пройдена: .env в коммит не попал"

echo "→ Репозиторий на GitHub (приватный)"
if gh auth status >/dev/null 2>&1; then
  gh repo create "$NAME" --private --source=. --remote=origin --push \
    ${DESC:+--description "$DESC"}
  echo
  echo "Готово. Репозиторий: $(gh repo view --json url -q .url)"
else
  echo "   gh не авторизован. Выполните:  gh auth login"
  echo "   затем:  cd $DIR && gh repo create $NAME --private --source=. --remote=origin --push"
fi

echo
echo "Дальше:  cd $DIR  и скажите ИИ: «читай СТАРТ_НОВОГО_ПРОЕКТА.md, работаем по нему»"
