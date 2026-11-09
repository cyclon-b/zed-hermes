# zed-hermes

> [Hermes Agent](https://github.com/NousResearch/hermes-agent) в [Zed](https://zed.dev):
> полный набор слэш-команд в меню `/` панели агента и MCP-серверы Zed
> (`context_servers`), проброшенные в Hermes по ACP.

[English version](README.md)

## Статус

Мост покрыт автотестами против мок-агента ACP и сквозным probe-скриптом,
который поднимает настоящий мост по stdio. Против живой установки Hermes в CI
этого репозитория он **не** проверялся — первым делом запустите `npm run probe`
у себя. См. [Известное поведение и ограничения](#известное-поведение-и-ограничения).

## Проблема

Hermes уже умеет работать ACP-сервером (`hermes acp`), поэтому Zed может
подключить его как External Agent прямо сейчас. Остаются два пробела:

1. **Видимость команд.** Zed рисует меню `/` только из
   `available_commands_update`. Hermes объявляет 14 команд (`help`, `model`,
   `tools`, `context`, `reset`, `compress`, `steer`, `queue`, `usage`, `status`,
   `version`, `title`, `undo`, `retry`). Остальные — `/plan`, `/init`, `/diff`,
   `/goal`, `/learn` и многие другие — всё равно выполняются, потому что ACP
   отправляет любую необъявленную `/команду` в `slash.exec` шлюза. Но в меню
   их нет.
2. **MCP легко сломать.** Zed передаёт свои MCP-серверы в
   `session/new.mcpServers`; Hermes подключает их к сессии. Любой прокси,
   переписывающий `session/new`, или `no_mcp` в конфиге Hermes — и серверы
   молча исчезают.

## Что содержит репозиторий

**ACP-прокси без патчей** плюс обвязка. Ничего в `~/.hermes` не меняется,
плагин Hermes не устанавливается, версия Hermes не фиксируется.

| Компонент | Назначение |
|---|---|
| `bin/zed-hermes.js` | Запускает `hermes acp` и проксирует ACP по stdio |
| `lib/proxy.js` | Дополняет или синтезирует `available_commands_update`; всё остальное пропускает без изменений |
| `scripts/register-zed.mjs` | Добавляет/удаляет `agent_servers` в `settings.json` Zed (с бэкапом) |
| `scripts/probe.mjs` | Сквозная проверка по ACP и режим `--doctor` |
| `install.ps1` / `install.sh` | Установка для пользователя и регистрация в Zed; идемпотентно и обратимо |
| `docs/` | Команды, MCP, диагностика |

## Как это работает

```text
Zed Agent Panel
      │  ACP по stdio (NDJSON JSON-RPC)
      ▼
zed-hermes  ──pass-through──▶  hermes acp  ──▶  Hermes gateway
      │                              │
      │  available_commands_update   │
      └────── дополнено ─────────────┘
```

1. **Прозрачность.** Каждая строка пересылается без изменений. Разбираются
   только `session/new|resume|load|fork` (чтобы узнать id сессии), их ответы и
   уведомления `session/update` с `available_commands_update`.
2. **Дополнение.** К объявленному Hermes списку добавляется курируемый каталог.
   При совпадении имён побеждает Hermes, порядок сохраняется.
3. **Синтез.** Если сборка Hermes вообще не присылает объявление, мост сам
   отправляет его через `synthesizeDelayMs` (по умолчанию 300 мс) после ответа
   на `session/new`. Таймер отменяется, как только приходит настоящее
   уведомление.
4. **MCP не трогаем.** `session/new` пересылается байт в байт, поэтому
   `mcpServers` от Zed доходят до Hermes ровно в том виде, в каком их отправил
   Zed. Это проверяется регрессионным тестом.

Команды выполняет Hermes, а не мост. Мост лишь делает их видимыми. Отказ
Hermes приходит как *ответ* команды, а не как упавший промпт.

## Требования

- Hermes Agent с установленным ACP-дополнением:

  ```bash
  cd ~/.hermes/hermes-agent && python -c "import pm; pm.sync_venv(['acp'], explicit=True)"
  ```

  `hermes acp --version` должен выполняться. Провайдер и модель настраиваются
  заранее через `hermes model` — ACP использует те же учётные данные.
- Zed с поддержкой External Agents.
- Node.js ≥ 22.

## Установка

### Windows (PowerShell)

```powershell
git clone https://github.com/cyclon-b/zed-hermes.git
cd zed-hermes
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```sh
git clone https://github.com/cyclon-b/zed-hermes.git
cd zed-hermes
./install.sh
```

Установщики:

1. проверяют Node.js ≥ 22 и предупреждают, если `hermes` не найден или не
   установлено ACP-дополнение;
2. создают пользовательский конфиг при первом запуске
   (`%APPDATA%\zed-hermes\config.json`, `~/.config/zed-hermes/config.json` или
   `~/Library/Application Support/zed-hermes/config.json`);
3. добавляют `agent_servers.Hermes` в `settings.json` Zed, предварительно
   сделав бэкап.

Опции: `-NoZed` / `--no-zed` печатает сниппет вместо правки настроек;
`-Revert` / `--revert` удаляет запись. Повторный запуск идемпотентен.

## Ручная регистрация в Zed

```json
{
  "agent_servers": {
    "Hermes": {
      "type": "custom",
      "command": "node",
      "args": ["C:/path/to/zed-hermes/bin/zed-hermes.js"],
      "env": {}
    }
  }
}
```

Если `node` не виден Zed (частая проблема с менеджерами версий), укажите
абсолютный путь к исполняемому файлу в `command`. Затем откройте панель агента,
создайте тред `Hermes` и наберите `/`.

> В настройках указывается именно мост, а не `hermes acp` напрямую. Если
> подключить `hermes acp`, всё тоже будет работать — просто в меню не появятся
> дополнительные команды.

## MCP-серверы из Zed

MCP-серверы Zed (`context_servers` в настройках Zed) передаются агенту как
`mcpServers` в `session/new`; Hermes подключает их к сессии и отдаёт
инструменты модели. Мост этот payload не трогает.

Что полезно знать:

- `platform_toolsets.acp` и `no_mcp` в Hermes фильтруют серверы из
  **`config.yaml`**. Серверы от редактора добавляются отдельно, их не нужно
  перечислять.
- `agent.disabled_toolsets` всё равно может убрать MCP-тулсет из всех
  ACP-сессий. Если инструмент пропал — проверьте этот ключ.
- Авторизацией удалённых MCP-серверов (OAuth) управляет Zed. Hermes получает
  уже рабочий сервер, а не учётные данные.
- Если шлюз Hermes объявляет `acp-session-mcp-v1`, серверы редактора
  принадлежат канонической сессии. Закрытие Zed не отменяет выполнение MCP в
  другой сессии.

Подробнее: [docs/mcp.md](docs/mcp.md).

## Проверка без Zed

```sh
npm run doctor          # node, hermes в PATH, hermes acp --version
npm run probe           # настоящий ACP-хендшейк с hermes acp
npm run probe -- --mock # тот же probe против встроенного мок-агента
```

`probe` запускает мост так же, как Zed:
`initialize → session/new → available_commands_update → session/prompt /version`
и завершается с ошибкой, если курируемых команд нет.

Отладка транспорта внутри Zed: `dev: open acp logs` из Command Palette.

## Команды по умолчанию

Мост добавляет в меню следующие команды. Все они реально существуют в Hermes.

| Команда | Что делает |
|---|---|
| `/plan [task]` | Пишет план реализации, ничего не выполняя |
| `/init [notes]` | Создаёт или обновляет `AGENTS.md` по сканированию репозитория |
| `/diff [staged\|all\|session]` | Показывает изменения git в рабочей папке |
| `/goal [<objective>\|status\|pause\|resume\|clear]` | Ставит постоянную цель на несколько ходов |
| `/learn <what to learn from>` | Формирует переиспользуемый скилл |
| `/review [instructions]` | Запускает независимого ревьюера-субагента |
| `/memory [pending\|approve\|reject\|approval]` | Работа с очередью записей памяти и гейтом записи |
| `/rollback [number]` | Список и восстановление файловых чекпоинтов |
| `/branch [--here] [name]` | Ветвит текущую сессию |
| `/refine [focus]` | Немедленный self-improvement-прогон памяти и скиллов |

Опционально (не объявляются по умолчанию): `/btw`, `/bg`, `/moa`, `/fast`,
`/reasoning`, `/skills`, `/yolo`. Добавьте их в `commands` в конфиге.
Когда их стоит показывать — см. [docs/commands.md](docs/commands.md).

## Конфигурация

`~/.config/zed-hermes/config.json` (Windows:
`%APPDATA%\zed-hermes\config.json`):

```json
{
  "command": "hermes",
  "args": ["acp"],
  "shell": "auto",
  "synthesize": true,
  "synthesizeDelayMs": 300,
  "commands": [{ "name": "plan", "description": "…", "hint": "[task]" }]
}
```

Приоритет: флаги CLI → переменные `ZED_HERMES_*` → файл конфигурации →
значения по умолчанию. `zed-hermes --print-config` печатает итоговые значения.
В Windows `shell: "auto"` запускает `.cmd`/`.ps1`-шимзы (например, `hermes`,
установленный менеджером пакетов) через `cmd.exe`; для абсолютного `.exe`
укажите `shell: false`.

## Удаление

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Revert
```

```sh
./install.sh --revert
```

Пользовательский конфиг остаётся. Удалите каталог `zed-hermes` в корне
конфигурации, если он больше не нужен.

## Известное поведение и ограничения

- **Здесь не проверялось на живой установке Hermes.** Логика прокси, фрейминг,
  дополнение, синтез, правка настроек Zed и решения по запуску в Windows
  покрыты `node --test`; сквозной путь ACP — мок-агентом. Проверка с вашим
  Hermes — это `npm run probe`.
- **Каталог отражает набор команд Hermes на 2026-11.** Если Hermes переименует
  или удалит команду, пункт меню вернёт собственный отказ Hermes. Исправляется
  в конфиге, без правки кода.
- **Дополнительные команды выполняет шлюз.** ACP-процесс Hermes — viewer
  демона шлюза. Если демон недоступен, команда вернёт отказ вместо выполнения.
- **Синтез — эвристика.** Клиент, который отвергает `session/update` до
  регистрации сессии, его потеряет; задержка 300 мс нужна, чтобы ответ
  `session/new` успел уйти первым. `synthesize: false` отключает синтез.
- **Это не пакет npm-реестра.** Запускайте из клона; у моста нет runtime-
  зависимостей, глобально ставить нечего.
- Мост не реализует презентационные возможности ACP (карточки планов, todo,
  терминалы) и не меняет разрешения инструментов Hermes.

## Разработка

```sh
npm run check   # синтаксис + инварианты каталога
npm test        # node --test, без внешних зависимостей
npm run probe -- --mock
```

## Лицензия

[PolyForm Noncommercial License 1.0.0](LICENSE) — бесплатно для
некоммерческого использования; коммерческое использование, включая продажу
самого продукта или продуктов на его основе, не предоставляется. По вопросам
коммерческой лицензии обращайтесь к автору.

См. [LICENSE](LICENSE) и [NOTICE](NOTICE). Copyright (c) 2026 Gennady
Artamonov. Не аффилировано с Nous Research или Zed Industries и не одобрено
ими.
