import { DATA, DISTRICTS, INDICATORS, WEIGHTS } from './data.mjs';

const DISTRICT_IDS = new Set(DISTRICTS.map(d => d.id));
const round = value => Math.round(value * 100) / 100;
const clip = value => Math.max(0, Math.min(100, value));
const weighted = values => INDICATORS.reduce((sum, indicator) => sum + values[indicator.id] * WEIGHTS[indicator.id], 0);

function validationIssues(selections) {
  const issues = [];
  if (selections.length !== 5) issues.push(`Выбрано ${selections.length} мер. Для расчёта нужно выбрать ровно 5.`);

  const selected = selections.map(selection => ({
    measure: DATA.measures.find(measure => measure.id === selection?.measureId),
    districtId: selection?.districtId || null
  }));
  const known = selected.filter(item => item.measure);
  if (known.length !== selected.length) issues.push('В наборе есть неизвестная мера. Удалите её и выберите меру из каталога.');

  const ids = known.map(item => item.measure.id);
  if (new Set(ids).size !== ids.length) issues.push('Одна и та же мера добавлена несколько раз. Удалите повтор.');

  let cost = 0;
  for (const { measure, districtId } of known) {
    cost += measure.cost;
    if (measure.type === 'district' && !DISTRICT_IDS.has(districtId)) {
      issues.push(`Для меры «${measure.label}» выберите район.`);
    }
    if (measure.type === 'city' && districtId) {
      issues.push(`Мера «${measure.label}» действует на весь город; район для неё не выбирается.`);
    }
  }
  if (cost > DATA.budget) issues.push(`Превышен бюджет: выбрано ${cost} из ${DATA.budget} условных единиц.`);

  const perArea = {};
  for (const { measure } of known) perArea[measure.area] = (perArea[measure.area] || 0) + 1;
  for (const [area, count] of Object.entries(perArea)) {
    if (count > 2) issues.push(`В категории «${area}» выбрано ${count} меры. Допустимо не более 2.`);
  }

  const has = id => known.some(item => item.measure.id === id);
  if (has('M1') && has('M3')) issues.push('Автобусные полосы и линия ЛРТ несовместимы. Оставьте одну из этих мер.');

  const sameDistrictConflicts = [
    ['M4', 'M7', 'Парк и строительство школы с детсадом конкурируют за участок.'],
    ['M5', 'M13', 'Чистое топливо и модернизация сетей дублируют работы в одном районе.']
  ];
  for (const [leftId, rightId, message] of sameDistrictConflicts) {
    const left = known.find(item => item.measure.id === leftId);
    const right = known.find(item => item.measure.id === rightId);
    if (left && right && left.districtId === right.districtId) {
      const district = DISTRICTS.find(item => item.id === left.districtId)?.name;
      issues.push(`${message}${district ? ` Выберите разные районы или замените одну меру (${district}).` : ''}`);
    }
  }

  return { issues: [...new Set(issues)], selected: known, cost };
}

export function evaluateScenario(selections = []) {
  if (!Array.isArray(selections)) selections = [];
  const validation = validationIssues(selections);
  const { issues, selected, cost } = validation;
  if (issues.length) return { valid: false, issues, cost, remaining: DATA.budget - cost };

  const values = Object.fromEntries(DATA.districts.map(district => [district.id, { ...district.indicators }]));
  for (const { measure, districtId } of selected) {
    const targets = measure.type === 'city' ? DISTRICTS.map(district => district.id) : [districtId];
    const realizedShare = (8 - measure.lag) / 8;
    for (const target of targets) {
      for (const [indicatorId, effect] of Object.entries(measure.effects)) {
        values[target][indicatorId] += effect * realizedShare;
      }
    }
  }

  // Synergy bonuses apply in the district of the first, district-level measure.
  const addSynergy = (firstId, secondId, indicatorId, bonus) => {
    const first = selected.find(item => item.measure.id === firstId);
    const second = selected.find(item => item.measure.id === secondId);
    if (first && second) values[first.districtId][indicatorId] += bonus;
  };
  addSynergy('M1', 'M2', 'T1', 2);
  addSynergy('M10', 'M12', 'B1', 2);
  addSynergy('M5', 'M6', 'E2', 2);

  for (const district of DISTRICTS) {
    for (const indicator of INDICATORS) values[district.id][indicator.id] = clip(values[district.id][indicator.id]);
  }

  const rawDistrictScores = DISTRICTS.map(district => weighted(values[district.id]));
  const beforeDistrictScores = DISTRICTS.map(district => weighted(DATA.districts.find(item => item.id === district.id).indicators));
  const districtScores = DISTRICTS.map((district, index) => ({
    id: district.id,
    name: district.name,
    population: district.population,
    before: round(beforeDistrictScores[index]),
    score: round(rawDistrictScores[index]),
    indicators: values[district.id]
  }));

  const beforeAverage = DISTRICTS.reduce((sum, district, index) => sum + district.population * beforeDistrictScores[index], 0);
  const afterAverage = DISTRICTS.reduce((sum, district, index) => sum + district.population * rawDistrictScores[index], 0);
  const criticalCount = DISTRICTS.reduce((sum, district) => sum + INDICATORS.filter(indicator => values[district.id][indicator.id] < 40).length, 0);
  const baseCriticalCount = DATA.districts.reduce((sum, district) => sum + INDICATORS.filter(indicator => district.indicators[indicator.id] < 40).length, 0);
  const baseScore = round(.7 * beforeAverage + .3 * Math.min(...beforeDistrictScores) - baseCriticalCount);
  const score = round(.7 * afterAverage + .3 * Math.min(...rawDistrictScores) - criticalCount);

  const actions = selected.map(({ measure, districtId }) => ({
    id: measure.id,
    label: measure.label,
    district: measure.type === 'city' ? 'Весь город' : DISTRICTS.find(district => district.id === districtId).name,
    area: measure.area,
    effects: measure.effects,
    lag: measure.lag
  }));

  return {
    valid: true,
    cost,
    remaining: DATA.budget - cost,
    baseScore,
    score,
    delta: round(score - baseScore),
    districts: districtScores,
    indicatorsAfter: INDICATORS.map(indicator => ({
      id: indicator.id,
      label: indicator.label,
      area: indicator.area,
      after: round(DISTRICTS.reduce((sum, district) => sum + district.population * values[district.id][indicator.id], 0))
    })),
    actions,
    criticalCount,
    selected: selected.map(item => ({ measureId: item.measure.id, districtId: item.districtId }))
  };
}

export function recommendedScenario(focus = 'all') {
  if (focus !== 'all' && !DISTRICT_IDS.has(focus)) throw new Error('Неизвестный район для рекомендации.');
  const targets = focus === 'all' ? DISTRICTS : [DISTRICTS.find(district => district.id === focus)];
  let best = null;

  const consider = measures => {
    for (const target of targets) {
      const selections = measures.map(measure => ({
        measureId: measure.id,
        districtId: measure.type === 'city' ? null : target.id
      }));
      const result = evaluateScenario(selections);
      if (!result.valid) continue;
      const targetScore = result.districts.find(district => district.id === target.id).score;
      const objective = focus === 'all' ? result.score : result.score * .65 + targetScore * .35;
      if (!best || objective > best.objective || (objective === best.objective && result.cost < best.result.cost)) {
        best = { objective, target, result };
      }
    }
  };

  const choose = (startIndex, picked) => {
    if (picked.length === 5) return consider(picked);
    const stillNeeded = 5 - picked.length;
    for (let index = startIndex; index <= DATA.measures.length - stillNeeded; index++) {
      picked.push(DATA.measures[index]);
      choose(index + 1, picked);
      picked.pop();
    }
  };
  choose(0, []);

  if (!best) throw new Error('Не удалось подобрать допустимый план по текущим ограничениям.');
  const planName = focus === 'all' ? 'Сбалансированный план для города' : `План для района ${best.target.name}`;
  const planDescription = focus === 'all'
    ? `Подобран по максимальному общему Score; районные меры сосредоточены в приоритетном районе ${best.target.name}.`
    : `Подобран с приоритетом улучшения района ${best.target.name}, сохраняя общий балл города.`;
  return { ...best.result, recommendation: { focus, targetDistrict: best.target.id, targetName: best.target.name, name: planName, description: planDescription } };
}
