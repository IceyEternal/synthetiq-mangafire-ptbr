"use strict";

(() => {
  const API_URL = "https://api.mangadex.org";
  const SITE_URL = "https://mangadex.org";
  const LANG = "pt-br";
  const PAGE_SIZE = 32;
  const HEADERS = {
    Accept: "application/json",
    Referer: `${SITE_URL}/`,
  };

  async function responseText(response) {
    if (!response) return "";
    if (typeof response.text === "function") {
      const value = await response.text();
      if (typeof value === "string") return value;
    }
    if (typeof response.body === "string") return response.body;
    return "";
  }

  async function fetchJSON(url) {
    if (typeof globalThis.fetchv2 !== "function") {
      throw new Error("MangaDex requer a ponte fetchv2 da Synthetiq.");
    }
    const response = await globalThis.fetchv2(
      url,
      HEADERS,
      "GET",
      null,
      {
        followRedirects: true,
        maxBytesHint: 8 * 1024 * 1024,
        responseClass: "json",
      },
    );
    const status = Number(response && response.status);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
      throw new Error(`MangaDex respondeu com HTTP ${status || "erro"}.`);
    }
    const text = await responseText(response);
    if (!text) throw new Error("MangaDex devolveu uma resposta vazia.");
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("MangaDex devolveu JSON inválido.");
    }
  }

  function queryURL(path, params = []) {
    const query = params
      .filter((entry) => entry && entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    return `${API_URL}${path}${query ? `?${query}` : ""}`;
  }

  function uuidFrom(value) {
    const text = String(value || "");
    const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (!match) throw new Error("Identificador MangaDex inválido.");
    return match[0].toLowerCase();
  }

  function localized(object) {
    if (!object || typeof object !== "object") return "";
    return String(object[LANG] || object["pt-br"] || object.pt || object.en || object["ja-ro"] || Object.values(object)[0] || "").trim();
  }

  function relationship(item, type) {
    return (item && Array.isArray(item.relationships) ? item.relationships : []).find((rel) => rel && rel.type === type) || null;
  }

  function relationships(item, type) {
    return (item && Array.isArray(item.relationships) ? item.relationships : []).filter((rel) => rel && rel.type === type);
  }

  function coverURL(item, size = 256) {
    const cover = relationship(item, "cover_art");
    const fileName = cover && cover.attributes && cover.attributes.fileName;
    if (!fileName) return "";
    const id = uuidFrom(item.id);
    return `https://uploads.mangadex.org/covers/${id}/${fileName}.${size}.jpg`;
  }

  function mangaItem(item) {
    const attributes = item && item.attributes ? item.attributes : {};
    const title = localized(attributes.title) || "Sem título";
    const id = uuidFrom(item.id);
    return {
      id,
      href: `${SITE_URL}/title/${id}`,
      url: `${SITE_URL}/title/${id}`,
      title,
      image: coverURL(item),
    };
  }

  function parseMangaPage(payload, offset) {
    const data = Array.isArray(payload && payload.data) ? payload.data : [];
    const total = Number(payload && payload.total);
    return {
      items: data.map(mangaItem),
      hasMore: Number.isFinite(total) ? offset + data.length < total : data.length >= PAGE_SIZE,
    };
  }

  async function searchResults(query, page = 1) {
    const currentPage = Math.max(1, Number(page) || 1);
    const offset = (currentPage - 1) * PAGE_SIZE;
    const text = String(query || "").trim();
    const params = [
      ["limit", PAGE_SIZE],
      ["offset", offset],
      ["includes[]", "cover_art"],
      ["availableTranslatedLanguage[]", LANG],
      ["contentRating[]", "safe"],
      ["contentRating[]", "suggestive"],
      ["contentRating[]", "erotica"],
    ];

    if (text === "__feed:popular") {
      params.push(["order[followedCount]", "desc"]);
    } else if (text === "__feed:latest") {
      params.push(["order[latestUploadedChapter]", "desc"]);
    } else {
      params.push(["title", text.slice(0, 200)]);
      params.push(["order[relevance]", "desc"]);
    }

    const payload = await fetchJSON(queryURL("/manga", params));
    return parseMangaPage(payload, offset);
  }

  async function extractDetails(value) {
    const id = uuidFrom(value);
    const payload = await fetchJSON(queryURL(`/manga/${id}`, [
      ["includes[]", "cover_art"],
      ["includes[]", "author"],
      ["includes[]", "artist"],
    ]));
    const item = payload && payload.data;
    if (!item) throw new Error("MangaDex não devolveu os detalhes do manga.");
    const attributes = item.attributes || {};
    const authors = relationships(item, "author").map((rel) => rel.attributes && rel.attributes.name).filter(Boolean);
    const artists = relationships(item, "artist").map((rel) => rel.attributes && rel.attributes.name).filter(Boolean);
    const genres = (Array.isArray(attributes.tags) ? attributes.tags : [])
      .map((tag) => tag && tag.attributes && localized(tag.attributes.name))
      .filter(Boolean);
    const statusMap = {
      ongoing: "Em publicação",
      completed: "Completo",
      hiatus: "Em hiato",
      cancelled: "Cancelado",
    };
    return {
      id,
      href: `${SITE_URL}/title/${id}`,
      url: `${SITE_URL}/title/${id}`,
      title: localized(attributes.title) || "Sem título",
      description: localized(attributes.description),
      image: coverURL(item, 512),
      authors,
      author: authors.join(", "),
      artists,
      artist: artists.join(", "),
      genres,
      status: statusMap[String(attributes.status || "").toLowerCase()] || String(attributes.status || "Desconhecido"),
    };
  }

  async function extractChapters(value) {
    const mangaID = uuidFrom(value);
    const chapters = [];
    const seen = new Set();
    const limit = 100;
    let offset = 0;

    for (let batch = 0; batch < 20; batch += 1) {
      const payload = await fetchJSON(queryURL(`/manga/${mangaID}/feed`, [
        ["limit", limit],
        ["offset", offset],
        ["translatedLanguage[]", LANG],
        ["order[volume]", "desc"],
        ["order[chapter]", "desc"],
        ["includeFutureUpdates", 0],
        ["includeExternalUrl", 0],
      ]));
      const data = Array.isArray(payload && payload.data) ? payload.data : [];
      for (const item of data) {
        const id = uuidFrom(item.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const attributes = item.attributes || {};
        const rawNumber = String(attributes.chapter || "").trim();
        const number = rawNumber && Number.isFinite(Number(rawNumber)) ? Number(rawNumber) : null;
        const chapterTitle = String(attributes.title || "").trim();
        let title = rawNumber ? `Capítulo ${rawNumber}` : "Capítulo";
        if (chapterTitle) title += ` - ${chapterTitle}`;
        chapters.push({
          id,
          href: `${SITE_URL}/chapter/${id}`,
          url: `${SITE_URL}/chapter/${id}`,
          title,
          number,
          releaseDate: attributes.publishAt || attributes.readableAt || null,
          language: "pt-BR",
          scanlator: relationship(item, "scanlation_group")?.attributes?.name || "",
        });
      }
      const total = Number(payload && payload.total);
      offset += data.length;
      if (!data.length || (Number.isFinite(total) && offset >= total) || data.length < limit) break;
    }

    if (!chapters.length) throw new Error("Este manga não tem capítulos PT-BR no MangaDex.");
    return chapters;
  }

  async function extractImages(value) {
    const chapterID = uuidFrom(value);
    const payload = await fetchJSON(`${API_URL}/at-home/server/${chapterID}`);
    const baseUrl = String(payload && payload.baseUrl || "").replace(/\/$/, "");
    const chapter = payload && payload.chapter ? payload.chapter : {};
    const hash = String(chapter.hash || "");
    const files = Array.isArray(chapter.data) ? chapter.data : [];
    if (!baseUrl || !hash || !files.length) throw new Error("MangaDex não devolveu as páginas deste capítulo.");
    return files.map((file) => ({
      url: `${baseUrl}/data/${hash}/${file}`,
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*",
        Referer: `${SITE_URL}/`,
      },
    }));
  }

  async function discoveryHome() {
    const [popular, latest] = await Promise.all([
      searchResults("__feed:popular", 1),
      searchResults("__feed:latest", 1),
    ]);
    return {
      sections: [
        { id: "popular", title: "Populares em PT-BR", items: popular.items },
        { id: "latest", title: "Atualizações PT-BR", items: latest.items },
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
