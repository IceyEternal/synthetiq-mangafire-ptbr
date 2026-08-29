"use strict";
(() => {
  const BASE_URL = "https://mangafire.to";
  const LANGUAGE = "pt-br";
  const LIMIT = 200;

  function parseJSON(value) {
    if (value && typeof value === "object") return value;
    try { return JSON.parse(String(value || "").trim()); }
    catch (_) { return null; }
  }

  function stripHTML(value) {
    return String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function apiURL(path, params = []) {
    const q = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${BASE_URL}${path}${q ? "?" + q : ""}`;
  }

  async function pageJSON(url) {
    if (typeof globalThis.pagev2 !== "function") {
      throw new Error("MangaFire PT-BR requer o bridge pagev2 da Synthetiq Books.");
    }

    const snapshot = await globalThis.pagev2({
      url,
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: `${BASE_URL}/`,
        "X-Requested-With": "XMLHttpRequest"
      },
      userAgent: null,
      timeoutMilliseconds: 30000,
      settleMilliseconds: 150,
      includeHTML: true,
      captureResponseBodies: true,
      maxEntries: 24,
      maxResponseCharacters: 2000000,
      actionScript: null,
      returnScript: "document.body ? document.body.innerText : ''",
      waitForSelector: "body",
      waitForURLIncludes: "/api/",
      waitForRequestURLIncludes: null,
      waitForResponseURLIncludes: null,
      waitForResponseBodyIncludes: null
    });

    let payload = parseJSON(snapshot && snapshot.evaluatedData);

    if (!payload && snapshot && Array.isArray(snapshot.events)) {
      for (let i = snapshot.events.length - 1; i >= 0 && !payload; i--) {
        payload = parseJSON(snapshot.events[i] && snapshot.events[i].body);
      }
    }

    if (!payload && snapshot && snapshot.html) {
      const m = String(snapshot.html).match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
      if (m) payload = parseJSON(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    }

    if (!payload) {
      throw new Error("MangaFire não devolveu JSON legível. A protecção do site pode ter mudado.");
    }
    if (payload.error) throw new Error(String(payload.error));
    return payload;
  }

  function titlePath(value) {
    const input = String(value || "").trim();
    const m = input.match(/(?:https:\/\/mangafire\.to)?\/?title\/([^/?#]+)/i);
    if (m) return `/title/${m[1]}`;
    if (/^[a-z0-9]+(?:-[a-z0-9-]+)?$/i.test(input)) return `/title/${input}`;
    throw new Error("Identificador MangaFire inválido.");
  }

  function titleHID(value) {
    return titlePath(value).replace("/title/", "").split("-")[0];
  }

  function chapterID(value) {
    const input = String(value || "").trim();
    const m =
      input.match(/(?:https:\/\/mangafire\.to)?\/?title\/[^/?#]+\/chapter\/([0-9]+)/i) ||
      input.match(/(?:https:\/\/mangafire\.to)?\/?chapter\/([0-9]+)/i);
    if (m) return m[1];
    if (/^[0-9]+$/.test(input)) return input;
    throw new Error("Identificador de capítulo MangaFire inválido.");
  }

  function mapStatus(value) {
    switch (String(value || "").toLowerCase()) {
      case "releasing": return "Ongoing";
      case "finished":
      case "completed": return "Completed";
      case "on_hiatus": return "Hiatus";
      case "discontinued": return "Cancelled";
      default: return "Unknown";
    }
  }

  function mapSearchItem(item) {
    if (!item || !item.title || !item.url) return null;
    const path = titlePath(item.url);
    const poster = item.poster || {};
    const href = `${BASE_URL}${path}`;
    return {
      id: href,
      href,
      url: href,
      title: String(item.title),
      image: String(poster.medium || poster.large || poster.small || ""),
      status: mapStatus(item.status)
    };
  }

  async function searchResults(query, page = 1) {
    const text = typeof query === "object" && query
      ? String(query.text || query.query || "").trim()
      : String(query || "").trim();

    const params = [];
    if (text === "__feed:popular") params.push(["order[views_7d]", "desc"]);
    else if (text === "__feed:latest") params.push(["order[chapter_updated_at]", "desc"]);
    else if (text && !text.startsWith("__feed:")) params.push(["keyword", text.slice(0, 200)]);

    params.push(["page", Math.max(1, Number(page) || 1)], ["limit", 30]);

    const payload = await pageJSON(apiURL("/api/titles", params));
    const items = (Array.isArray(payload.items) ? payload.items : [])
      .map(mapSearchItem)
      .filter(Boolean);

    return {
      items,
      hasMore: payload.meta ? Boolean(payload.meta.hasNext) : items.length >= 30
    };
  }

  async function extractDetails(id) {
    const hid = titleHID(id);
    const payload = await pageJSON(apiURL(`/api/titles/${encodeURIComponent(hid)}`));
    const item = payload && payload.data ? payload.data : payload;
    if (!item || !item.title) throw new Error("Detalhes do manga indisponíveis.");

    const path = titlePath(item.url || id);
    const poster = item.poster || {};
    const authors = Array.isArray(item.authors)
      ? item.authors.map(a => String((a && a.title) || "")).filter(Boolean)
      : [];
    const groups = [item.genres, item.themes, item.demographics];
    const genres = groups.flatMap(group =>
      Array.isArray(group)
        ? group.map(x => String((x && x.title) || "")).filter(Boolean)
        : []
    );

    const href = `${BASE_URL}${path}`;
    return {
      id: href,
      href,
      url: href,
      title: String(item.title),
      description: stripHTML(item.synopsisHtml || item.description || ""),
      image: String(poster.large || poster.medium || poster.small || ""),
      author: authors.join(", "),
      authors,
      genres,
      status: mapStatus(item.status)
    };
  }

  async function canonicalTitlePath(id, hid) {
    const p = titlePath(id);
    if (p.replace("/title/", "").includes("-")) return p;
    const details = await extractDetails(id);
    return titlePath(details.url || details.href);
  }

  function chapterURL(hid, page) {
    return apiURL(`/api/titles/${encodeURIComponent(hid)}/chapters`, [
      ["language", LANGUAGE],
      ["sort", "number"],
      ["order", "desc"],
      ["page", page],
      ["limit", LIMIT]
    ]);
  }

  async function extractChapters(id) {
    const hid = titleHID(id);
    const path = await canonicalTitlePath(id, hid);
    const first = await pageJSON(chapterURL(hid, 1));
    const lastPage = Math.max(1, Number(first.meta && first.meta.lastPage) || 1);
    const responses = [first];

    for (let page = 2; page <= lastPage && page <= 64; page++) {
      responses.push(await pageJSON(chapterURL(hid, page)));
    }

    const seen = new Set();
    const chapters = [];

    for (const response of responses) {
      for (const item of Array.isArray(response.items) ? response.items : []) {
        const remoteID = String((item && item.id) || "");
        if (!/^[0-9]+$/.test(remoteID) || seen.has(remoteID)) continue;

        const number = Number(item.number);
        const chapterName = String(item.name || "").trim();
        const label = Number.isFinite(number) ? `Capítulo ${number}` : "Capítulo";
        const title = chapterName ? `${label}: ${chapterName}` : label;
        const href = `${BASE_URL}${path}/chapter/${remoteID}`;

        chapters.push({
          id: href,
          href,
          url: href,
          title,
          number: Number.isFinite(number) ? number : null,
          language: String(item.language || LANGUAGE),
          type: String(item.type || "")
        });
        seen.add(remoteID);
      }
    }

    return chapters;
  }

  async function extractImages(id) {
    const remoteID = chapterID(id);
    const payload = await pageJSON(apiURL(`/api/chapters/${encodeURIComponent(remoteID)}`));
    const chapter = payload && payload.data ? payload.data : payload;
    const rawPages = chapter && Array.isArray(chapter.pages) ? chapter.pages : [];

    const pages = rawPages.map(value => {
      const object = Array.isArray(value) ? null : value;
      const url = String(Array.isArray(value) ? value[0] : object && (object.url || object.src || object.image) || "");
      if (!url.startsWith("https://")) return null;
      return {
        url,
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*",
          Referer: `${BASE_URL}/`
        }
      };
    }).filter(Boolean);

    if (!pages.length) throw new Error("O capítulo não devolveu páginas legíveis.");
    return pages;
  }

  async function discoveryHome() {
    const popular = await searchResults("__feed:popular", 1);
    const latest = await searchResults("__feed:latest", 1);
    return {
      sections: [
        { id: "popular", title: "Popular", items: popular.items },
        { id: "latest", title: "Recentes", items: latest.items }
      ]
    };
  }

  async function discoveryFeed(feedID, page = 1) {
    const feed = String(feedID || "").toLowerCase() === "latest" ? "latest" : "popular";
    return searchResults(`__feed:${feed}`, page);
  }

  async function extractTags() {
    return [
      "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
      "Martial Arts", "Mystery", "Psychological", "Romance",
      "Seinen", "Shounen", "Slice of Life", "Sports", "Supernatural", "Tragedy"
    ];
  }

  const handlers = {
    discoveryHome,
    discoveryFeed,
    searchResults,
    extractDetails,
    extractChapters,
    extractImages,
    extractTags
  };

  globalThis.SynthetiqModule = handlers;
  Object.assign(globalThis, handlers);
})();
