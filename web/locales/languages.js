// The languages the web app offers, in selector order. This list is the only place a language is
// named: i18n.js builds the selector, number format and translation rules from it, the math window
// retypesets every language but the source one, and the tests check each catalog it lists.
//
// To add a language, add an entry here and its catalog `web/locales/<code>.json`, which maps each
// English phrase (en.json inventories them) to its translation. English stays the source: it has
// no catalog of its own, and identifiers sent to the solver never change.
//
// Entry fields:
// - code: the BCP 47 tag. It names the catalog file and is set as <html lang>.
// - name: the selector label, written in the language itself.
// - numbers: the locale for toLocaleString when it differs from `code` (es → es-ES).
// - complete: the catalog holds every en.json phrase, which tests/locale.test.mjs checks. Without
//   it, a phrase missing from the catalog shows in English.
// - rules: 'spaced' (the default) for languages that put spaces between words. 'cjk' for
//   languages written without them: lists, clauses and sentences join with `joiners`, and glued
//   labels are read only through catalog templates such as "{n}× {item}" (see i18n.js).
// - joiners: for 'cjk', the text that replaces each English separator ('. ', '; ', ', ').

/** The language English UI text is written in. Translating to it changes nothing. */
export const SOURCE_LANGUAGE = 'en';

/** Every web language, in selector order. */
export const LANGUAGES = [
    { code: 'en', name: 'English', numbers: 'en-US' },
    { code: 'es', name: 'Español', numbers: 'es-ES', complete: true },
    { code: 'ru', name: 'Русский', numbers: 'ru-RU', complete: true },
    { code: 'zh-TW', name: '繁體中文', rules: 'cjk', joiners: { '. ': '', '; ': '；', ', ': '、' } },
];

/** The entry for `code`, or undefined when no language has it. */
export function findLanguage(code) {
    return LANGUAGES.find(language => language.code === code);
}
