// Languages are registered in locales/languages.js; English phrases are the source keys.
import { LANGUAGES, SOURCE_LANGUAGE, findLanguage } from './locales/languages.js';

const catalogs = { [SOURCE_LANGUAGE]: {} };
const templates = {};
// The translator of each 'cjk' language, built from its catalog on first use.
const cjkTranslators = {};
let language = SOURCE_LANGUAGE;
let preferredLanguage = SOURCE_LANGUAGE;
try { preferredLanguage = localStorage.getItem('aniimax-language') || SOURCE_LANGUAGE; } catch (_) { /* Private browsing can disable storage. */ }
if (!findLanguage(preferredLanguage)) preferredLanguage = SOURCE_LANGUAGE;

async function load(code) {
    if (!catalogs[code]) {
        const response = await fetch(new URL(`./locales/${code}.json`, import.meta.url));
        if (!response.ok) throw new Error(`Could not load ${code} translations`);
        catalogs[code] = await response.json();
        templates[code] = Object.entries(catalogs[code])
            .filter(([source, target]) => /\{[a-z_]+\}/i.test(source) && /\{[a-z_]+\}/i.test(target))
            .sort(([left], [right]) => right.length - left.length)
            .map(([source, target]) => {
                const slots = [...source.matchAll(/\{[a-z_]+\}/gi)].map(match => match[0]);
                const parts = source.split(/\{[a-z_]+\}/gi);
                const pattern = parts.map((part, i) => escapeRegExp(part) + (i < slots.length
                    ? (/^\{(?:days|hours|minutes|seconds|n|level|trips|distance|plots)\}$/.test(slots[i])
                        ? '([0-9][0-9.,\\s]*)' : '(.+?)')
                    : '')).join('');
                const textSlots = slots.map(slot => !/^\{(?:days|hours|minutes|seconds|n|level|trips|distance|plots)\}$/.test(slot));
                return { pattern: new RegExp(`^${pattern}$`), slots, textSlots, target };
            });
    }
}

const textSources = new WeakMap();
const attributeSources = new WeakMap();
const attributes = ['title', 'aria-label', 'aria-description', 'placeholder', 'data-label', 'data-tooltip', 'data-tip', 'data-tip-detail', 'data-tip-stats', 'data-tip-text'];

export function translate(value) {
    if (language === SOURCE_LANGUAGE || !value) return value;
    const { rules, joiners } = findLanguage(language);
    if (rules === 'cjk') return (cjkTranslators[language] ??= createCjkTranslator(catalogs[language], joiners))(value);
    const trimmed = value.trim();
    const translated = translateText(trimmed);
    return translated === trimmed ? value : value.replace(trimmed, () => translated);
}

// Labels the page glues together, outermost first: "3× Heat Furnace (Scorching)", "Woodland:
// Cocoa ×2", "Heat Furnace 1", "0.27 Home Coins". Each part is translated on its own.
const GLUED = [
    [/^(\d+)× (.+)$/, (t, n, rest) => `${n}× ${t(rest)}`],
    [/^(.+) ×(\d+)$/, (t, rest, n) => `${t(rest)} ×${n}`],
    [/^(.+) \(([^()]+)\)$/, (t, rest, detail) => balancedBrackets(rest) ? `${t(rest)} (${t(detail)})` : null],
    [/^([0-9][0-9.,]*) (.+)$/, (t, n, rest) => `${n} ${t(rest)}`],
    [/^(.+) (\d+)$/, (t, rest, n) => `${t(rest)} ${n}`],
    [/^: (.+)$/, (t, rest) => `: ${t(rest)}`],
];

// Translates trimmed text: the catalog entry, else the first template that matches, else its parts
// between separators, else the parts of a glued label. Text with nothing in the catalog stays.
function translateText(trimmed) {
    const translated = catalogs[language][trimmed];
    if (translated) return translated;
    // Dynamic labels keep their values while the source sentence remains translatable.
    for (const { pattern, slots, textSlots, target } of templates[language] || []) {
        const match = trimmed.match(pattern);
        // A text slot holding half a bracket pair, as in "A (x), B (y)" read as "{name} ({detail})",
        // is the wrong reading.
        if (!match || !textSlots.every((text, i) => !text || balancedBrackets(match[i + 1]))) continue;
        let result = target;
        slots.forEach((slot, i) => {
            const captured = match[i + 1];
            const whole = captured === trimmed ? captured : translateText(captured);
            const value = whole === captured ? captured.split(', ').map(part => part === trimmed ? part : translateText(part)).join(', ') : whole;
            result = result.replace(slot, () => value);
        });
        // A broad template that changes nothing, as "{ability}: {description}" does for "Plant
        // cost: 1", leaves the text to a narrower one.
        if (result !== trimmed) return result;
    }
    for (const separator of ['\n', ' · ', '; ', '. ', ', ']) {
        if (!trimmed.includes(separator)) continue;
        // A sentence keeps its full stop, so the catalog entry for it still matches.
        const parts = trimmed.split(separator).map((part, i, all) => separator === '. ' && i < all.length - 1 ? `${part}.` : part);
        const localized = parts.map(translateText);
        if (localized.some((part, i) => part !== parts[i])) return localized.join(separator === '. ' ? ' ' : separator);
    }
    for (const [pattern, glue] of GLUED) {
        const match = trimmed.match(pattern);
        const result = match && glue(translateText, ...match.slice(1));
        if (result && result !== trimmed) return result;
    }
    return trimmed;
}

// Rules for languages written without spaces between words ('cjk' in locales/languages.js; first
// written for Traditional Chinese, zh-TW). translate() uses them only for those languages, so the
// others keep the rules above. They differ from those rules:
// - Lists, clauses and sentences join with the language's `joiners` (zh-TW: '、', '；', nothing).
// - A template with more fixed text is tried first.
// - A text slot holds no slot break either, so "{name} ({detail})" stays within one line.
// - Glued labels are read with catalog templates such as "{n}× {item}", not with GLUED.
// Text that the catalog does not hold, for example new English text, stays in English.
const CJK_SLOT = /\{[a-z_]+\}/gi;
const CJK_NUMBER_SLOT = /^\{(?:days|hours|minutes|seconds|n|level|trips|distance|plots)\}$/;
const CJK_SEPARATORS = ['\n', ' · ', '; ', '. ', ', '];
// A text slot never holds one of these, unless the fixed text of its template holds it.
const CJK_SLOT_BREAKS = ['\n', ' · ', '; '];

/**
 * Gives a function that translates English text with a 'cjk' language's `catalog`. Each separator
 * named in `joiners` is replaced by its joiner; the others ('\n', ' · ') stay.
 */
export function createCjkTranslator(catalog, joiners = {}) {
    const cjkTemplates = cjkBuildTemplates(catalog);

    function translateText(value) {
        if (!value) return value;
        const trimmed = value.trim();
        const translated = Object.hasOwn(catalog, trimmed) ? catalog[trimmed] : '';
        const result = translated || fillTemplate(trimmed) || translateParts(trimmed);
        return result ? value.replace(trimmed, () => result) : value;
    }

    // Fills the first template that matches. Returns null when none matches.
    function fillTemplate(trimmed) {
        for (const template of cjkTemplates) {
            const match = trimmed.match(template.pattern);
            if (!match) continue;
            if (!template.textSlots.every((text, i) => !text || cjkFits(match[i + 1], template.breaks))) continue;
            let result = template.target;
            template.slots.forEach((slot, i) => {
                const captured = match[i + 1];
                const whole = captured === trimmed ? captured : translateText(captured);
                const value = whole === captured ? captured.split(', ').map(part => part === trimmed ? part : translateText(part)).join(', ') : whole;
                result = result.replace(slot, () => value);
            });
            return result;
        }
        return null;
    }

    // Translates each part between the first separator that changes a part. Returns null when none does.
    function translateParts(text) {
        for (const separator of CJK_SEPARATORS) {
            if (!text.includes(separator)) continue;
            const parts = text.split(separator);
            // A sentence keeps its full stop, so the catalog entry for it still matches.
            const sources = separator === '. ' ? parts.map((part, i) => part + (i < parts.length - 1 ? '.' : '')) : parts;
            const localized = sources.map(part => translateText(part));
            if (localized.every((part, i) => part === sources[i])) continue;
            return localized.join(joiners[separator] ?? separator);
        }
        return null;
    }

    return translateText;
}

function cjkBuildTemplates(catalog) {
    return Object.entries(catalog)
        .filter(([source, target]) => /\{[a-z_]+\}/i.test(source) && /\{[a-z_]+\}/i.test(target))
        // A template with more fixed text is more specific, so it comes first.
        .sort(([left], [right]) => cjkLiteralLength(right) - cjkLiteralLength(left) || right.length - left.length)
        .map(([source, target]) => {
            const slots = [...source.matchAll(CJK_SLOT)].map(match => match[0]);
            const parts = source.split(CJK_SLOT);
            const pattern = parts.map((part, i) => escapeRegExp(part) + (i < slots.length
                ? (CJK_NUMBER_SLOT.test(slots[i]) ? '([0-9][0-9.,\\s]*)' : '(.+?)')
                : '')).join('');
            const textSlots = slots.map(slot => !CJK_NUMBER_SLOT.test(slot));
            // A separator in the fixed text, as in "{ability} Lv.{level} · {detail}", lets its slot hold one.
            const breaks = CJK_SLOT_BREAKS.filter(separator => !source.includes(separator));
            return { pattern: new RegExp(`^${pattern}$`), slots, textSlots, breaks, target };
        });
}

// A text slot holds whole brackets and no slot break.
function cjkFits(text, breaks) {
    return balancedBrackets(text) && !breaks.some(separator => text.includes(separator));
}

// Tells if every bracket in `text` is closed, and closed after it opens.
function balancedBrackets(text) {
    let depth = 0;
    for (const char of text) {
        if (char === '(') depth += 1;
        else if (char === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

function cjkLiteralLength(source) {
    return source.replace(CJK_SLOT, '').length;
}

/** The locale for formatting numbers in the current language. */
export function currentLocale() {
    const { code, numbers } = findLanguage(language);
    return numbers ?? code;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateText(node) {
    const previous = textSources.get(node);
    if (previous?.shown === node.nodeValue) {
        if (language === previous.language) return;
    }
    const source = previous?.shown === node.nodeValue ? previous.source : node.nodeValue;
    const shown = translate(source);
    textSources.set(node, { source, shown, language });
    if (shown !== node.nodeValue) node.nodeValue = shown;
}

function updateAttributes(element) {
    let sources = attributeSources.get(element);
    if (!sources) { sources = new Map(); attributeSources.set(element, sources); }
    for (const name of attributes) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name);
        const previous = sources.get(name);
        if (previous?.shown === current && previous.language === language) continue;
        const source = previous?.shown === current ? previous.source : current;
        const shown = translate(source);
        sources.set(name, { source, shown, language });
        if (shown !== current) element.setAttribute(name, shown);
    }
}

export function sourceAttribute(element, name) {
    const current = element.getAttribute(name);
    const previous = attributeSources.get(element)?.get(name);
    return previous?.shown === current ? previous.source : current;
}

// Translates `root` and everything in it now, without waiting for the MutationObserver.
export function translateTree(root) {
    update(root);
}

function update(root) {
    if (root.nodeType === Node.TEXT_NODE) return updateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    updateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode.nodeType === Node.TEXT_NODE) updateText(walker.currentNode);
        else updateAttributes(walker.currentNode);
    }
}

const selector = document.getElementById('language-switch');
for (const { code, name } of LANGUAGES) selector.add(new Option(name, code));
selector.value = preferredLanguage;
document.documentElement.lang = language;
document.title = translate('Aniimax - Aniimo Production Optimizer');
update(document.body);
let languageRequest = 0;
async function selectLanguage(code) {
    const request = ++languageRequest;
    try { await load(code); } catch (error) {
        console.warn(error);
        if (request === languageRequest) selector.value = language;
        return;
    }
    if (request !== languageRequest) return;
    language = code;
    try { localStorage.setItem('aniimax-language', language); } catch (_) { /* Language still changes for this tab. */ }
    document.documentElement.lang = language;
    document.title = translate('Aniimax - Aniimo Production Optimizer');
    update(document.body);
    document.dispatchEvent(new Event('aniimax-language-change'));
}
selector.addEventListener('change', () => selectLanguage(selector.value));

new MutationObserver(records => {
    for (const record of records) {
        if (record.type === 'characterData') updateText(record.target);
        else if (record.type === 'attributes') updateAttributes(record.target);
        else record.addedNodes.forEach(update);
    }
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });

export const languageReady = selectLanguage(preferredLanguage);
