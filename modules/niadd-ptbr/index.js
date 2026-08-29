"use strict";

(() => {
  const BASE_URL = "https://br.niadd.com";
  const HEADERS = {
    Accept: "text/html,application/xhtml+xml",
    Referer: `${BASE_URL}/`,
  };
  const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      if (typeof globalThis.setTimeout === "function") globalThis.setTimeout(resolve, milliseconds);
      else Promise.resolve().then(resolve);
    });
  }

  function decodeEntities(value) {
    const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
      .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] || match);
  }

  function stripHTML(value) {
    return decodeEntities(
      String(value || "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function attribute(tag, name) {
    const match = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
    return match ? decodeEntities(match[2].trim()) : "";
  }

  function absoluteURL(value, base = BASE_URL) {
    const input = decodeEntities(String(value || "").trim());
    if (!input) return "";
    if (/^https:\/\//i.test(input)) return input;
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

  async function fetchHTML(url, referer = `${BASE_URL}/`) {
    if (typeof globalThis.fetchv2 !== "function") {
      throw new Error("Niadd requer a ponte fetchv2 da Synthetiq.");
    }
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await sleep(800 * attempt);
      let response = null;
      try {
        response = await globalThis.fetchv2(
          url,
          { ...HEADERS, Referer: referer },
          "GET",
          null,
          {
            followRedirects: true,
            maxBytesHint: 8 * 1024 * 1024,
            responseClass: "html",
          },
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      const status = Number(response && response.status);
      if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
        lastError = new Error(`Niadd respondeu com HTTP ${status || "erro"}.`);
        if (status && !RETRYABLE_STATUS.has(status)) break;
        continue;
      }
      const body = await responseText(response);
      if (body) return body;
      lastError = new Error("Niadd devolveu uma resposta vazia.");
    }
    throw lastError || new Error("Falha no pedido ao Niadd.");
  }

  function normalizedSeriesURL(value) {
    const input = String(value || "").trim();
    if (/^https:\/\/br\.niadd\.com\/manga\//i.test(input)) return input.replace(/\/$/, "/");
    if (input.startsWith("/manga/")) return `${BASE_URL}${input}`;
    const match = input.match(/\/manga\/([^?#]+)/i);
    if (match) return `${BASE_URL}/manga/${match[1]}`;
    throw new Error("Identificador Niadd inválido.");
  }

  function normalizedChapterURL(value) {
    const input = String(value || "").trim();
    if (/^https:\/\/br\.niadd\.com\/chapter\//i.test(input)) return input;
    if (input.startsWith("/chapter/")) return `${BASE_URL}${input}`;
    const match = input.match(/\/chapter\/([^?#]+)/i);
    if (match) return `${BASE_URL}/chapter/${match[1]}`;
    throw new Error("Identificador de capítulo Niadd inválido.");
  }

  function parseListHTML(html) {
    const items = [];
    const seen = new Set();
    const names = Array.from(String(html || "").matchAll(/<div\b[^>]*class=(["'])[^"']*\bmanga-name\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi));
    for (const entry of names) {
      const title = stripHTML(entry[2]);
      if (!title) continue;
      const start = Math.max(0, entry.index - 1800);
      const window = html.slice(start, entry.index + entry[0].length + 200);
      const links = Array.from(window.matchAll(/<a\b[^>]*href=(["'])([^"']+\/manga\/[^"']+)\1[^>]*>/gi));
      if (!links.length) continue;
      const href = absoluteURL(links[links.length - 1][2]);
      if (seen.has(href)) continue;
      const imgs = Array.from(window.matchAll(/<img\b[^>]*(?:src|data-src)=(["'])([^"']+)\1[^>]*>/gi));
      const image = imgs.length ? absoluteURL(imgs[imgs.length - 1][2]) : "";
      seen.add(href);
      items.push({ id: href, href, url: href, title, image });
    }
    return { items, hasMore: false };
  }

  async function searchResults(query, page = 1) {
    const text = String(query || "").trim();
    let url;
    if (text === "__feed:popular") url = `${BASE_URL}/list/Hot-Manga.html`;
    else if (text === "__feed:latest") url = `${BASE_URL}/list/New-Update.html`;
    else url = `${BASE_URL}/search/?name=${encodeURIComponent(text.slice(0, 200))}`;
    const html = await fetchHTML(url);
    return parseListHTML(html);
  }

  function parseDetailsHTML(html, href) {
    const title = stripHTML((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "")
      || stripHTML((html.match(/book-headline-name[^>]*>([\s\S]*?)<\/[^>]+>/i) || [])[1] || "");
    if (!title) throw new Error("Niadd não devolveu o título do manga.");

    let image = "";
    const detailImg = html.match(/<div\b[^>]*class=(["'])[^"']*(?:detail-img|bookside-img)[^"']*\1[^>]*>[\s\S]*?<img\b[^>]*(?:src|data-src)=(["'])([^"']+)\2/i);
    if (detailImg) image = absoluteURL(detailImg[3]);

    const author = stripHTML((html.match(/(?:Autor\s*\(es\)|Autor)[\s\S]{0,300}?<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "")
      .replace(/^Autor\s*\(es\)\s*:\s*/i, "");
    const artist = stripHTML((html.match(/Artista[\s\S]{0,300}?<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "")
      .replace(/^Artista\s*:\s*/i, "");
    const genres = Array.from(html.matchAll(/itemprop=(["'])genre\1[^>]*>([\s\S]*?)<\/a>/gi))
      .map((entry) => stripHTML(entry[2]))
      .filter(Boolean);

    let description = "";
    const synopsis = html.match(/(?:Sinopse|Synopsis)[\s\S]{0,500}?<div\b[^>]*class=(["'])[^"']*detail-section[^"']*\1[^>]*>([\s\S]*?)<\/div>/i);
    if (synopsis) description = stripHTML(synopsis[2]);
    const year = stripHTML((html.match(/(?:Liberado|Released|Lançado)\s*:[\s\S]{0,200}?<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "");
    if (year) description = `Ano: ${year}${description ? `\n\n${description}` : ""}`;

    return {
      id: href,
      href,
      url: href,
      title,
      description,
      image,
      authors: author ? [author] : [],
      author,
      artists: artist ? [artist] : [],
      artist,
      genres,
      status: /completo|completed|finished/i.test(html) ? "Completo" : "Em publicação",
    };
  }

  async function extractDetails(value) {
    const href = normalizedSeriesURL(value);
    return parseDetailsHTML(await fetchHTML(href), href);
  }

  function chapterNumber(name) {
    const match = String(name || "").match(/(?:Cap[ií]tulo|Ch(?:apter)?\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);
    return match ? Number(match[1]) : null;
  }

  async function extractChapters(value) {
    const series = normalizedSeriesURL(value);
    const chaptersURL = `${series.replace(/\/$/, "").replace(/\.html$/i, "")}/chapters.html`;
    const html = await fetchHTML(chaptersURL, series);
    const chapters = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*class=(["'])[^"']*\bhover-underline\b[^"']*\1[^>]*href=(["'])([^"']+)\2[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = absoluteURL(match[3]);
      if (!/\/chapter\//i.test(href) || seen.has(href)) continue;
      const inner = match[4];
      const named = (inner.match(/<span\b[^>]*class=(["'])[^"']*(?:chapter-name|\bname\b)[^"']*\1[^>]*>([\s\S]*?)<\/span>/i) || [])[2];
      const title = stripHTML(named || inner);
      if (!title) continue;
      const time = stripHTML((inner.match(/<span\b[^>]*class=(["'])[^"']*(?:chapter-time|\btime\b)[^"']*\1[^>]*>([\s\S]*?)<\/span>/i) || [])[2] || "");
      chapters.push({
        id: href,
        href,
        url: href,
        title,
        number: chapterNumber(title),
        releaseDate: time || null,
        language: "pt-BR",
      });
      seen.add(href);
    }
    if (!chapters.length) throw new Error("Niadd não devolveu capítulos para este manga.");
    return chapters;
  }

  function imageEntriesFromHTML(html, referer) {
    const pages = [];
    const seen = new Set();
    const allImages = String(html || "").match(/all_imgs_url\s*:\s*\[([\s\S]*?)\]/i);
    if (allImages) {
      const urls = allImages[1]
        .split(",")
        .map((value) => value.replace(/["'\s]/g, ""))
        .filter((value) => /^https?:\/\//i.test(value));
      for (const raw of urls) {
        const url = absoluteURL(raw);
        if (seen.has(url)) continue;
        seen.add(url);
        pages.push({
          url,
          headers: {
            Accept: "image/avif,image/webp,image/*,*/*",
            Referer: referer,
          },
        });
      }
    }

    if (!pages.length) {
      const blocks = Array.from(String(html || "").matchAll(/<div\b[^>]*class=(["'])[^"']*(?:pic_box|reading-content)[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi));
      for (const block of blocks) {
        const imgs = Array.from(block[2].matchAll(/<img\b[^>]*(?:src|data-src)=(["'])([^"']+)\1[^>]*>/gi));
        for (const img of imgs) {
          const url = absoluteURL(img[2]);
          if (!url || seen.has(url) || /(?:cover|logo)/i.test(url)) continue;
          seen.add(url);
          pages.push({
            url,
            headers: {
              Accept: "image/avif,image/webp,image/*,*/*",
              Referer: referer,
            },
          });
        }
      }
    }
    return pages;
  }

  async function extractImages(value) {
    const href = normalizedChapterURL(value);
    let html = await fetchHTML(href, `${BASE_URL}/`);
    let pages = imageEntriesFromHTML(html, href);

    if (!pages.length) {
      const sourceButton = html.match(/<a\b[^>]*class=(["'])[^"']*cool-blue[^"']*vision-button[^"']*\1[^>]*href=(["'])([^"']+)\2/i);
      if (sourceButton) {
        const sourceURL = absoluteURL(sourceButton[3]);
        html = await fetchHTML(sourceURL, href);
        pages = imageEntriesFromHTML(html, sourceURL);
      }
    }

    if (!pages.length) {
      const direct = Array.from(html.matchAll(/<(?:a|img)\b[^>]*(?:href|src)=(["'])(https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)\1/gi));
      const seen = new Set();
      for (const entry of direct) {
        const url = decodeEntities(entry[2]);
        if (seen.has(url) || /(?:cover|logo)/i.test(url)) continue;
        seen.add(url);
        pages.push({
          url,
          headers: {
            Accept: "image/avif,image/webp,image/*,*/*",
            Referer: href,
          },
        });
      }
    }

    if (!pages.length) throw new Error("Niadd não devolveu imagens legíveis para este capítulo.");
    return pages;
  }

  async function discoveryHome() {
    const popular = await searchResults("__feed:popular", 1);
    const latest = await searchResults("__feed:latest", 1);
    return {
      sections: [
        { id: "popular", title: "Populares", items: popular.items },
        { id: "latest", title: "Atualizações", items: latest.items },
      ],
    };
  }

  async function discoveryFeed(feedID, page = 1) {
    const feed = String(feedID || "").toLowerCase() === "latest" ? "latest" : "popular";
    return searchResults(`__feed:${feed}`, page);
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
