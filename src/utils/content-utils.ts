import { type CollectionEntry, getCollection } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n, i18nFor } from "@i18n/translation";
import type { SiteLang } from "./locale-utils";
import {
	getCategoryUrl,
	getLocalizedCategoryUrl,
} from "@utils/url-utils.ts";

// // Retrieve posts and sort them by publication date
async function getRawSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const sorted = allBlogPosts.sort((a, b) => {
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts() {
	const sorted = await getRawSortedPosts();

	/*
	 * Clear any previously generated navigation values before
	 * rebuilding them.
	 */
	for (const post of sorted) {
		post.data.nextSlug = "";
		post.data.nextTitle = "";
		post.data.prevSlug = "";
		post.data.prevTitle = "";
	}

	/*
	 * Generate previous and next navigation independently
	 * for each site language.
	 */
	const postsByLanguage = new Map<
		string,
		typeof sorted
	>();

	for (const post of sorted) {
		const language = post.data.lang;

		if (!postsByLanguage.has(language)) {
			postsByLanguage.set(language, []);
		}

		postsByLanguage.get(language)?.push(post);
	}

	for (const localizedPosts of postsByLanguage.values()) {
		for (let i = 1; i < localizedPosts.length; i++) {
			localizedPosts[i].data.nextSlug =
				localizedPosts[i - 1].slug;

			localizedPosts[i].data.nextTitle =
				localizedPosts[i - 1].data.title;
		}

		for (let i = 0; i < localizedPosts.length - 1; i++) {
			localizedPosts[i].data.prevSlug =
				localizedPosts[i + 1].slug;

			localizedPosts[i].data.prevTitle =
				localizedPosts[i + 1].data.title;
		}
	}

	return sorted;
}
export type PostForList = {
	slug: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		slug: post.slug,
		data: post.data,
	}));

	return sortedPostsList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(
	siteLang?: SiteLang,
): Promise<Tag[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		const isPublished = import.meta.env.PROD
			? data.draft !== true
			: true;

		const isCorrectLanguage =
			!siteLang || data.lang === siteLang;

		return isPublished && isCorrectLanguage;
	});

	const countMap: Record<string, number> = {};

	allBlogPosts.forEach((post) => {
		post.data.tags.forEach((tag) => {
			const tagName = tag.trim();

			if (!tagName) {
				return;
			}

			countMap[tagName] = (countMap[tagName] ?? 0) + 1;
		});
	});

	const keys = Object.keys(countMap).sort((a, b) =>
		a.toLowerCase().localeCompare(b.toLowerCase()),
	);

	return keys.map((key) => ({
		name: key,
		count: countMap[key],
	}));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(
	siteLang?: SiteLang,
): Promise<Category[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		const isPublished = import.meta.env.PROD
			? data.draft !== true
			: true;

		const isCorrectLanguage =
			!siteLang || data.lang === siteLang;

		return isPublished && isCorrectLanguage;
	});

	const count: { [key: string]: number } = {};

	allBlogPosts.forEach((post) => {
		if (!post.data.category) {
			const uncategorizedName = siteLang
				? i18nFor(siteLang, I18nKey.uncategorized)
				: i18n(I18nKey.uncategorized);

			count[uncategorizedName] =
				(count[uncategorizedName] ?? 0) + 1;

			return;
		}

		const categoryName = String(post.data.category).trim();

		count[categoryName] =
			(count[categoryName] ?? 0) + 1;
	});

	const categories = Object.keys(count).sort((a, b) =>
		a.toLowerCase().localeCompare(b.toLowerCase()),
	);

	return categories.map((category) => ({
		name: category,
		count: count[category],
		url: siteLang
			? getLocalizedCategoryUrl(siteLang, category)
			: getCategoryUrl(category),
	}));
}