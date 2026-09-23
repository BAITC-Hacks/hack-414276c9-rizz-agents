import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, DISTRICTS, INDICATORS, WEIGHTS } from './src/data.mjs';
import { evaluateScenario, recommendedScenario } from './src/simulator.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  let contents;
  try { contents = readFileSync(path.join(ROOT, '.env'), 'utf8'); }
  catch { return; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    process.env[match[1]] = value;
  }
}
loadLocalEnv();
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const part of req) {
    raw += part;
    if (raw.length > 100_000) throw new Error('Запрос слишком большой.');
  }
  return JSON.parse(raw || '{}');
}

function fallbackExplanation(result) {
  const nura = result.districts.find(d => d.id === 'nura');
  const start = DATA.districts.find(d => d.id === 'nura');
  const startScore = INDICATORS.reduce((sum, indicator) => sum + start.indicators[indicator.id] * WEIGHTS[indicator.id], 0);
  const weakest = result.indicatorsAfter.find(x => x.id === 'T2');
  const inNura = result.actions.filter(a => a.district === 'Нура').map(a => a.label);
  return [
    `Итог: городской балл вырос с ${result.baseScore.toFixed(2)} до ${result.score.toFixed(2)} (+${result.delta.toFixed(2)}).`,
    `Польза: в Нуре средняя оценка выросла с ${startScore.toFixed(2)} до ${nura.score.toFixed(2)}. Там выбраны меры: ${inNura.join(', ')}.`,
    weakest && weakest.after < 50
      ? `На что обратить внимание: доступность общественного транспорта всё ещё низкая — ${weakest.after.toFixed(1)} из 100.`
      : 'На что обратить внимание: сравните, как выбранные меры повлияли на все районы.',
    'Следующий шаг: дождитесь завершения мер с длительным сроком запуска и сравните сценарий с альтернативой.'
  ].join('\n');
}

async function askAi(result) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: fallbackExplanation(result), source: 'local', note: 'Добавьте OPENAI_API_KEY, чтобы включить AI-пояснение.' };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions: 'Ты AI-аналитик городского симулятора. Отвечай только по-русски и строго в 4 коротких строках с переносами: «Итог: ...», «Польза: ...», «Риск: ...», «Следующий шаг: ...». Максимум 70 слов всего. Объясняй понятными словами для широкой аудитории. Не используй английские названия полей вроде baseScore, delta, remaining, raw-коды T1/S1 и длинные списки мер или районов. Не пересчитывай значения и не добавляй чисел, которых нет во входных данных. Не называй синтетические данные реальными. Каждый пункт — не более одного короткого предложения.',
      input: JSON.stringify({
        'балл города до': result.baseScore,
        'балл города после': result.score,
        'изменение балла': result.delta,
        'потрачено из бюджета': result.cost,
        'остаток бюджета': result.remaining,
        'изменение оценок районов': result.districts.map(d => ({ район: d.name, было: d.before, стало: d.score })),
        'показатели города после мер': result.indicatorsAfter.map(i => ({ показатель: i.label, направление: i.area, значение: i.after })),
        'выбранные меры': result.actions.map(a => ({ название: a.label, район: a.district, направление: a.area, срок_запуска_в_кварталах: a.lag }))
      }),
      reasoning: { effort: 'minimal' },
      max_output_tokens: 600,
      store: false
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`OpenAI API вернул ошибку (${response.status}). Проверьте ключ и доступ к API.`);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  if (!text) throw new Error('AI не вернул текст. Попробуйте ещё раз.');
  return { text, source: 'openai' };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/data') return send(res, 200, { districts: DISTRICTS, indicators: INDICATORS, weights: WEIGHTS, measures: DATA.measures, budget: DATA.budget, baseScore: DATA.baseScore });
    if (req.method === 'POST' && url.pathname === '/api/evaluate') {
      const payload = await readJson(req);
      return send(res, 200, evaluateScenario(payload.selections));
    }
    if (req.method === 'GET' && url.pathname === '/api/recommend') return send(res, 200, recommendedScenario());
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const { result } = await readJson(req);
      if (!result?.valid) return send(res, 400, { error: 'Сначала выберите допустимый набор мер.' });
      try { return send(res, 200, await askAi(result)); }
      catch (error) { return send(res, 200, { text: fallbackExplanation(result), source: 'local', note: `${error.message} Показано локальное пояснение.` }); }
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(ROOT, 'public', requested);
      if (!file.startsWith(path.resolve(ROOT, 'public') + path.sep)) return send(res, 403, 'Недоступно', 'text/plain; charset=utf-8');
      const contents = await readFile(file);
      return send(res, 200, contents.toString(), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    return send(res, 404, { error: 'Маршрут не найден.' });
  } catch (error) {
    send(res, 400, { error: error.message || 'Не удалось обработать запрос.' });
  }
});

server.listen(PORT, () => {
  console.log(`Аким на 5 часов запущен: http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? 'OpenAI API: ключ найден.' : 'OpenAI API: ключ не найден; будет использоваться локальное пояснение.');
});
