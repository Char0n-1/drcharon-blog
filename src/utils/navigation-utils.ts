import type { SiteLang } from "./locale-utils";

export function getLocalizedPath(
    lang: SiteLang,
    path: string,
): string {
    const normalized =
        path.startsWith("/") ? path : `/${path}`;

    if (normalized === "/") {
        return `/${lang}/`;
    }

    return `/${lang}${normalized}`;
}

export function stripLocaleFromPath(
    pathname: string,
): string {
    const stripped = pathname.replace(
        /^\/(?:en|zh)(?=\/|$)/,
        "",
    );

    return stripped === "" ? "/" : stripped;
}