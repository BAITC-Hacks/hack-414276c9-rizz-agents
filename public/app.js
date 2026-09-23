const $ = id => document.getElementById(id);
const state = { data: null, selected: [], result: null, category: 'Все' };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
}

function setFlowStep(step) {
  document.querySelectorAll('.flow-steps li').forEach((item, index) => {
    item.classList.toggle('is-active', index === step - 1);
    item.classList.toggle('is-done', index < step - 1);
  });
}

function setPlanControls() {
  const districtSelect = $('recommendDistrict');
  const currentValue = districtSelect.value || 'all';
  districtSelect.innerHTML = '<option value="all">Сбалансированный план для города</option>' +
    state.data.districts.map(district => `<option value="${esc(district.id)}">План для района ${esc(district.name)}</option>`).join('');
  districtSelect.value = currentValue;
}

function renderCategoryFilters() {
  const categories = ['Все', ...new Set(state.data.measures.map(measure => measure.area))];
  $('categoryFilters').innerHTML = categories.map(category => {
    const count = category === 'Все' ? state.data.measures.length : state.data.measures.filter(measure => measure.area === category).length;
    return `<button class="category-chip" type="button" data-category="${esc(category)}" aria-pressed="${state.category === category}">${esc(category)} <span>${count}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-category]').forEach(button => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      renderCategoryFilters();
      renderCatalog();
    });
  });
}

function renderSlots() {
  const { measures, districts } = state.data;
  $('slots').innerHTML = Array.from({ length: 5 }, (_, index) => {
    const chosen = state.selected[index];
    if (!chosen) return `<div class="slot"><span class="slot-n">РЕШЕНИЕ 0${index + 1}</span><strong>Добавьте меру из каталога</strong></div>`;
    const measure = measures.find(item => item.id === chosen.measureId);
    const place = measure.type === 'city' ? 'Весь город' : districts.find(item => item.id === chosen.districtId)?.name;
    return `<div class="slot filled"><span class="slot-n">РЕШЕНИЕ 0${index + 1} · ${esc(measure.area)}</span><strong>${esc(measure.label)} · ${esc(place || 'район не выбран')}</strong><button type="button" data-remove="${index}" aria-label="Убрать меру ${esc(measure.label)}">×</button></div>`;
  }).join('');
  document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    state.selected.splice(Number(button.dataset.remove), 1);
    invalidate();
    render();
  }));
}

function renderCatalog() {
  const { measures, districts, indicators, budget } = state.data;
  const visible = state.category === 'Все' ? measures : measures.filter(measure => measure.area === state.category);
  $('catalog').innerHTML = visible.map(measure => {
    const present = state.selected.some(item => item.measureId === measure.id);
    const effect = Object.entries(measure.effects).map(([id, value]) => {
      const indicator = indicators.find(item => item.id === id);
      return `${esc(indicator?.label || id)} ${value > 0 ? '+' : ''}${value}`;
    }).join(' · ');
    const districtSelect = measure.type === 'district'
      ? `<select data-district="${measure.id}" aria-label="Район для меры ${esc(measure.label)}"><option value="">Укажите район</option>${districts.map(district => `<option value="${district.id}">${esc(district.name)}</option>`).join('')}</select>`
      : '<span class="measure-scope">Действует по всему городу</span>';
    return `<article class="measure">
      <div class="measure-copy"><div class="area">${esc(measure.area)}</div><h4>${esc(measure.label)}</h4><div class="meta">${effect} · запуск через ${measure.lag} кв.</div></div>
      <span class="cost">${measure.cost} ед.</span>${districtSelect}
      <button class="add-button" type="button" data-add="${measure.id}" ${present || state.selected.length >= 5 ? 'disabled' : ''}>${present ? 'Добавлено' : 'Добавить +'}</button>
    </article>`;
  }).join('');

  document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
    const measure = measures.find(item => item.id === button.dataset.add);
    const districtId = measure.type === 'district' ? document.querySelector(`[data-district="${measure.id}"]`).value : null;
    if (measure.type === 'district' && !districtId) {
      $('validation').textContent = 'Для этой меры сначала укажите район.';
      return;
    }
    const currentCost = state.selected.reduce((sum, item) => sum + measures.find(entry => entry.id === item.measureId).cost, 0);
    if (currentCost + measure.cost > budget) {
      $('validation').textContent = `На эту меру не хватает бюджета: осталось ${budget - currentCost} ед., стоимость — ${measure.cost} ед.`;
      return;
    }
    const sameCategory = state.selected.filter(item => measures.find(entry => entry.id === item.measureId).area === measure.area).length;
    if (sameCategory >= 2) {
      $('validation').textContent = `Уже выбраны две меры в категории «${measure.area}». Выберите другое направление.`;
      return;
    }
    const selectedIds = new Set(state.selected.map(item => item.measureId));
    if ((measure.id === 'M1' && selectedIds.has('M3')) || (measure.id === 'M3' && selectedIds.has('M1'))) {
      $('validation').textContent = 'Выберите автобусные полосы или линию ЛРТ: эти варианты несовместимы.';
      return;
    }
    const conflicts = [['M4', 'M7'], ['M5', 'M13']];
    const conflict = conflicts.some(([left, right]) => {
      const otherId = measure.id === left ? right : measure.id === right ? left : null;
      const other = state.selected.find(item => item.measureId === otherId);
      return Boolean(other && other.districtId === districtId);
    });
    if (conflict) {
      $('validation').textContent = 'Эти две меры нельзя проводить в одном районе. Выберите другой район или замените одну из них.';
      return;
    }
    state.selected.push({ measureId: measure.id, districtId });
    invalidate();
    render();
  }));

  document.querySelectorAll('[data-district]').forEach(select => select.addEventListener('change', () => {
    $('validation').textContent = '';
  }));
}

function render() {
  const { measures, budget } = state.data;
  const spent = state.selected.reduce((sum, selection) => sum + measures.find(measure => measure.id === selection.measureId).cost, 0);
  const missing = 5 - state.selected.length;
  $('spent').textContent = spent;
  $('budgetStatus').textContent = `Осталось ${budget - spent} ед.`;
  $('budgetStatus').classList.toggle('over-budget', spent > budget);
  $('budgetBar').style.width = `${Math.min(100, spent / budget * 100)}%`;
  $('budgetBar').style.background = spent > budget ? '#d56b57' : '';
  $('selectionStatus').textContent = missing === 0 ? 'Выбраны все 5 мер. Можно рассчитать сценарий.' : `Выбрано ${state.selected.length} из 5 мер · осталось добавить ${missing}.`;
  $('selectionStatus').classList.toggle('ready', missing === 0);
  $('calculate').disabled = missing !== 0;
  $('calculate').textContent = missing === 0 ? 'Рассчитать сценарий →' : `Добавьте ещё ${missing} мер`;
  setFlowStep(missing === 0 ? 2 : 1);
  renderSlots();
  renderCategoryFilters();
  renderCatalog();
}

function invalidate() {
  state.result = null;
  $('defensePanel').hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;
  $('analyze').disabled = true;
  $('analyze').textContent = 'Сначала рассчитайте сценарий →';
  $('stressTest').disabled = true;
  $('stressTest').textContent = 'Сначала рассчитайте сценарий →';
  $('stressBadge').textContent = 'ПОСЛЕ РАСЧЁТА';
  $('stressResults').replaceChildren();
  $('stressResults').hidden = true;
  $('aiBadge').textContent = 'ЖДЁТ РАСЧЁТА';
  $('planNotice').hidden = true;
  $('score').textContent = '—';
  $('scoreChange').textContent = 'Сначала рассчитайте сценарий';
  $('districtResults').innerHTML = '<p class="empty-state">После расчёта здесь появится диаграмма пяти районов.</p>';
  $('agentText').textContent = 'Сначала выберите пять мер и рассчитайте сценарий. AI коротко объяснит пользу, риски и следующий шаг.';
  $('validation').textContent = '';
}

function showResult(result) {
  state.result = result;
  if (!result.valid) {
    setFlowStep(2);
    $('validation').textContent = result.issues.join(' ');
    return;
  }
  setFlowStep(4);
  $('validation').textContent = '';
  $('score').textContent = result.score.toFixed(2).replace('.', ',');
  $('scoreChange').textContent = `${result.delta >= 0 ? '+' : ''}${result.delta.toFixed(2).replace('.', ',')} к исходному баллу`;
  const fmt = value => Number(value).toFixed(1).replace('.', ',');
  const cityBefore = Number(result.baseScore) || 0;
  const cityAfter = Number(result.score) || 0;
  const cityChange = cityAfter - cityBefore;
  $('districtResults').innerHTML = `<div class="chart-legend"><span><i class="legend-before"></i>До мер</span><span><i class="legend-after"></i>После мер</span><small>Шкала от 0 до 100</small></div>
    <div class="district-compare city-compare" aria-label="Весь город: до мер ${fmt(cityBefore)}, после мер ${fmt(cityAfter)}">
      <div class="district-compare-head"><strong>Весь город</strong><span class="district-change ${cityChange >= 0 ? 'up' : 'down'}">${cityChange >= 0 ? '+' : ''}${fmt(cityChange)}</span></div>
      <div class="compare-line"><span>До</span><div class="compare-track"><i class="before-bar" style="width:${Math.max(0, Math.min(100, cityBefore))}%"></i></div><b>${cityBefore.toFixed(2).replace('.', ',')}</b></div>
      <div class="compare-line"><span>После</span><div class="compare-track"><i class="after-bar" style="width:${Math.max(0, Math.min(100, cityAfter))}%"></i></div><b>${cityAfter.toFixed(2).replace('.', ',')}</b></div>
    </div>
    ${result.districts.map(district => {
    const before = Number(district.before) || 0;
    const after = Number(district.score) || 0;
    const change = after - before;
    return `<div class="district-compare" aria-label="${esc(district.name)}: до мер ${fmt(before)}, после мер ${fmt(after)}">
      <div class="district-compare-head"><strong>${esc(district.name)}</strong><span class="district-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${fmt(change)}</span></div>
      <div class="compare-line"><span>До</span><div class="compare-track"><i class="before-bar" style="width:${Math.max(0, Math.min(100, before))}%"></i></div><b>${fmt(before)}</b></div>
      <div class="compare-line"><span>После</span><div class="compare-track"><i class="after-bar" style="width:${Math.max(0, Math.min(100, after))}%"></i></div><b>${fmt(after)}</b></div>
    </div>`;
  }).join('')}`;
  $('agentText').textContent = `Потрачено ${result.cost} из 100 ед. Осталось ${result.remaining} ед. Нажмите, чтобы увидеть короткое объяснение.`;
  $('analyze').disabled = false;
  $('analyze').textContent = 'Объяснить результат →';
  $('stressTest').disabled = false;
  $('stressTest').innerHTML = 'Проверить план на кризисы <span aria-hidden="true">→</span>';
  $('stressBadge').textContent = 'ГОТОВ К ПРОВЕРКЕ';
  $('aiBadge').textContent = 'ГОТОВ';
  if (result.recommendation) {
    $('planNotice').innerHTML = `<strong>${esc(result.recommendation.name)}</strong><span>${esc(result.recommendation.description)}</span>`;
    $('planNotice').hidden = false;
  }
  initDefenseMode(result);
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits).replace('.', ',');
}

function formatSigned(value, digits = 2) {
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${formatNumber(number, digits)}`;
}

function weakestIndicator(result) {
  const entries = result.districts.flatMap(district => Object.entries(district.indicators || {}).map(([id, value]) => ({
    district,
    id,
    value: Number(value)
  }))).filter(item => Number.isFinite(item.value));
  return entries.sort((left, right) => left.value - right.value)[0] || null;
}

function initDefenseMode(result) {
  $('defensePanel').hidden = false;
  $('alternativeError').hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;

  const weak = weakestIndicator(result);
  const indicator = state.data.indicators.find(item => item.id === weak?.id);
  $('redTeamChallenge').textContent = weak && indicator
    ? `Возражение: «${indicator.label}» в районе ${weak.district.name} — самое низкое значение после плана: ${formatNumber(weak.value, 1)} из 100. Проверьте, изменит ли это выбранная альтернатива.`
    : 'Возражение: проверьте, какой районный показатель остаётся самым низким после плана.';

  $('alternativeSlot').innerHTML = result.actions.map((action, index) =>
    `<option value="${index}">${index + 1}. ${esc(action.label)} · ${esc(action.district)}</option>`
  ).join('');
  fillAlternativeChoices(0);
}

function fillAlternativeChoices(slotIndex) {
  const original = state.result?.selected[slotIndex];
  if (!original) return;
  const usedElsewhere = new Set(state.result.selected.filter((_, index) => index !== slotIndex).map(selection => selection.measureId));
  const options = state.data.measures.filter(measure => !usedElsewhere.has(measure.id));
  $('alternativeMeasure').innerHTML = options.map(measure =>
    `<option value="${esc(measure.id)}">${esc(measure.label)} · ${measure.cost} ед.</option>`
  ).join('');
  $('alternativeMeasure').value = original.measureId;
  updateAlternativeDistrict(original.districtId);
}

function updateAlternativeDistrict(preferredDistrictId = null) {
  const measure = state.data.measures.find(item => item.id === $('alternativeMeasure').value);
  const field = $('alternativeDistrictField');
  const select = $('alternativeDistrict');
  const isDistrictMeasure = measure?.type === 'district';
  const previous = select.value;
  field.hidden = !isDistrictMeasure;
  select.disabled = !isDistrictMeasure;
  if (!isDistrictMeasure) return;
  select.innerHTML = state.data.districts.map(district =>
    `<option value="${esc(district.id)}">${esc(district.name)}</option>`
  ).join('');
  const requested = preferredDistrictId || previous;
  select.value = state.data.districts.some(district => district.id === requested)
    ? requested
    : state.data.districts[0].id;
}

function renderAlternativeComparison(original, alternative, slotIndex) {
  const box = $('alternativeComparison');
  const fmt = value => formatNumber(value, 2);
  const scoreChange = Number(alternative.score) - Number(original.score);
  const costChange = Number(alternative.cost) - Number(original.cost);
  const originalAction = original.actions[slotIndex];
  const alternativeAction = alternative.actions[slotIndex];
  const originalSelection = original.selected[slotIndex];
  const alternativeSelection = alternative.selected[slotIndex];
  const changeDescription = originalSelection.measureId === alternativeSelection.measureId
    ? `Перенос: «${originalAction.label}» · ${originalAction.district} → ${alternativeAction.district}`
    : `Замена: «${originalAction.label}» → «${alternativeAction.label}» · ${alternativeAction.district}`;
  const rows = original.districts.map(district => {
    const other = alternative.districts.find(item => item.id === district.id);
    const difference = Number(other.score) - Number(district.score);
    return `<tr><th scope="row">${esc(district.name)}</th><td>${fmt(district.score)}</td><td>${fmt(other.score)}</td><td class="${difference > 0 ? 'comparison-up' : difference < 0 ? 'comparison-down' : ''}">${formatSigned(difference, 2)}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="alternative-score-grid">
      <div class="alternative-score-card"><span>Исходный план</span><strong>${fmt(original.score)} <small>из 100</small></strong><small>Расходы: ${original.cost} ед.</small></div>
      <div class="alternative-score-card is-alternative"><span>Альтернатива</span><strong>${fmt(alternative.score)} <small>из 100</small></strong><small>Расходы: ${alternative.cost} ед.</small></div>
    </div>
    <p class="alternative-total-change">Разница: Score ${formatSigned(scoreChange, 2)} · расходы ${formatSigned(costChange, 0)} ед.</p>
    <div class="comparison-table-wrap"><table class="comparison-table"><caption>Результаты по районам</caption><thead><tr><th scope="col">Район</th><th scope="col">Исходный</th><th scope="col">Альтернатива</th><th scope="col">Разница</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="alternative-change-note">${esc(changeDescription)}</p>`;

  const weakest = weakestIndicator(alternative);
  const weakestLabel = state.data.indicators.find(item => item.id === weakest?.id)?.label;
  const chosen = alternative.actions.map(action => action.label).join(', ');
  const briefing = [
    `План: ${chosen}.`,
    `${changeDescription}.`,
    `Городской Score: ${fmt(original.score)} → ${fmt(alternative.score)} (${formatSigned(scoreChange, 2)}); расходы: ${original.cost} → ${alternative.cost} из 100 ед.`,
    weakest && weakestLabel ? `Компромисс: показатель «${weakestLabel}» в районе ${weakest.district.name} остаётся самым низким — ${formatNumber(weakest.value, 1)} из 100.` : '',
    'Районные оценки в этом сценарии синтетические.'
  ].filter(Boolean);
  $('briefingText').textContent = briefing.join('\n');
  box.hidden = false;
  $('mayorBriefing').hidden = false;
}

function renderAnalysis(text) {
  const box = $('agentText');
  box.replaceChildren();
  box.classList.remove('error');
  const normalized = String(text).replace(/\r/g, '').replace(/\s+(?=(?:Итог|Польза|Что учесть|Риск|Следующий шаг|На что обратить внимание)\s*[:—-])/gi, '\n');
  for (const raw of normalized.split('\n').map(line => line.trim()).filter(Boolean)) {
    const line = raw.replace(/^(?:[-*•]\s*)/, '').replace(/\*\*/g, '');
    const paragraph = document.createElement('p');
    const heading = line.match(/^(Итог|Польза|Что учесть|Риск|Следующий шаг|На что обратить внимание)\s*[:—-]\s*(.*)$/i);
    if (heading) {
      const strong = document.createElement('strong');
      strong.textContent = `${heading[1]} `;
      paragraph.append(strong, document.createTextNode(heading[2]));
    } else paragraph.textContent = line;
    box.appendChild(paragraph);
  }
}

function renderStressReport(report) {
  const box = $('stressResults');
  box.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'stress-summary';
  summary.textContent = report.summary;
  box.appendChild(summary);
  if (report.note) {
    const note = document.createElement('p');
    note.className = 'stress-note';
    note.textContent = report.note;
    box.appendChild(note);
  }
  const disclaimer = document.createElement('p');
  disclaimer.className = 'stress-disclaimer';
  disclaimer.textContent = report.disclaimer;
    box.appendChild(disclaimer);
    for (const crisis of report.crises) {
      const card = document.createElement('details');
      card.className = `crisis-card crisis-${crisis.status}`;
      const heading = document.createElement('summary');
      heading.className = 'crisis-card-title';
      heading.innerHTML = `<span><strong>${esc(crisis.title)}</strong><small>${esc(crisis.period)}</small></span><span class="crisis-status">${esc(crisis.statusLabel)}</span>`;
      card.appendChild(heading);
      const measures = crisis.selected.length ? crisis.selected.map(action => {
      const effects = action.effects.map(effect => `${effect.name} ${effect.change > 0 ? '+' : ''}${String(effect.change).replace('.', ',')}`).join(' · ');
      return `<li><strong>${esc(action.name)}</strong><span>${esc(action.place)} · ${esc(effects)} · запуск через ${action.lag} кв.</span><small>${esc(action.role)}</small></li>`;
    }).join('') : '<li class="no-measures">В выбранном плане нет подходящей меры.</li>';
      const body = document.createElement('div');
      body.className = 'crisis-body';
      body.innerHTML = `<p>${esc(crisis.context)}</p><ul class="crisis-measures">${measures}</ul>
        <p class="crisis-limit"><strong>Граница модели:</strong> ${esc(crisis.gap)}</p>
        <p class="crisis-suggestion"><strong>Вариант для сравнения:</strong> ${esc(crisis.suggestion)}</p>`;
      card.appendChild(body);
      box.appendChild(card);
  }
  box.hidden = false;
}

$('calculate').addEventListener('click', async () => {
  const button = $('calculate');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Рассчитываем…';
  $('validation').textContent = '';
  setFlowStep(3);
  try {
    showResult(await api('/api/evaluate', { method: 'POST', body: JSON.stringify({ selections: state.selected }) }));
  } catch (error) {
    setFlowStep(2);
    $('validation').textContent = error.message;
  } finally {
    button.disabled = state.selected.length !== 5;
    button.removeAttribute('aria-busy');
    button.textContent = 'Рассчитать сценарий →';
  }
});

$('recommend').addEventListener('click', async () => {
  const button = $('recommend');
  const focus = $('recommendDistrict').value;
  button.disabled = true;
  button.textContent = 'Подбираем…';
  $('validation').textContent = '';
  try {
    const plan = await api(`/api/recommend?district=${encodeURIComponent(focus)}`);
    state.selected = plan.selected;
    invalidate();
    render();
    showResult(plan);
  } catch (error) {
    $('validation').textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Подобрать план <span aria-hidden="true">→</span>';
  }
});

$('analyze').addEventListener('click', async () => {
  if (!state.result) return;
  const button = $('analyze');
  button.disabled = true;
  $('aiBadge').textContent = 'АНАЛИЗИРУЕТ';
  $('agentText').textContent = 'Готовим короткий разбор сценария…';
  try {
    const output = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ result: state.result }) });
    renderAnalysis(output.text);
    $('aiBadge').textContent = output.source === 'openai' ? 'AI-АНАЛИЗ' : 'АВТОРАЗБОР';
    if (output.note) {
      const notice = document.createElement('p');
      notice.className = 'agent-note';
      notice.textContent = output.note;
      $('agentText').appendChild(notice);
    }
  } catch (error) {
    $('agentText').textContent = error.message;
    $('agentText').classList.add('error');
    $('aiBadge').textContent = 'ОШИБКА';
  } finally {
    button.disabled = false;
    button.textContent = 'Объяснить ещё раз →';
  }
});

$('stressTest').addEventListener('click', async () => {
  if (!state.result?.valid) return;
  const button = $('stressTest');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Проверяем риски…';
  $('stressBadge').textContent = 'ИДЁТ ПРОВЕРКА';
  $('stressResults').hidden = true;
  try {
    const report = await api('/api/stress-test', { method: 'POST', body: JSON.stringify({ result: state.result }) });
    renderStressReport(report);
    $('stressBadge').textContent = report.source === 'openai' ? 'AI-ШТАБ' : 'АВТОПРОВЕРКА';
  } catch (error) {
    const results = $('stressResults');
    results.textContent = error.message;
    results.hidden = false;
    $('stressBadge').textContent = 'ОШИБКА';
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = 'Проверить ещё раз <span aria-hidden="true">→</span>';
  }
});

$('alternativeSlot').addEventListener('change', event => {
  fillAlternativeChoices(Number(event.target.value));
  $('alternativeError').hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;
});

$('alternativeMeasure').addEventListener('change', () => {
  const slotIndex = Number($('alternativeSlot').value);
  updateAlternativeDistrict(state.result?.selected[slotIndex]?.districtId || null);
  $('alternativeError').hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;
});

$('alternativeDistrict').addEventListener('change', () => {
  $('alternativeError').hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;
});

$('compareAlternative').addEventListener('click', async () => {
  if (!state.result?.valid) return;
  const button = $('compareAlternative');
  const slotIndex = Number($('alternativeSlot').value);
  const measure = state.data.measures.find(item => item.id === $('alternativeMeasure').value);
  const error = $('alternativeError');
  error.hidden = true;
  $('alternativeComparison').hidden = true;
  $('mayorBriefing').hidden = true;

  if (!measure || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= state.result.selected.length) {
    error.textContent = 'Выберите меру для изменения.';
    error.hidden = false;
    return;
  }

  const candidate = state.result.selected.map(selection => ({ ...selection }));
  candidate[slotIndex] = {
    measureId: measure.id,
    districtId: measure.type === 'district' ? $('alternativeDistrict').value : null
  };
  if (candidate.every((selection, index) => selection.measureId === state.result.selected[index].measureId && selection.districtId === state.result.selected[index].districtId)) {
    error.textContent = 'Выберите другую меру или другой район, чтобы получить альтернативный сценарий.';
    error.hidden = false;
    return;
  }

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = 'Сравниваем планы…';
  try {
    const alternative = await api('/api/evaluate', { method: 'POST', body: JSON.stringify({ selections: candidate }) });
    if (!alternative.valid) throw new Error(alternative.issues.join(' '));
    renderAlternativeComparison(state.result, alternative, slotIndex);
  } catch (failure) {
    error.textContent = failure.message || 'Не удалось рассчитать альтернативу.';
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = 'Проверить альтернативу <span aria-hidden="true">→</span>';
  }
});

try {
  state.data = await api('/api/data');
  setPlanControls();
  render();
} catch (error) {
  $('validation').textContent = `Не удалось загрузить данные. Обновите страницу или перезапустите сайт. ${error.message}`;
}
