import { DATA, DISTRICTS, INDICATORS, WEIGHTS } from './data.mjs';
const DISTRICT_IDS = new Set(DISTRICTS.map(d => d.id));
const round = n => Math.round(n * 100) / 100;
const clip = n => Math.max(0, Math.min(100, n));
const weighted = values => INDICATORS.reduce((sum, k) => sum + values[k.id] * WEIGHTS[k.id], 0);

export function evaluateScenario(selections = []) {
  const issues = [];
  if (!Array.isArray(selections)) selections = [];
  if (selections.length !== 5) issues.push(`Нужно выбрать ровно 5 мер (сейчас ${selections.length}).`);
  const ids = selections.map(s => s?.measureId);
  if (new Set(ids).size !== ids.length) issues.push('Нельзя выбирать одну меру повторно.');
  const measures = selections.map(s => DATA.measures.find(m => m.id === s?.measureId)).filter(Boolean);
  if (measures.length !== selections.length) issues.push('В выборе есть неизвестная мера.');
  let cost = 0;
  const selected = selections.map((s, i) => ({ measure: measures[i], districtId: s?.districtId || null })).filter(x => x.measure);
  for (const { measure, districtId } of selected) {
    cost += measure.cost;
    if (measure.type === 'district' && !DISTRICT_IDS.has(districtId)) issues.push(`${measure.id}: выберите район.`);
    if (measure.type === 'city' && districtId) issues.push(`${measure.id}: это городская мера, район выбирать не нужно.`);
  }
  if (cost > DATA.budget) issues.push(`Бюджет превышен: ${cost} из ${DATA.budget}.`);
  const perArea = {};
  for (const { measure } of selected) perArea[measure.area] = (perArea[measure.area] || 0) + 1;
  const overArea = Object.entries(perArea).filter(([, count]) => count > 2).map(([area]) => area);
  if (overArea.length) issues.push(`Не больше двух мер на направление: ${overArea.join(', ')}.`);
  const has = id => selected.some(x => x.measure.id === id);
  if (has('M1') && has('M3')) issues.push('M1 и M3 несовместимы: выберите автобусные полосы или ЛРТ.');
  for (const [a,b,reason] of [['M4','M7','M4 и M7 нельзя разместить в одном районе.'],['M5','M13','M5 и M13 дублируют друг друга в одном районе.']]) {
    const first=selected.find(x=>x.measure.id===a), second=selected.find(x=>x.measure.id===b);
    if(first&&second&&first.districtId===second.districtId) issues.push(reason);
  }
  if (issues.length) return { valid:false, issues:[...new Set(issues)], cost, remaining:DATA.budget-cost };

  const values = Object.fromEntries(DATA.districts.map(d => [d.id,{...d.indicators}]));
  for (const {measure,districtId} of selected) {
    const targets = measure.type==='city' ? DISTRICTS.map(d=>d.id) : [districtId];
    const fraction=(8-measure.lag)/8;
    for(const target of targets) for(const [k,effect] of Object.entries(measure.effects)) values[target][k]+=effect*fraction;
  }
  const synergy = (left,right,indicator,bonus) => {
    const a=selected.find(x=>x.measure.id===left), b=selected.find(x=>x.measure.id===right);
    if(a&&b) values[a.districtId][indicator]+=bonus;
  };
  synergy('M1','M2','T1',2); synergy('M10','M12','B1',2); synergy('M5','M6','E2',2);
  for(const district of DISTRICTS) for(const k of INDICATORS) values[district.id][k.id]=clip(values[district.id][k.id]);
  const districtScores=DISTRICTS.map(d=>({id:d.id,name:d.name,population:d.population,before:round(weighted(DATA.districts.find(x=>x.id===d.id).indicators)),score:round(weighted(values[d.id])),indicators:values[d.id]}));
  const beforeAvg=DISTRICTS.reduce((s,d)=>s+d.population*weighted(DATA.districts.find(x=>x.id===d.id).indicators),0);
  const afterAvg=districtScores.reduce((s,d)=>s+d.population*d.score,0);
  const crit=districtScores.reduce((sum,d)=>sum+INDICATORS.filter(k=>d.indicators[k.id]<40).length,0);
  const baseCrit=DATA.districts.reduce((sum,d)=>sum+INDICATORS.filter(k=>d.indicators[k.id]<40).length,0);
  const score=round(.7*afterAvg+.3*Math.min(...districtScores.map(d=>d.score))-crit);
  const baseScore=round(.7*beforeAvg+.3*Math.min(...DATA.districts.map(d=>weighted(d.indicators)))-baseCrit);
  const actions=selected.map(({measure,districtId})=>({id:measure.id,label:measure.label,district:measure.type==='city'?'Весь город':DISTRICTS.find(d=>d.id===districtId).name,area:measure.area,effects:measure.effects,lag:measure.lag}));
  return {valid:true,cost,remaining:DATA.budget-cost,baseScore,score,delta:round(score-baseScore),districts:districtScores,indicatorsAfter:INDICATORS.map(k=>({id:k.id,label:k.label,area:k.area,after:round(DISTRICTS.reduce((sum,d)=>sum+d.population*values[d.id][k.id],0))})),actions,criticalCount:crit,selected:selected.map(x=>({measureId:x.measure.id,districtId:x.districtId}))};
}

export function recommendedScenario() {
  const selections=[{measureId:'M1',districtId:'nura'},{measureId:'M7',districtId:'nura'},{measureId:'M8',districtId:'nura'},{measureId:'M10',districtId:'nura'},{measureId:'M12',districtId:null}];
  return evaluateScenario(selections);
}
