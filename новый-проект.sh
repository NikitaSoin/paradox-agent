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

# 🔴 GitHub выкидывает из имени репозитория всё нелатинское: «мой-проект» станет
# «-----». Поэтому имя проекта — только латиница, цифры, дефис.
if printf '%s' "$NAME" | grep -qvE '^[A-Za-z0-9._-]+$'; then
  echo "Имя «${NAME}» не годится для GitHub: нужны латиница, цифры, дефис."
  echo "Например: paradox-agent, sales-bot, crm-2026"
  exit 1
fi

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
# Никакой отдельной авторизации: берём доступ, уже сохранённый в связке ключей
# macOS (тот же, которым работает git push). Права `repo` включают создание.
CRED=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null)
GH_USER=$(printf '%s' "$CRED" | sed -n 's/^username=//p')
GH_TOKEN=$(printf '%s' "$CRED" | sed -n 's/^password=//p')

if [ -z "$GH_TOKEN" ]; then
  echo "   🔴 Сохранённого доступа к github.com не нашлось."
  echo "   Создайте репозиторий вручную на github.com (New → Private), затем:"
  echo "     cd $DIR && git remote add origin https://github.com/ЛОГИН/$NAME.git && git push -u origin main"
else
  BODY=$(printf '{"name":"%s","private":true,"description":"%s"}' "$NAME" "${DESC//\"/\\\"}")
  CODE=$(curl -s -o /tmp/newproj.json -w "%{http_code}" -X POST \
    -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos -d "$BODY")
  case "$CODE" in
    201)
      # 🔴 Имя репозитория берём из ответа, а не из своей переменной: GitHub
      # выкидывает из имени всё нелатинское, и «моя-папка» превращается в «-----».
      REAL=$(sed -n 's/.*"clone_url": *"\([^"]*\)".*/\1/p' /tmp/newproj.json | head -1)
      [ -z "$REAL" ] && REAL="https://github.com/$GH_USER/$NAME.git"
      git remote add origin "$REAL"
      git push -qu origin main
      echo "   создан и запушен: ${REAL%.git}"
      [ "${REAL%.git}" != "https://github.com/$GH_USER/$NAME" ] &&
        echo "   ⚠️  GitHub изменил имя: в адресе латиница. Локальная папка осталась «${NAME}»."
      ;;
    422)
      echo "   🔴 Репозиторий с именем «${NAME}» уже есть у $GH_USER. Выберите другое имя."
      ;;
    *)
      echo "   🔴 GitHub ответил $CODE:"; head -c 300 /tmp/newproj.json; echo
      ;;
  esac
  rm -f /tmp/newproj.json
fi

echo
echo "Дальше:  cd $DIR  и скажите ИИ: «читай СТАРТ_НОВОГО_ПРОЕКТА.md, работаем по нему»"
