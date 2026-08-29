"use strict";

(() => {
  const BASE_URL = "https://taiyo.moe";
  const SEARCH_URL = "https://meilisearch.taiyo.moe/multi-search";
  const CDN_URL = "https://cdn.taiyo.moe/medias";
  const PAGE_SIZE = 21;
  let bearerToken = "";

  function decodeEntities(value) {
    const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
      .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] || match);
  }

  function stripHTML(value) {
    return decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  function absoluteURL(value, base = BASE_URL) {
    const input = decodeEntities(String(value || "").trim());
    if (!input) return "";
    if (/^https?:\/\//i.test(input)) return input;
    if (input.startsWith("//")) return `https:${input}`;
    if (input.startsWith("/")) return `${BASE_URL}${input}`;
    return `${String(base || BASE_URL).replace(/\/$/, "")}/${input.replace(/^\//, "")}`;
  }

  async function responseText(response) {
    if (!response) return "";
    if (typeof response.text === "function") {
      const value = await response.text();
      if (typeof value === "string") return value;
    }
    if (typeof response.body === "string") return response.body;
    return "";
  }

  async function requestText(url, method = "GET", body = null, extraHeaders = {}, responseClass = "html") {
    if (typeof globalThis.fetchv2 !== "function") {
      throw new Error("Taiyō requer a ponte fetchv2 da Synthetiq.");
    }
    const headers = {
      Accept: responseClass === "json" ? "application/json" : "text/html,application/xhtml+xml,*/*",
      Referer: `${BASE_URL}/`,
      ...extraHeaders,
    };
    const response = await globalThis.fetchv2(
      url,
      headers,
      method,
      body,
      {
        followRedirects: true,
        maxBytesHint: 12 * 1024 * 1024,
        responseClass,
      },
    );
    const status = Number(response && response.status);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
      const error = new Error(`Taiyō respondeu com HTTP ${status || "erro"}.`);
      error.status = status || 0;
      throw error;
    }
    const text = await responseText(response);
    if (!text) throw new Error("Taiyō devolveu uma resposta vazia.");
    return text;
  }

  async function requestJSON(url, method = "GET", body = null, extraHeaders = {}) {
    const text = await requestText(url, method, body, extraHeaders, "json");
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("Taiyō devolveu JSON inválido.");
    }
  }

  function scriptURLsFromHTML(html) {
    const scripts = [];
    const pattern = /<script\b([^>]*)\bsrc=(["'])([^"']+)\2([^>]*)>/gi;
    let match;
    while ((match = pattern.exec(String(html || ""))) !== null) {
      const tag = `${match[1]} ${match[4]}`;
      const src = String(match[3] || "");
      if (!src || /\bnomodule\b/i.test(tag) || /(?:^|\/)app(?:[.-]|\/)/i.test(src)) continue;
      if (!/next|_next/i.test(src)) continue;
      scripts.push(absoluteURL(src));
    }
    return scripts;
  }

  async function fetchBearerToken(force = false) {
    if (bearerToken && !force) return bearerToken;
    const html = await requestText(`${BASE_URL}/`);
    const scripts = scriptURLsFromHTML(html).reverse();
    const tokenPatterns = [
      /NEXT_PUBLIC_MEILISEARCH_PUBLIC_KEY\s*:\s*["']([^"']+)["']/i,
      /NEXT_PUBLIC_MEILISEARCH_PUBLIC_KEY["']?\s*[,=:]\s*["']([^"']+)["']/i,
    ];
    for (const scriptURL of scripts) {
      try {
        const script = await requestText(scriptURL, "GET", null, { Accept: "*/*" }, "html");
        for (const pattern of tokenPatterns) {
          const match = script.match(pattern);
          if (match && match[1]) {
            bearerToken = match[1];
            return bearerToken;
          }
        }
      } catch (_) {
        // Continue through the remaining Next.js chunks.
      }
    }
    throw new Error("Não foi possível obter o token público de pesquisa do Taiyō.");
  }

  async function meiliSearch(query, page = 1, retry = true) {
    const token = await fetchBearerToken(false);
    const currentPage = Math.max(1, Number(page) || 1);
    const payload = {
      queries: [
        {
          indexUid: "medias",
          q: String(query || "").slice(0, 200),
          filter: ["deletedAt IS NULL"],
          limit: PAGE_SIZE,
          offset: PAGE_SIZE * (currentPage - 1),
        },
      ],
    };
    try {
      return await requestJSON(
        SEARCH_URL,
        "POST",
        JSON.stringify(payload),
        {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: BASE_URL,
        },
      );
    } catch (error) {
      const status = Number(error && error.status);
      if (retry && (status === 401 || status === 403)) {
        await fetchBearerToken(true);
        return meiliSearch(query, page, false);
      }
      throw error;
    }
  }

  function preferredTitle(item) {
    const titles = Array.isArray(item && item.titles) ? item.titles : [];
    const ranked = titles.slice().sort((a, b) => Number(b && b.priority || 0) - Number(a && a.priority || 0));
    const preferred = titles.find((entry) => /^pt(?:-|_|$)/i.test(String(entry && entry.language || "")))
      || titles.find((entry) => /^en(?:-|_|$)/i.test(String(entry && entry.language || "")))
      || ranked[0];
    return String(preferred && preferred.title || "Sem título").trim();
  }

  function coverURL(item) {
    const id = String(item && item.id || "").trim();
    const cover = String(item && (item.mainCoverId || item.coverId) || "").trim();
    return id && cover ? `${CDN_URL}/${id}/covers/${cover}.jpg` : "";
  }

  function mediaItem(item) {
    const id = String(item && item.id || "").trim();
    const href = `${BASE_URL}/media/${id}`;
    return {
      id,
      href,
      url: href,
      title: preferredTitle(item),
      image: coverURL(item),
    };
  }

  async function searchResults(query, page = 1) {
    const text = String(query || "").trim();
    const searchText = text.startsWith("__feed:") ? "" : text;
    const payload = await meiliSearch(searchText, page);
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const first = results[0] || {};
    const hits = Array.isArray(first.hits) ? first.hits : [];
    return {
      items: hits.map(mediaItem).filter((item) => item.id),
      hasMore: hits.length >= PAGE_SIZE,
    };
  }

  function mediaID(value) {
    const text = String(value || "");
    const match = text.match(/\/media\/([0-9a-f-]{20,})/i) || text.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
    if (!match) throw new Error("Identificador Taiyō inválido.");
    return match[1];
  }

  function chapterID(value) {
    const text = String(value || "");
    const match = text.match(/\/chapter\/([0-9a-f-]{20,})/i) || text.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
    if (!match) throw new Error("Identificador de capítulo Taiyō inválido.");
    return match[1];
  }

  function metaContent(html, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta\\b[^>]*(?:property|name)=(["'])${escaped}\\1[^>]*content=(["'])([^"']*)\\2`, "i"),
      new RegExp(`<meta\\b[^>]*content=(["'])([^"']*)\\1[^>]*(?:property|name)=(["'])${escaped}\\3`, "i"),
    ];
    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match) return decodeEntities(match[3] || match[2] || "");
    }
    return "";
  }

  function balancedObject(text, start) {
    if (start < 0 || text[start] !== "{") return "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return "";
  }

  function extractEmbeddedObject(html, key) {
    const original = decodeEntities(String(html || ""));
    const variants = [original, original.replace(/\\/g, "")];
    for (const variant of variants) {
      const markers = [`"${key}":`, `'${key}':`];
      for (const marker of markers) {
        let offset = 0;
        while (offset < variant.length) {
          const index = variant.indexOf(marker, offset);
          if (index < 0) break;
          const start = variant.indexOf("{", index + marker.length);
          const raw = balancedObject(variant, start);
          if (raw) {
            try {
              return JSON.parse(raw);
            } catch (_) {
              // There can be several serialized payloads; try the next one.
            }
          }
          offset = index + marker.length;
        }
      }
    }
    return null;
  }

  function genreNames(value) {
    const map = {
      ACTION: "Ação", ADVENTURE: "Aventura", COMEDY: "Comédia", DRAMA: "Drama",
      ECCHI: "Ecchi", FANTASY: "Fantasia", HENTAI: "Hentai", HORROR: "Horror",
      MAHOU_SHOUJO: "Mahou Shoujo", MECHA: "Mecha", MUSIC: "Música", MYSTERY: "Mistério",
      PSYCHOLOGICAL: "Psicológico", ROMANCE: "Romance", SCI_FI: "Sci-fi",
      SLICE_OF_LIFE: "Slice of Life", SPORTS: "Esportes", SUPERNATURAL: "Sobrenatural", THRILLER: "Thriller",
    };
    return (Array.isArray(value) ? value : []).map((genre) => map[String(genre)] || String(genre)).filter(Boolean);
  }

  async function extractDetails(value) {
    const id = mediaID(value);
    const href = `${BASE_URL}/media/${id}`;
    const html = await requestText(href);
    const embedded = extractEmbeddedObject(html, "media") || {};
    const title = preferredTitle(embedded) || stripHTML((html.match(/<p\b[^>]*class=(["'])[^"']*media-title[^"']*\1[^>]*>([\s\S]*?)<\/p>/i) || [])[2] || "") || metaContent(html, "og:title") || "Sem título";
    const description = String(embedded.synopsis || metaContent(html, "description") || metaContent(html, "og:description") || "").trim();
    const image = coverURL(embedded) || metaContent(html, "og:image");
    const statusMap = { FINISHED: "Completo", RELEASING: "Em publicação" };
    return {
      id,
      href,
      url: href,
      title,
      description,
      image,
      authors: [],
      author: "",
      artists: [],
      artist: "",
      genres: genreNames(embedded.genres),
      status: statusMap[String(embedded.status || "").toUpperCase()] || "Desconhecido",
    };
  }

  function findChapterPayload(value, depth = 0) {
    if (depth > 12 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findChapterPayload(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "object") {
      if (Array.isArray(value.chapters) && value.totalPages !== undefined) return value;
      for (const child of Object.values(value)) {
        const found = findChapterPayload(child, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === "string" && value.includes("chapters") && value.length < 2000000) {
      try {
        return findChapterPayload(JSON.parse(value), depth + 1);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async function chapterPage(mediaId, page) {
    const input = encodeURIComponent(JSON.stringify({
      0: { json: { mediaId, page, perPage: 50 } },
    }));
    const url = `${BASE_URL}/api/trpc/chapters.getByMediaId?batch=1&input=${input}`;
    const payload = await requestJSON(url);
    const result = findChapterPayload(payload);
    if (!result) throw new Error("Taiyō não devolveu uma lista de capítulos válida.");
    return result;
  }

  async function extractChapters(value) {
    const id = mediaID(value);
    const chapters = [];
    const seen = new Set();
    let page = 1;
    let totalPages = 1;
    do {
      const result = await chapterPage(id, page);
      totalPages = Math.max(1, Number(result.totalPages) || 1);
      for (const item of Array.isArray(result.chapters) ? result.chapters : []) {
        const chapterId = String(item && item.id || "").trim();
        if (!chapterId || seen.has(chapterId)) continue;
        seen.add(chapterId);
        const number = Number(item.number);
        const numberText = Number.isFinite(number) ? String(number).replace(/\.0$/, "") : "";
        const extraTitle = String(item.title || "").trim();
        let title = numberText ? `Capítulo ${numberText}` : "Capítulo";
        if (extraTitle && extraTitle !== numberText && !/^cap[ií]tulo/i.test(extraTitle)) title += ` - ${extraTitle}`;
        const href = `${BASE_URL}/chapter/${chapterId}/1`;
        chapters.push({
          id: chapterId,
          href,
          url: href,
          title,
          number: Number.isFinite(number) ? number : null,
          releaseDate: item.createdAt || null,
          language: "pt-BR",
          scanlator: (Array.isArray(item.scans) ? item.scans : []).map((scan) => scan && scan.name).filter(Boolean).join(", "),
        });
      }
      page += 1;
    } while (page <= totalPages && page <= 100);
    if (!chapters.length) throw new Error("Taiyō não devolveu capítulos para este manga.");
    return chapters.sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  }

  function directChapterImages(html) {
    const urls = [];
    const seen = new Set();
    const pattern = /https:\/\/cdn\.taiyo\.moe\/medias\/[^"'\\s<>]+?\.jpg/gi;
    for (const match of String(html || "").matchAll(pattern)) {
      const url = decodeEntities(match[0]).replace(/\\/g, "");
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    return urls;
  }

  function serializedChapterImages(html) {
    const normalized = String(html || "").replace(/\\\"/g, "\"").replace(/\\"/g, "\"");
    const markerIndex = normalized.indexOf("\"mediaChapter\":");
    if (markerIndex < 0) return [];
    const chunk = normalized.slice(markerIndex);
    const chapterMatch = chunk.match(/\"mediaChapter\"\s*:\s*\{\s*\"id\"\s*:\s*\"([^\"]+)\"/i);
    const mediaMatch = chunk.match(/\"media\"\s*:\s*\{\s*\"id\"\s*:\s*\"([^\"]+)\"/i);
    const pagesMatch = chunk.match(/\"pages\"\s*:\s*\[([\s\S]*?)\]\s*,\s*\"previousChapter\"/i) || chunk.match(/\"pages\"\s*:\s*\[([\s\S]*?)\]/i);
    if (!chapterMatch || !mediaMatch || !pagesMatch) return [];
    const pageIDs = Array.from(pagesMatch[1].matchAll(/\"id\"\s*:\s*\"([^\"]+)\"/gi)).map((match) => match[1]);
    if (!pageIDs.length) return [];
    return pageIDs.map((pageID) => `${CDN_URL}/${mediaMatch[1]}/chapters/${chapterMatch[1]}/${pageID}.jpg`);
  }

  async function extractImages(value) {
    const id = chapterID(value);
    const href = `${BASE_URL}/chapter/${id}/1`;
    const html = await requestText(href);
    const embedded = extractEmbeddedObject(html, "mediaChapter");
    let urls = [];
    if (embedded && embedded.id && embedded.media && embedded.media.id && Array.isArray(embedded.pages)) {
      urls = embedded.pages
        .map((page) => page && page.id)
        .filter(Boolean)
        .map((pageId) => `${CDN_URL}/${embedded.media.id}/chapters/${embedded.id}/${pageId}.jpg`);
    }
    if (!urls.length) urls = serializedChapterImages(html);
    if (!urls.length) urls = directChapterImages(html);
    if (!urls.length) throw new Error("Taiyō não devolveu as páginas deste capítulo.");
    return urls.map((url) => ({
      url,
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*",
        Referer: href,
      },
    }));
  }

  async function discoveryHome() {
    const popular = await searchResults("__feed:popular", 1);
    return {
      sections: [
        { id: "popular", title: "Populares", items: popular.items },
      ],
    };
  }

  async function discoveryFeed(_feedID, page = 1) {
    return searchResults("__feed:popular", page);
  }

  const handlers = {
    searchResults,
    extractDetails,
    extractChapters,
    extractImages,
    discoveryHome,
    discoveryFeed,
  };

  globalThis.SynthetiqModule = handlers;
  Object.assign(globalThis, handlers);
})();
