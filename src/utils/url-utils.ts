import I18nKey from "@i18n/i18nKey";
import { i18n, i18nFor } from "@i18n/translation";
import type { SiteLang } from "./locale-utils";
import { getLocalizedPath } from "./navigation-utils";

export function pathsEqual(path1: string, path2: string) {
	const normalizedPath1 = path1.replace(/^\/|\/$/g, "").toLowerCase();
	const normalizedPath2 = path2.replace(/^\/|\/$/g, "").toLowerCase();

	return normalizedPath1 === normalizedPath2;
}

function joinUrl(...parts: string[]): string {
	const joined = parts.join("/");

	return joined.replace(/\/+/g, "/");
}


export function getTagUrl(tag: string): string {
	if (!tag) {
		return url("/archive/");
	}

	return url(`/archive/?tag=${encodeURIComponent(tag.trim())}`);
}

export function getLocalizedTagUrl(
	lang: SiteLang,
	tag: string,
): string {
	if (!tag) {
		return getLocalizedPath(lang, "/archive/");
	}

	return getLocalizedPath(
		lang,
		`/archive/?tag=${encodeURIComponent(tag.trim())}`,
	);
}

export function getCategoryUrl(category: string | null): string {
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() ===
			i18n(I18nKey.uncategorized).toLowerCase()
	) {
		return url("/archive/?uncategorized=true");
	}

	return url(
		`/archive/?category=${encodeURIComponent(category.trim())}`,
	);
}

export function getLocalizedCategoryUrl(
	lang: SiteLang,
	category: string | null,
): string {
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() ===
			i18nFor(lang, I18nKey.uncategorized).toLowerCase()
	) {
		return getLocalizedPath(
			lang,
			"/archive/?uncategorized=true",
		);
	}

	return getLocalizedPath(
		lang,
		`/archive/?category=${encodeURIComponent(category.trim())}`,
	);
}

export function getDir(path: string): string {
	const lastSlashIndex = path.lastIndexOf("/");

	if (lastSlashIndex < 0) {
		return "/";
	}

	return path.substring(0, lastSlashIndex + 1);
}

export function url(path: string) {
	return joinUrl("", import.meta.env.BASE_URL, path);
}