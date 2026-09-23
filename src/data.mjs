export const DISTRICTS = [
  { id: 'esil', name: 'Есиль', population: 0.27 }, { id: 'almaty', name: 'Алматы', population: 0.24 },
  { id: 'saryarka', name: 'Сарыарка', population: 0.20 }, { id: 'baikonur', name: 'Байконур', population: 0.13 }, { id: 'nura', name: 'Нура', population: 0.16 }
];
export const INDICATORS = [
  { id: 'T1', label: 'Разгрузка дорог', area: 'Транспорт' }, { id: 'T2', label: 'Общественный транспорт', area: 'Транспорт' },
  { id: 'E1', label: 'Озеленение', area: 'Озеленение' }, { id: 'E2', label: 'Качество воздуха', area: 'Озеленение' },
  { id: 'S1', label: 'Школы и детсады', area: 'Соцсфера' }, { id: 'S2', label: 'Поликлиники', area: 'Соцсфера' },
  { id: 'B1', label: 'Безопасность улиц', area: 'Безопасность' }, { id: 'B2', label: 'Безопасность дорог', area: 'Безопасность' },
  { id: 'C1', label: 'Надёжность ЖКХ', area: 'Сервисы' }, { id: 'C2', label: 'Ответы на обращения', area: 'Сервисы' }
];
export const WEIGHTS = { T1: .10, T2: .10, E1: .09, E2: .11, S1: .11, S2: .11, B1: .09, B2: .09, C1: .10, C2: .10 };
const rows = [
  ['esil', [45,62,68,72,48,55,78,60,75,70]], ['almaty', [40,75,50,55,60,65,62,52,50,60]],
  ['saryarka', [50,70,42,40,62,68,58,55,45,55]], ['baikonur', [52,68,55,50,58,60,52,58,55,58]],
  ['nura', [55,40,45,65,38,35,55,50,60,50]]
];
export const DATA = {
  budget: 100, baseScore: 52.56,
  districts: rows.map(([id, values]) => ({ id, indicators: Object.fromEntries(INDICATORS.map((indicator, i) => [indicator.id, values[i]])) })),
  measures: [
    { id:'M1',area:'Транспорт',label:'Выделенные полосы для автобусов',type:'district',cost:18,lag:2,effects:{T1:6,T2:9} },
    { id:'M2',area:'Транспорт',label:'Умные светофоры',type:'city',cost:22,lag:2,effects:{T1:4,B2:3} },
    { id:'M3',area:'Транспорт',label:'Линия ЛРТ / расширение',type:'district',cost:30,lag:4,effects:{T1:16,T2:20,E2:4} },
    { id:'M4',area:'Озеленение',label:'Парк / сквер',type:'district',cost:15,lag:2,effects:{E1:12,E2:3,B1:2} },
    { id:'M5',area:'Озеленение',label:'Чистое топливо для частного сектора',type:'district',cost:25,lag:3,effects:{E2:14,C1:4} },
    { id:'M6',area:'Озеленение',label:'Озеленение и ветрозащитные полосы',type:'city',cost:20,lag:4,effects:{E1:5,E2:3} },
    { id:'M7',area:'Соцсфера',label:'Школа и детсад',type:'district',cost:24,lag:3,effects:{S1:16} },
    { id:'M8',area:'Соцсфера',label:'Центр семейного здоровья',type:'district',cost:20,lag:3,effects:{S2:14} },
    { id:'M9',area:'Соцсфера',label:'Дворовые спорт-хабы',type:'district',cost:10,lag:1,effects:{S1:3,S2:3,B1:3} },
    { id:'M10',area:'Безопасность',label:'Освещение и камеры Safe City',type:'district',cost:12,lag:1,effects:{B1:12,B2:2} },
    { id:'M11',area:'Безопасность',label:'Безопасные переходы',type:'district',cost:10,lag:1,effects:{B2:12,T1:-2} },
    { id:'M12',area:'Сервисы',label:'Платформа обращений жителей',type:'city',cost:14,lag:1,effects:{C2:5} },
    { id:'M13',area:'Сервисы',label:'Модернизация тепло- и водосетей',type:'district',cost:28,lag:4,effects:{C1:18,E2:2} },
    { id:'M14',area:'Сервисы',label:'Аварийные бригады ЖКХ',type:'city',cost:16,lag:1,effects:{C1:5,C2:2} }
  ]
};
