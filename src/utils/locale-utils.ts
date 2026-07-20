export const SITE_LANGUAGES = ["en", "zh"] as const;

export type SiteLang = (typeof SITE_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SiteLang = "en";

export function isSiteLang(value: string | undefined): value is SiteLang {
	return (
		typeof value === "string" && SITE_LANGUAGES.includes(value as SiteLang)
	);
}

export function normalizeSiteLang(value: string | undefined): SiteLang {
	if (isSiteLang(value)) {
		return value;
	}

	return DEFAULT_LANGUAGE;
}

export function getAlternateLanguage(lang: SiteLang): SiteLang {
	return lang === "en" ? "zh" : "en";
}

export function getHtmlLang(lang: SiteLang): string {
	return lang === "zh" ? "zh-CN" : "en";
}
