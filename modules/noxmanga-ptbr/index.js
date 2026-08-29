"use strict";

(() => {
  const BASE_URL = "https://noxmangas.org";
  const API_URL = `${BASE_URL}/api/v1`;
  const SITE_ID = "00000000-0000-0000-0000-000000000003";
  const PAGE_SIZE = 24;
  const HEADERS = {
    Accept: "application/json,text/plain,*/*",
    Referer: `${BASE_URL}/`,
    "Sec-Fetch-Site": "same-origin",
  };

  let cachedSigner = null;

  async function responseText(response) {
    if (!response) return "";
    if (typeof response.text === "function") {
      const value = await response.text();
      if (typeof value === "string") return value;
    }
    if (typeof response.body === "string") return response.body;
    return "";
  }

  async function rawFetch(url, headers = HEADERS) {
    if (typeof globalThis.fetchv2 !== "function") {
      throw new Error("NoxManga requer a ponte fetchv2 da Synthetiq.");
    }
    return globalThis.fetchv2(
      url,
      headers,
      "GET",
      null,
      {
        followRedirects: true,
        maxBytesHint: 16 * 1024 * 1024,
        responseClass: "text",
      },
    );
  }

  function reverse(value) {
    return Array.from(String(value || "")).reverse().join("");
  }

  function parseSigner(script) {
    const arrayMatch = String(script || "").match(/z\s*=\s*\[([\s\S]*?)\]/);
    const slotMatch = String(script || "").match(/=\s*r\(z\[(\d+)\]\)/);
    const keyMatch = String(script || "").match(/k\s*=\s*j\(z\.slice\((\d+)\s*,\s*(\d+)\)\)/);
    const tokenMatch = String(script || "").match(/t\s*=\s*j\(z\.slice\((\d+)\)\)/);
    if (!arrayMatch || !slotMatch || !keyMatch || !tokenMatch) {
      throw new Error("NoxManga: falha ao interpretar o assinador do site.");
    }

    const parts = [];
    const stringPattern = /"([^"]*)"/g;
    let match;
    while ((match = stringPattern.exec(arrayMatch[1])) !== null) parts.push(reverse(match[1]));

    const slotIndex = Number(slotMatch[1]);
    const keyStart = Number(keyMatch[1]);
    const keyEnd = Number(keyMatch[2]);
    const tokenStart = Number(tokenMatch[1]);
    if (!parts.length || !parts[slotIndex]) throw new Error("NoxManga: assinador inválido.");

    return {
      slot: parts[slotIndex],
      key: parts.slice(keyStart, keyEnd).join(""),
      token: parts.slice(tokenStart).join(""),
    };
  }

  async function getSigner(force = false) {
    if (cachedSigner && !force) return cachedSigner;
    const response = await rawFetch(`${BASE_URL}/_nix/signer.js`, {
      Accept: "application/javascript,text/javascript,*/*",
      Referer: `${BASE_URL}/`,
      "Sec-Fetch-Site": "same-origin",
    });
    const status = Number(response && response.status);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
      throw new Error(`NoxManga: não foi possível obter o assinador (HTTP ${status || "erro"}).`);
    }
    cachedSigner = parseSigner(await responseText(response));
    return cachedSigner;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(text));
    const encoded = unescape(encodeURIComponent(text));
    const bytes = [];
    for (let i = 0; i < encoded.length; i += 1) bytes.push(encoded.charCodeAt(i));
    return bytes;
  }

  function rotr(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256Bytes(message) {
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes = utf8Bytes(message);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    bytes.push((high >>> 24) & 255,(high >>> 16) & 255,(high >>> 8) & 255,high & 255,(low >>> 24) & 255,(low >>> 16) & 255,(low >>> 8) & 255,low & 255);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      const w = new Array(64);
      for (let i = 0; i < 16; i += 1) {
        const j = offset + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i += 1) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i += 1) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    const out = [];
    for (const value of H) out.push((value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255);
    return out;
  }

  function base64Url(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63];
      if (i + 1 < bytes.length) out += chars[(n >>> 6) & 63];
      if (i + 2 < bytes.length) out += chars[n & 63];
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function encodedPath(url) {
    const match = String(url || "").match(/^https?:\/\/[^/]+([^?#]*)/i);
    return (match && match[1]) || "/";
  }

  function signedHeaders(url, signer) {
    const path = encodedPath(url);
    const payload = ["GET", path, SITE_ID, signer.slot, signer.token, signer.key].join("|");
    return {
      ...HEADERS,
      "X-Site-ID": SITE_ID,
      "X-Web-Slot": signer.slot,
      "X-Web-Token": signer.token,
      "X-Web-Signature": base64Url(sha256Bytes(payload)),
    };
  }

  async function fetchJSON(url, retry = true) {
    let signer = await getSigner(false);
    let response = await rawFetch(url, signedHeaders(url, signer));
    let status = Number(response && response.status);
    if (status === 401 && retry) {
      signer = await getSigner(true);
      response = await rawFetch(url, signedHeaders(url, signer));
      status = Number(response && response.status);
    }
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
      throw new Error(`NoxManga respondeu com HTTP ${status || "erro"}.`);
    }
    const text = await responseText(response);
    if (!text) throw new Error("NoxManga devolveu uma resposta vazia.");
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("NoxManga devolveu JSON inválido.");
    }
  }

  function queryURL(path, params = []) {
    const query = params
      .filter((entry) => entry && entry[1] !== null && entry[1] !== undefined && entry[1] !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    return `${API_URL}${path}${query ? `?${query}` : ""}`;
  }

  function absoluteURL(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    if (/^https?:\/\//i.test(input)) return input;
    if (input.startsWith("//")) return `https:${input}`;
    if (input.startsWith("/")) return `${BASE_URL}${input}`;
    return `${BASE_URL}/${input}`;
  }

  function slugFrom(value) {
    const input = decodeURIComponent(String(value || "")).trim();
    const match = input.match(/\/manga\/([^/?#]+)/i);
    if (match) return match[1];
    if (/^[a-z0-9][a-z0-9-]*$/i.test(input)) return input;
    throw new Error("Identificador NoxManga inválido.");
  }

  function mangaItem(item) {
    const slug = String(item && item.slug || "").trim();
    return {
      id: slug,
      href: `${BASE_URL}/manga/${slug}`,
      url: `${BASE_URL}/manga/${slug}`,
      title: String(item && item.title || "Sem título"),
      image: absoluteURL(item && item.cover),
    };
  }

  function parseMangaPage(payload) {
    const comics = Array.isArray(payload && payload.comics) ? payload.comics : [];
    const page = Number(payload && payload.page) || 1;
    const totalPages = Number(payload && payload.total_pages) || page;
    return {
      items: comics.map(mangaItem),
      hasMore: page < totalPages,
    };
  }

  async function searchResults(query, page = 1) {
    const currentPage = Math.max(1, Number(page) || 1);
    const text = String(query || "").trim();
    if (text === "__feed:latest") {
      const payload = await fetchJSON(queryURL("/chapters/recent", [
        ["page", currentPage],
        ["per_page", PAGE_SIZE],
        ["unique", "true"],
        ["sort", "new"],
      ]));
      const data = Array.isArray(payload && payload.data) ? payload.data : [];
      const seen = new Set();
      const items = [];
      for (const item of data) {
        const slug = String(item && item.comic_slug || "").trim();
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        items.push({
          id: slug,
          href: `${BASE_URL}/manga/${slug}`,
          url: `${BASE_URL}/manga/${slug}`,
          title: String(item && item.comic_title || "Sem título"),
          image: absoluteURL(item && item.comic_cover),
        });
      }
      const totalPages = Number(payload && payload.total_pages) || currentPage;
      return { items, hasMore: currentPage < totalPages };
    }

    const params = [["page", currentPage], ["per_page", PAGE_SIZE]];
    if (text !== "__feed:popular" && text) params.push(["q", text.slice(0, 200)]);
    const payload = await fetchJSON(queryURL("/comics", params));
    return parseMangaPage(payload);
  }

  async function extractDetails(value) {
    const slug = slugFrom(value);
    const item = await fetchJSON(`${API_URL}/comics/slug/${encodeURIComponent(slug)}`);
    const genres = Array.isArray(item && item.genres) ? item.genres.map((genre) => String(genre && genre.name || "")).filter(Boolean) : [];
    const alt = Array.isArray(item && item.title_alt) ? item.title_alt.filter(Boolean) : [];
    const synopsis = String(item && item.synopsis || "").trim();
    const description = [synopsis, alt.length ? `Títulos alternativos: ${alt.join(", ")}` : ""].filter(Boolean).join("\n\n");
    const statusMap = { ongoing: "Em publicação", completed: "Completo", hiatus: "Em hiato", cancelled: "Cancelado" };
    return {
      id: slug,
      href: `${BASE_URL}/manga/${slug}`,
      url: `${BASE_URL}/manga/${slug}`,
      title: String(item && item.title || "Sem título"),
      description,
      image: absoluteURL(item && item.cover),
      authors: [],
      author: "",
      artists: [],
      artist: "",
      genres: [item && item.type ? String(item.type) : "", ...genres].filter(Boolean),
      status: statusMap[String(item && item.status || "").toLowerCase()] || String(item && item.status || "Desconhecido"),
    };
  }

  async function extractChapters(value) {
    const mangaSlug = slugFrom(value);
    const payload = await fetchJSON(queryURL(`/comics/slug/${encodeURIComponent(mangaSlug)}/chapters`, [
      ["page", 1],
      ["per_page", 10000],
      ["sort", "newest"],
    ]));
    const data = Array.isArray(payload && payload.chapters) ? payload.chapters : [];
    if (!data.length) throw new Error("NoxManga não devolveu capítulos para este manga.");
    return data.map((chapter) => {
      const id = String(chapter && chapter.id || "");
      const slug = String(chapter && chapter.slug || "");
      const numberRaw = chapter && chapter.number;
      const number = Number.isFinite(Number(numberRaw)) ? Number(numberRaw) : null;
      const titleText = String(chapter && chapter.title || "").trim();
      let title = number !== null ? `Capítulo ${String(number).replace(/\.0$/, "")}` : "Capítulo";
      if (titleText && !titleText.toLowerCase().startsWith("capítulo") && titleText !== String(numberRaw)) title += ` - ${titleText}`;
      const href = `${BASE_URL}/read/${encodeURIComponent(mangaSlug)}/${encodeURIComponent(slug)}?nox_id=${encodeURIComponent(id)}`;
      return {
        id,
        href,
        url: href,
        title,
        number,
        releaseDate: chapter && chapter.published_at || null,
        language: "pt-BR",
      };
    });
  }

  function chapterIDFrom(value) {
    const input = String(value || "");
    const queryMatch = input.match(/[?&]nox_id=([^&#]+)/i);
    if (queryMatch) return decodeURIComponent(queryMatch[1]);
    if (input && !/^https?:\/\//i.test(input)) return input;
    const apiMatch = input.match(/\/api\/v1\/chapters\/([^/?#]+)/i);
    if (apiMatch) return decodeURIComponent(apiMatch[1]);
    throw new Error("Identificador de capítulo NoxManga inválido.");
  }

  async function extractImages(value) {
    const id = chapterIDFrom(value);
    const payload = await fetchJSON(`${API_URL}/chapters/${encodeURIComponent(id)}?skip_view=true`);
    const pages = Array.isArray(payload && payload.pages) ? payload.pages.slice() : [];
    pages.sort((a, b) => Number(a && a.number || 0) - Number(b && b.number || 0));
    const output = pages
      .map((page) => absoluteURL(page && page.image_url))
      .filter(Boolean)
      .map((url) => ({
        url,
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*",
          Referer: `${BASE_URL}/`,
        },
      }));
    if (!output.length) throw new Error("NoxManga não devolveu páginas para este capítulo.");
    return output;
  }

  async function discoveryHome() {
    const [popular, latest] = await Promise.all([
      searchResults("__feed:popular", 1),
      searchResults("__feed:latest", 1),
    ]);
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
