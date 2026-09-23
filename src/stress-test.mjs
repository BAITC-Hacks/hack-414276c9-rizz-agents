import { INDICATORS } from './data.mjs';

const CRISES = [
  {
    id: 'air',
    title: 'Зимнее загрязнение воздуха',
    period: 'Официальная оценка: наблюдения 2022–2024',
    context: 'В холодный сезон на качество воздуха влияют отопление, транспорт и погодные условия. Это городской контекст из отчёта, а не текущие замеры в реальном времени.',
    direct: ['M5', 'M6'],
    related: ['M2'],
    gap: 'Модель показывает только синтетические показатели воздуха и озеленения. Она не рассчитывает концентрации загрязнителей, зимнюю погоду или фактическое снижение смога.',
    suggestion: 'Если в сценарии их нет, рассмотрите чистое топливо для частного сектора или городское озеленение.'
  },
  {
    id: 'traffic',
    title: 'Заторы на центральных улицах и подъездах к мостам',
    period: 'Городской материал, 2025',
    context: 'В публикации о транспорте Астаны описаны заторы на центральных улицах, ведущих к мостам. Данные не являются текущей картой дорожного движения.',
    direct: ['M1', 'M2', 'M3'],
    related: [],
    gap: 'Симулятор меняет общие транспортные показатели, но не моделирует очереди на конкретных улицах, мостах или перекрёстках.',
    suggestion: 'Если транспортных мер нет, рассмотрите автобусные полосы, умные светофоры или ЛРТ. Автобусные полосы и ЛРТ нельзя выбрать вместе по правилам симулятора.'
  },
  {
    id: 'schools',
    title: 'Нагрузка на школы',
    period: 'Данные за 2025 год',
    context: 'По данным управления образования, приведённым Kazinform, дефицит ученических мест составлял 17,4 тысячи; это общегородская цифра, не распределённая по районам в симуляторе.',
    direct: ['M7'],
    related: ['M9'],
    gap: 'Мера школы меняет синтетический показатель социальной инфраструктуры, а спортивные хабы дают дополнительную поддержку. Симулятор не считает реальные школьные места и адреса.',
    suggestion: 'Если школьной меры нет, рассмотрите строительство школы и детсада; спортивные хабы не заменяют новые учебные места.'
  },
  {
    id: 'fires',
    title: 'Пожары в частном жилом секторе зимой',
    period: 'Сезон 2025–2026',
    context: 'ДЧС Астаны сообщал о пожарах в жилом секторе в отопительный сезон и профилактических обходах домов.',
    direct: [],
    related: ['M5'],
    gap: 'В каталоге нет меры по проверке печей, пожарным датчикам или безопасности отопления в домах. Чистое топливо связано с отоплением, но модель не оценивает пожарный риск; уличная безопасность тоже его не заменяет.',
    suggestion: 'Пробел для будущей версии каталога: проверки отопления, дымовые и угарные датчики, адресная профилактика. Этих мер сейчас нет, они не добавляются в расчёт или Score.'
  },
  {
    id: 'heating',
    title: 'Надёжность теплосетей перед зимой',
    period: 'Подготовка к сезону 2026 года',
    context: 'Акимат сообщает о ремонте и реконструкции теплосетей в рамках подготовки к отопительному сезону.',
    direct: ['M13', 'M14'],
    related: [],
    gap: 'Симулятор сравнивает условное влияние на надёжность ЖКХ и скорость реакции. Он не предсказывает реальные аварии и не показывает состояние отдельных труб.',
    suggestion: 'Модернизация сетей — профилактика с более долгим лагом; аварийные бригады — более быстрая реакция на сбои.'
  }
];

const round1 = value => Math.round(value * 10) / 10;

function modeledEffects(action) {
  const share = (8 - Number(action.lag || 0)) / 8;
  return Object.entries(action.effects || {}).map(([id, effect]) => {
    const indicator = INDICATORS.find(item => item.id === id);
    return { name: indicator?.label || 'городской показатель', change: round1(effect * share) };
  });
}

export function assessCityCrises(result) {
  if (!result?.valid || !Array.isArray(result.actions)) throw new Error('Сначала рассчитайте допустимый сценарий.');
  return {
    disclaimer: 'Городской контекст не является оперативной сводкой. Баллы и эффекты районов синтетические; стресс-тест не меняет расчёт сценария.',
    crises: CRISES.map(crisis => {
      const direct = result.actions.filter(action => crisis.direct.includes(action.id));
      const related = result.actions.filter(action => crisis.related.includes(action.id));
      const status = direct.length ? 'direct' : related.length ? 'partial' : 'gap';
      const selected = [
        ...direct.map(action => ({ ...action, role: 'Напрямую связано с показателями симулятора' })),
        ...related.map(action => ({ ...action, role: 'Косвенно связано; прямой эффект на этот риск не считается' }))
      ].map(action => ({
        name: action.label,
        place: action.district,
        role: action.role,
        lag: action.lag,
        effects: modeledEffects(action)
      }));
      return {
        id: crisis.id,
        title: crisis.title,
        period: crisis.period,
        context: crisis.context,
        status,
        statusLabel: status === 'direct' ? 'Есть подходящие меры' : status === 'partial' ? 'Связь частичная' : 'Остаётся пробел',
        selected,
        gap: crisis.gap,
        suggestion: crisis.suggestion
      };
    })
  };
}

export function localStressSummary(report) {
  const directCount = report.crises.filter(crisis => crisis.status === 'direct').length;
  const gaps = report.crises.filter(crisis => crisis.status === 'gap').map(crisis => crisis.title.toLowerCase());
  const gapText = gaps.length ? `Отдельного ответа нет на: ${gaps.join(', ')}.` : 'Прямые пробелы по этим сценариям не выявлены.';
  return `План напрямую связан с ${directCount} из ${report.crises.length} городских сценариев. ${gapText} Это проверка покрытия мер, а не прогноз реальных событий; синтетический Score не меняется.`;
}

export function stressSummaryInput(report) {
  return report.crises.map(crisis => ({
    problem: crisis.title,
    status: crisis.statusLabel,
    selectedMeasures: crisis.selected.map(action => ({
      name: action.name,
      location: action.place,
      role: action.role,
      modeledEffects: action.effects,
      launchDelayQuarters: action.lag
    })),
    modelLimit: crisis.gap,
    alternative: crisis.suggestion
  }));
}
