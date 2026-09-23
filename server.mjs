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
  const weakest = result.indicatorsAfter.find(x => x.id === 'T2');
  const inNura = result.actions.filter(a => a.district === 'Нура').map(a => a.label);
  return `Сценарий повышает городской балл с ${result.baseScore.toFixed(2)} до ${result.score.toFixed(2)}. В Нуре средняя оценка меняется с ${start.score.toFixed(2)} до ${nura.score.toFixed(2)}. В районе выбраны меры: ${inNura.join(', ')}. ${weakest && weakest.after < 50 ? `Доступность общественного транспорта остаётся слабым местом (${weakest.after.toFixed(1)} из 100);` : 'Проверьте оставшиеся слабые показатели по районам;'} сравните этот набор с альтернативой, чтобы оценить компромисс между направлениями.`;
}

async function askAi(result) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: fallbackExplanation(result), source: 'local', note: 'Добавьте OPENAI_API_KEY, чтобы включить AI-пояснение.' };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions: 'Ты AI-аналитик городского симулятора. Отвечай по-русски кратко и понятно. Используй только переданные факты и рассчитанные числа. Не пересчитывай их, не придумывай статистику и не называй синтетические данные реальными. Объясни изменение Score, пользу, компромисс и следующий шаг.',
      input: JSON.stringify(result),
      store: false
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`OpenAI API вернул ошибку (${response.status}). Проверьте ключ и доступ к API.`);
  const payload = await response.json();
  const text = payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
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
