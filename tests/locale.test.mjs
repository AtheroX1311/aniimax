import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { LANGUAGES, SOURCE_LANGUAGE } from '../web/locales/languages.js';
import { RETYPESET_LANGUAGES } from '../web/math-retypeset.js';

// Every registered language has a catalog and every catalog is registered, so a new language needs
// only its entry in languages.js and its JSON file.
const locales = new URL('../web/locales/', import.meta.url);
const codes = LANGUAGES.map(({ code }) => code);
assert.equal(new Set(codes).size, codes.length, 'language codes are unique');
assert.ok(codes.includes(SOURCE_LANGUAGE));
const catalogFiles = (await readdir(locales)).filter(file => file.endsWith('.json')).map(file => file.slice(0, -'.json'.length));
assert.deepEqual(new Set(catalogFiles), new Set(codes), 'each language in languages.js has web/locales/<code>.json');
for (const { code, name, rules = 'spaced', joiners } of LANGUAGES) {
    assert.ok(name, `${code} has a selector label`);
    assert.ok(['spaced', 'cjk'].includes(rules), `${code} rules`);
    assert.ok(rules === 'cjk' || !joiners, `${code}: joiners apply only to 'cjk' rules`);
}
assert.deepEqual(RETYPESET_LANGUAGES, new Set(codes.filter(code => code !== SOURCE_LANGUAGE)));

// Each translation keeps the placeholders of its English phrase, and a complete catalog holds every
// phrase that en.json inventories.
const english = JSON.parse(await readFile(new URL(`${SOURCE_LANGUAGE}.json`, locales)));
for (const { code, complete } of LANGUAGES.filter(({ code }) => code !== SOURCE_LANGUAGE)) {
    const catalog = JSON.parse(await readFile(new URL(`${code}.json`, locales)));
    if (complete) assert.deepEqual(new Set(Object.keys(catalog)), new Set(english), `${code}.json holds exactly en.json's phrases`);
    for (const [source, target] of Object.entries(catalog)) {
        const slots = text => new Set(text.match(/\{[a-z_]+\}/gi) || []);
        assert.deepEqual(slots(source), slots(target), `${code}: ${source}`);
    }
}

const saved = new Map([['aniimax-language', 'ru']]);
globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
let releaseCatalog;
globalThis.fetch = async url => {
    await new Promise(resolve => { releaseCatalog = resolve; });
    return { ok: true, json: async () => JSON.parse(await readFile(url)) };
};
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
const node = { nodeType: 3, nodeValue: 'Your Homeland' };
const labelled = {
    nodeType: 1, values: new Map([['data-label', 'Profit']]),
    hasAttribute(name) { return this.values.has(name); },
    getAttribute(name) { return this.values.get(name); },
    setAttribute(name, value) { this.values.set(name, value); },
};
const body = { nodeType: 1, hasAttribute: () => false };
let change;
const selector = { value: 'en', add() {}, addEventListener: (_, listener) => { change = listener; } };
globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
globalThis.document = {
    body, documentElement: { lang: 'en' }, title: '', getElementById: () => selector,
    dispatchEvent() {},
    createTreeWalker: () => ({ currentNode: null, index: 0, nextNode() {
        this.currentNode = [node, labelled][this.index++];
        return !!this.currentNode;
    } }),
};
globalThis.MutationObserver = class { observe() {} };

const { translate, languageReady } = await import('../web/i18n.js');
assert.equal(node.nodeValue, 'Your Homeland');
assert.equal(document.documentElement.lang, 'en');
assert.equal(selector.value, 'ru');
assert.equal(saved.get('aniimax-language'), 'ru');

const appSource = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const handlerStart = appSource.indexOf("document.addEventListener('aniimax-language-change'");
const handlerEnd = appSource.indexOf('async function loadRecipeIndex()', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerSource = appSource.slice(handlerStart, handlerEnd);
const englishRecipe = 'Wheat (Farmland)';
const russianRecipe = 'Пшеница (Пахотная земля)';
for (const [before, after, typed] of [
    [englishRecipe, russianRecipe, englishRecipe],
    [russianRecipe, englishRecipe, russianRecipe],
    [englishRecipe, russianRecipe, 'unfinished recipe'],
]) {
    const input = { value: typed, validity: 'previous error', setCustomValidity(value) { this.validity = value; } };
    const options = { options: [{ value: before }] };
    let languageChanged;
    runInNewContext(handlerSource, {
        document: {
            addEventListener: (_, listener) => { languageChanged = listener; },
            getElementById: id => id === 'skip-input' ? input : options,
        },
        renderRecipeOptions: () => { options.options = [{ value: after }]; },
    });
    languageChanged();
    assert.equal(input.value, typed === before ? after : typed);
    assert.equal(input.validity, typed === before ? '' : 'previous error');
}
releaseCatalog();
await languageReady;
assert.equal(node.nodeValue, 'Ваша Родина');
assert.equal(document.documentElement.lang, 'ru');
assert.equal(labelled.getAttribute('data-label'), 'Прибыль');
assert.equal(translate('Used for Wheat; the rest sells directly'), 'Используется для Пшеница; остаток продаётся напрямую');
assert.equal(translate('in 2h 4m'), 'через 2ч 4м');
assert.equal(translate('20 (everything unlocked)'), '20 (всё открыто)');
assert.equal(translate('2 on'), '2 активных');
assert.equal(translate('3 skipped'), '3 исключённых');
assert.equal(translate('+ Add level'), '+ Добавить уровень');
assert.equal(translate('Start from the Best team'), 'Начать с лучшей команды');
assert.equal(translate('Faithful or Tenacious'), 'Верный или Упорный');
assert.equal(translate('unmapped term'), 'unmapped term');
assert.equal(translate('Unknown status'), 'Unknown status');
assert.equal(translate('Home Coins/min'), 'Монеты дома/мин');
assert.equal(translate('Plot 1'), 'Участок 1');
assert.equal(translate('RV 13'), 'Автодом 13');
assert.equal(translate('Farmland, Wheat, 20 trips/hour · 2.0 tiles from storage'), 'Пахотная земля, Пшеница, 20 рейсов/ч · расстояние до склада: 2.0 клет.');
assert.equal(translate('Storage Unit, Where everything is carried, 20 trips/hour'), 'Склад, сюда доставляют всё произведённое, 20 рейсов/ч');
assert.equal(translate('Fire: Cooking, smelting and heat'), 'Огонь: Готовка, плавка и нагрев');
assert.equal(translate('Fire level'), 'Уровень способности Огонь');
assert.equal(translate('Grass Lv.1'), 'Трава ур. 1');
assert.equal(translate('Flowers in a Bottle'), 'Цветы в бутылке');
assert.equal(translate('nothing to check · 1 ms'), 'нечего проверять · 1 мс');
assert.equal(translate('40 ms'), '40 мс');
assert.equal(translate(' · 19 ms'), ' · 19 мс');
assert.equal(translate(' · 1.2 s'), ' · 1.2 с');
assert.equal(translate('1.2 s'), '1.2 с');
assert.equal(translate('No level-4 Perfumery Aniimo is known in the game yet'), 'Анимо способности «Парфюмерия» уровня 4 пока не встречались в игре');
assert.equal(translate('No level-4 Perfumery Aniimo is known in the game yet. Plan as though you have one?'), 'Анимо способности «Парфюмерия» уровня 4 пока не встречались в игре. Считать, что такой Анимо у вас есть?');
assert.equal(translate('Grass Lv.1 · Sowing farmland'), 'Трава ур. 1 · Посев на пашне');
assert.equal(translate('Hauling, any level · carries produce to storage; add more if produce piles up'), 'Перенос, любой уровень · доставляет продукцию на склад; добавьте больше Анимо, если она скапливается');
assert.equal(translate('Instinctive or Energetic'), 'Инстинктивный или Энергичный');
// Labels glued together from catalog phrases are translated part by part.
assert.equal(translate('Plant cost: 1'), 'Стоимость посадки: 1');
assert.equal(translate('3× Heat Furnace (Scorching)'), '3× Тепловая печь (Жара)');
assert.equal(translate('Woodland: Cocoa ×2'), 'Лесной массив: Какао ×2');
assert.equal(translate('Heat Furnace 1'), 'Тепловая печь 1');
assert.equal(translate('Fire Lv.4 · Nimble (N) (+20% speed) · Blazing Stove (Cranberry Chocolate)'), 'Огонь ур. 4 · Шустрый (N) (+20% скорости) · Пылающая плита (Клюквенный шоколад)');
assert.equal(translate('Simmering Pot (Cocoa Spread), Simmering Pot (Malt Sugar)'), 'Томильный котёл (Какао-спред), Томильный котёл (Солодовый сахар)');
assert.equal(translate('134 Home Coins/sec'), '134 Монеты дома/с');
selector.value = 'en';
await change();
assert.equal(node.nodeValue, 'Your Homeland');
assert.equal(labelled.getAttribute('data-label'), 'Profit');
selector.value = 'ru';
await change();
assert.equal(node.nodeValue, 'Ваша Родина');
assert.equal(labelled.getAttribute('data-label'), 'Прибыль');
assert.equal(saved.get('aniimax-language'), 'ru');
