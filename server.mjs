import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, DISTRICTS, INDICATORS, WEIGHTS } from './src/data.mjs';
import { evaluateScenario, recommendedScenario } from './src/simulator.mjs';
import { assessCityCrises, localStressSummary, stressSummaryInput } from './src/stress-test.mjs';

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
  const districts = Array.isArray(result.districts) ? result.districts : [];
  const changed = districts.map(item => ({ ...item, change: Number(item.score) - Number(item.before) }))
    .filter(item => Number.isFinite(item.change));
  const best = [...changed].sort((a, b) => b.change - a.change)[0];
  const weakest = [...districts].sort((a, b) => Number(a.score) - Number(b.score))[0];
  const spent = Number.isFinite(result.cost) ? result.cost : 0;
  const remaining = Number.isFinite(result.remaining) ? result.remaining : Math.max(0, DATA.budget - spent);
  const scoreChange = Number.isFinite(result.delta) ? result.delta : Number(result.score || 0) - Number(result.baseScore || DATA.baseScore);
  const lines = [
    `Итог: городской индекс качества жизни вырос на ${scoreChange.toFixed(2)} балла — до ${Number(result.score || 0).toFixed(2)}.`,
    best ? `Польза: сильнее всего улучшился район ${best.name} — на ${best.change.toFixed(1)} балла.` : 'Польза: меры направлены на улучшение городских услуг и районов.',
    weakest ? `Что учесть: самым слабым остаётся район ${weakest.name} (${Number(weakest.score || 0).toFixed(1)} из 100).` : 'Что учесть: эффект зависит от выбранных мер и сроков их запуска.',
    `Следующий шаг: сравните план с альтернативой; из бюджета осталось ${remaining} из ${DATA.budget} условных единиц.`
  ];
  return lines.join('\n');
}

async function askAi(result) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: fallbackExplanation(result), source: 'local', note: 'Добавьте OPENAI_API_KEY, чтобы включить AI-пояснение.' };
  const districtChanges = (result.districts || []).map(district => ({
    district: district.name,
    before: district.before,
    after: district.score,
    change: Number((district.score - district.before).toFixed(1))
  }));
  const summary = {
    cityScore: { before: result.baseScore, after: result.score, change: result.delta },
    budget: { spent: result.cost, remaining: result.remaining, total: DATA.budget },
    measures: (result.actions || []).map(action => ({ name: action.label, location: action.district })),
    districtChanges
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions: 'Ты помощник городского симулятора. Ответь по-русски ровно четырьмя короткими строками, по одному предложению в каждой: «Итог:», «Польза:», «Что учесть:», «Следующий шаг:». Всего 45–65 слов. Объясни изменение городского индекса в баллах из 100, назови район с наибольшим улучшением, укажи самый слабый район и предложи следующий шаг. Пиши простыми словами. Не перечисляй все меры, не используй коды, англицизмы, проценты, формулы и повторы. Используй только переданные факты; ничего не додумывай.',
      input: JSON.stringify(summary),
      reasoning: { effort: 'minimal' },
      max_output_tokens: 450,
      store: false
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`OpenAI API вернул ошибку (${response.status}). Проверьте ключ и доступ к API.`);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!text && payload.status === 'incomplete' && payload.incomplete_details?.reason === 'max_output_tokens') {
    throw new Error('Ответ AI не поместился в лимит генерации.');
  }
  if (!text) throw new Error('AI не вернул текст. Попробуйте ещё раз.');
  return { text, source: 'openai' };
}

async function runStressTest(result) {
  const report = assessCityCrises(result);
  const localText = localStressSummary(report);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ...report, summary: localText, source: 'local' };
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        instructions: 'Ты помощник городского симулятора. Подведи итог стресс-теста на русском ровно в двух коротких предложениях, не больше 45 слов. Скажи, какие проблемы затрагивают выбранные меры в модели, и назови главный пробел. Предложи сравнить альтернативу. Без заголовка, списка и подробностей отдельных кризисов. Не называй план готовым или защищённым, не обещай предотвращение событий и не утверждай, что реальный риск снижен. Score не меняется, районные эффекты синтетические. Используй только результаты проверки.',
        input: JSON.stringify(stressSummaryInput(report)),
        reasoning: { effort: 'minimal' },
        max_output_tokens: 180,
        store: false
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw new Error(`OpenAI API вернул ошибку (${response.status}).`);
    const payload = await response.json();
    const rawText = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    if (!rawText) throw new Error('AI не вернул пояснение стресс-теста.');
    const paragraph = rawText.replace(/\r/g, '').split(/\n\s*\n/)[0].replace(/\*\*/g, '').replace(/^\s*(?:Кратко\s*:\s*)?/i, '').replace(/\s+/g, ' ').trim();
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
    const firstTwo = sentences.slice(0, 2).join(' ').trim();
    if (firstTwo.split(/\s+/).length > 52) {
      return { ...report, summary: localText, source: 'local', note: 'Показан короткий итог проверки.' };
    }
    return { ...report, summary: firstTwo, source: 'openai' };
  } catch (error) {
    console.error('AI stress test failed:', error.message);
    return { ...report, summary: localText, source: 'local', note: 'Показан автоматический разбор; таблица проверки работает без AI.' };
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/data') return send(res, 200, { districts: DISTRICTS, indicators: INDICATORS, weights: WEIGHTS, measures: DATA.measures, budget: DATA.budget, baseScore: DATA.baseScore });
    if (req.method === 'POST' && url.pathname === '/api/evaluate') {
      const payload = await readJson(req);
      return send(res, 200, evaluateScenario(payload.selections));
    }
    if (req.method === 'GET' && url.pathname === '/api/recommend') {
      const focus = url.searchParams.get('district') || 'all';
      try { return send(res, 200, recommendedScenario(focus)); }
      catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const { result } = await readJson(req);
      if (!result?.valid) return send(res, 400, { error: 'Сначала выберите допустимый набор мер.' });
      try { return send(res, 200, await askAi(result)); }
      catch (error) {
        console.error('AI analysis failed:', error.message);
        return send(res, 200, { text: fallbackExplanation(result), source: 'local', note: 'AI временно недоступен; показан краткий автоматический разбор.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/stress-test') {
      const { result } = await readJson(req);
      if (!result?.valid) return send(res, 400, { error: 'Сначала рассчитайте допустимый сценарий.' });
      return send(res, 200, await runStressTest(result));
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Аким на 5 часов запущен: http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? 'OpenAI API: ключ найден.' : 'OpenAI API: ключ не найден; будет использоваться локальное пояснение.');
});
