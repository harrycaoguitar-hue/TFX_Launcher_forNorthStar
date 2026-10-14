const json = require("./modules/json");
const fs = require("fs"), path = require("path");
const localeRules = require("./locale");
const electronApp = require("electron").app;
// The main process reads the display language. Preload inherits the same
// first-run default even when Windows regional formatting uses another locale.
const inheritedDefault = process.argv?.find(value => value.startsWith("--tfx-default-language="))?.slice("--tfx-default-language=".length);
const defaultLocale = localeRules.systemDefault(electronApp ? localeRules.detectSystemLanguage(electronApp) : inheritedDefault || localeRules.detectSystemLanguage());

function flatten(object, prefix = "", result = {}) {
	for (let [key, value] of Object.entries(object)) {
		let path = prefix ? prefix + "." + key : key;
		if (value && typeof value == "object" && ! Array.isArray(value)) {
			flatten(value, path, result);
		} else {
			result[path] = value;
		}
	}

	return result;
}

const dictionaries = {
	"zh-CN": flatten(json(__dirname + "/lang/zh.json") || {}),
	"en-US": flatten(json(__dirname + "/lang/en.json") || {})
};
const normalize = value => localeRules.normalize(value, defaultLocale);
const config = json(require("path").join(process.cwd(), "fold.json")) || {};
let current = normalize(config.uiLanguage || config.lang || config.forcedlang);
const reverse = new Map();
for (const [key,value] of Object.entries(dictionaries["zh-CN"])) if (typeof value === "string") reverse.set(value,key);
for (const [key,value] of Object.entries(dictionaries["en-US"])) if (typeof value === "string") reverse.set(value,key);

function translate(key, locale = current) {
	const selected = normalize(locale);
	if (selected === "zh-CN" || selected === "en-US") return dictionaries[selected][key] || dictionaries["en-US"][key] || dictionaries["zh-CN"][key] || key;
	const english = dictionaries["en-US"][key] || dictionaries["zh-CN"][key] || key;
	return loadLocale(selected)[english] || english;
}
const localeCache = new Map();
function loadLocale(value) {
	const selected = normalize(value);
	if (!["zh-TW", "de-DE", "fr-FR"].includes(selected)) return {};
	if (!localeCache.has(selected)) {
		const file = path.join(__dirname, "lang", "ui-" + selected + ".json");
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		if (data.locale !== selected || !data.strings || typeof data.strings !== "object" || Array.isArray(data.strings)) throw Error("Invalid bundled language catalog: " + selected);
		localeCache.set(selected, data.strings);
	}
	return localeCache.get(selected);
}
translate.normalize = normalize;
translate.defaultLocale = defaultLocale;
translate.supported = localeRules.supported;
translate.loadLocale = loadLocale;
translate.setLocale = value => (current = normalize(value));
translate.getLocale = () => current;
translate.text = (value, locale = current) => reverse.has(value) ? translate(reverse.get(value),locale) : value;
module.exports = translate;
