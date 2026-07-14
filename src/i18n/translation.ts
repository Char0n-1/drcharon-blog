import { siteConfig } from "../config";
import type I18nKey from "./i18nKey";
import { en } from "./languages/en";
import { es } from "./languages/es";
import { id } from "./languages/id";
import { ja } from "./languages/ja";
import { ko } from "./languages/ko";
import { th } from "./languages/th";
import { tr } from "./languages/tr";
import { vi } from "./languages/vi";
import { zh_CN } from "./languages/zh_CN";
import { zh_TW } from "./languages/zh_TW";

export type Translation = {
	[K in I18nKey]: string;
};

const defaultTranslation = en;

const map: Record<string, Translation> = {
	es,
	en,
	en_us: en,
	en_gb: en,
	en_au: en,

	// Public URL uses /zh/, while Fuwari's existing
	// Simplified Chinese translation uses zh_CN.
	zh: zh_CN,
	zh_cn: zh_CN,
	zh_tw: zh_TW,

	ja,
	ja_jp: ja,
	ko,
	ko_kr: ko,
	th,
	th_th: th,
	vi,
	vi_vn: vi,
	id,
	tr,
	tr_tr: tr,
};

export function getTranslation(lang: string): Translation {
	const normalizedLang = lang.trim().toLowerCase().replace("-", "_");

	return map[normalizedLang] || defaultTranslation;
}

/**
 * Original Fuwari-compatible translation function.
 *
 * Existing components can continue using this function until they are
 * migrated to URL-based language routing.
 */
export function i18n(key: I18nKey): string {
	const lang = siteConfig.lang || "en";

	return getTranslation(lang)[key];
}

/**
 * Translate a UI string using an explicitly provided page language.
 *
 * Use this for /en/ and /zh/ pages.
 */
export function i18nFor(lang: string, key: I18nKey): string {
	return getTranslation(lang)[key];
}