// Heuristic crash analysis: turns common Minecraft/loader errors into plain-language hints.
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const RULES = [
  { re: /java\.lang\.OutOfMemoryError/i, title: 'Не хватило памяти', hint: 'Увеличьте выделенную память (ОЗУ) в настройках сборки.' },
  { re: /UnsupportedClassVersionError.*class file version (\d+)/i, title: 'Не та версия Java', hint: 'Мод или загрузчик требует более новую Java. Сбросьте свой путь к Java в настройках, лаунчер подберёт правильную.' },
  { re: /requires (?:version )?[^\n]*?(?:of|any version of) ['"]?([\w-]+)['"]?,? which is missing/i, title: 'Не хватает зависимости', hint: (m) => `Установите мод «${m[1]}» (кнопка «Проверить сборку» найдёт его сама).` },
  { re: /Mod ([\w-]+) requires .*?([\w-]+)/i, title: 'Не хватает зависимости', hint: (m) => `Мод ${m[1]} требует ${m[2]}.` },
  { re: /Missing or unsupported mandatory dependencies:([\s\S]{0,400})/i, title: 'Не хватает обязательных модов', hint: (m) => 'Forge сообщает: ' + m[1].trim().split('\n').slice(0, 4).join('; ') },
  { re: /Incompatible mods? found!|is incompatible with/i, title: 'Несовместимые моды', hint: 'Два мода конфликтуют. Откройте лог, найдите строки с "incompatible" и отключите один из них.' },
  { re: /Duplicate mods? found|DuplicateModsFoundException|Found duplicate mods/i, title: 'Дубликаты модов', hint: 'Один мод лежит в папке mods дважды (разные версии). Удалите лишний файл.' },
  { re: /Mixin apply.*failed|MixinApplyError|InvalidInjectionException/i, title: 'Ошибка Mixin', hint: 'Один из модов несовместим с этой версией игры или с другим модом. Обновите моды.' },
  { re: /Could not find or load main class/i, title: 'Повреждены файлы версии', hint: 'Нажмите «Переустановить» в настройках сборки.' },
  { re: /Pixel format not accelerated|GLFW error 65542|No OpenGL context/i, title: 'Проблема с видеодрайвером', hint: 'Обновите драйвер видеокарты (NVIDIA/AMD/Intel).' },
  { re: /EXCEPTION_ACCESS_VIOLATION/i, title: 'Сбой в нативном коде', hint: 'Часто это драйвер видеокарты или шейдеры. Обновите драйвер или отключите шейдеры.' },
  { re: /Address already in use/i, title: 'Порт занят', hint: 'Закройте другую копию игры или сервера.' },
];

function latestCrashReport(instanceId) {
  const dir = path.join(P.gameDir(instanceId), 'crash-reports');
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (files.length && Date.now() - files[0].t < 15 * 60 * 1000) return { file: path.join(dir, files[0].f), text: fs.readFileSync(path.join(dir, files[0].f), 'utf8') };
  } catch {}
  return null;
}

function analyze(instanceId, logLines = []) {
  const report = latestCrashReport(instanceId);
  const text = (report ? report.text + '\n' : '') + logLines.slice(-800).join('\n');
  const findings = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) findings.push({ title: r.title, hint: typeof r.hint === 'function' ? r.hint(m) : r.hint });
  }
  let description = null;
  if (report) {
    const m = /Description: (.+)/.exec(report.text);
    if (m) description = m[1].trim();
  }
  const errorLines = logLines.filter((l) => /ERROR|Exception|FATAL|Caused by/i.test(l)).slice(-25);
  return { crashReport: report ? report.file : null, description, findings: findings.slice(0, 4), errorLines };
}

module.exports = { analyze, latestCrashReport };
