"use strict";

(() => {
  const BASE_URL = "https://noxmangas.org";
  const API_URL = `${BASE_URL}/api/v1`;
  const SIGNER_URL = `${BASE_URL}/_nix/signer.js`;
  const SITE_ID = "00000000-0000-0000-0000-000000000003";
  const PAGE_SIZE = 24;
  const HEADERS = {
    Accept: "application/json,text/plain,*/*",
    Referer: `${BASE_URL}/`,
    "Sec-Fetch-Site": "same-origin",
  };

  let signerCache = null;

  async function responseText(response) {
    if (!response) return "";
    if (typeof response.text === "function") {
      const value = await response.text();
      if (typeof value === "string") return value;
    }
    if (typeof response.body === "string") return response.body;
    return "";
  }

  async function rawFetch(url, headers = HEADERS, responseClass = "json") {
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
        responseClass,
      },
    );
  }

  function parseSigner(script) {
    const arrayMatch = String(script || "").match(/z\s*=\s*\[(.*?)]/s);
    const slotMatch = String(script || "").match(/=\s*r\(z\[(\d+)]\)/);
    const keyMatch = String(script || "").match(/k\s*=\s*j\(z\.slice\((\d+)\s*,\s*(\d+)\)\)/);
    const tokenMatch = String(script || "").match(/t\s*=\s*j\(z\.slice\((\d+)\)\)/);
    if (!arrayMatch || !slotMatch || !keyMatch || !tokenMatch) {
      throw new Error("Não foi possível interpretar o assinador do NoxManga.");
    }
    const parts = Array.from(arrayMatch[1].matchAll(/"([^"]*)"/g)).map((entry) => entry[1].split("").reverse().join(""));
    const slotIndex = Number(slotMatch[1]);
    const keyStart = Number(keyMatch[1]);
    const keyEnd = Number(keyMatch[2]);
    const tokenStart = Number(tokenMatch[1]);
    if (!parts.length || !Number.isFinite(slotIndex) || !parts[slotIndex]) {
      throw new Error("Assinador do NoxManga inválido.");
    }
    return {
      slot: parts[slotIndex],
      key: parts.slice(keyStart, keyEnd).join(""),
      token: parts.slice(tokenStart).join(""),
    };
  }

  async function fetchSigner(force = false) {
    if (signerCache && !force) return signerCache;
    const response = await rawFetch(SIGNER_URL, {
      Accept: "application/javascript,text/javascript,*/*",
      Referer: `${BASE_URL}/`,
    }, "html");
    const status = Number(response && response.status);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) {
      throw new Error(`NoxManga signer respondeu com HTTP ${status || "erro"}.`);
    }
    const text = await responseText(response);
    signerCache = parseSigner(text);
    return signerCache;
  }

  function rotr(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256Bytes(input) {
    const bytes = [];
    const utf8 = unescape(encodeURIComponent(String(input)));
    for (let i = 0; i < utf8.length; i += 1) bytes.push(utf8.charCodeAt(i));
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

    const k = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) {
        const j = offset + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i += 1) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
        const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (s0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
      h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
    }
    const out = [];
    for (const value of h) {
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    }
    return out;
  }

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    let encoded;
    if (typeof globalThis.btoa === "function") encoded = globalThis.btoa(binary);
    else {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      encoded = "";
      for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const n = (a << 16) | (b << 8) | c;
        encoded += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (i + 1 < bytes.length ? chars[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? chars[n & 63] : "=");
      }
    }
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function encodedPath(url) {
    const text = String(url || "");
    const match = text.match(/^https?:\/\/[^/]+(\/[^?#]*)/i);
    return match ? match[1] : "/";
  }

  function signature(method, path, signer) {
    const payload = [String(method || "GET").toUpperCase(), path, SITE_ID, signer.slot, signer.token, signer.key].join("|");
    return base64Url(sha256Bytes(payload));
  }

  async function fetchJSON(url, retry = true) {
    const signer = await fetchSigner(false);
    const path = encodedPath(url);
    const headers = {
      ...HEADERS,
      "X-Site-ID": SITE_ID,
      "X-Web-Slot": signer.slot,
      "X-Web-Token": signer.token,
      "X-Web-Signature": signature("GET", path, signer),
    };
    const response = await rawFetch(url, headers, "json");
    const status = Number(response && response.status);
    if (status === 401 && retry) {
      await fetchSigner(true);
      return fetchJSON(url, false);
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

  function slugFrom(value) {
    const text = decodeURIComponent(String(value || "").trim());
    const match = text.match(/\/manga\/([^/?#]+)/i);
    if (match) return match[1];
    if (/^[a-z0-9][a-z0-9-]{1,200}$/i.test(text)) return text;
    throw new Error("Identificador NoxManga inválido.");
  }

  function chapterIDFrom(value) {
    const text = decodeURIComponent(String(value || "").trim());
    const match = text.match(/\/chapter\/([^/?#]+)/i);
    if (match) return match[1];
    if (/^[a-z0-9_-]{4,200}$/i.test(text)) return text;
    throw new Error("Identificador de capítulo NoxManga inválido.");
  }

  function mangaItem(item) {
    const slug = String(item && item.slug || "");
    return {
      id: slug,
      href: `${BASE_URL}/manga/${slug}`,
      url: `${BASE_URL}/manga/${slug}`,
      title: String(item && item.title || "Sem título"),
      image: String(item && item.cover || ""),
    };
  }

  function listResult(payload, items) {
    const page = Number(payload && payload.page) || 1;
    const totalPages = Number(payload && payload.total_pages) || page;
    return { items, hasMore: page < totalPages };
  }

  async function searchResults(query, page = 1) {
    const currentPage = Math.max(1, Number(page) || 1);
    const text = String(query || "").trim();
    if (text === "__feed:latest") {
      const payload = await fetchJSON(queryURL("/chapters/recent", [
        ["page", currentPage], ["per_page", PAGE_SIZE], ["unique", "true"], ["sort", "new"],
      ]));
      const data = Array.isArray(payload && payload.data) ? payload.data : [];
      const seen = new Set();
      const items = [];
      for (const entry of data) {
        const slug = String(entry && entry.comic_slug || "");
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        items.push({
          id: slug,
          href: `${BASE_URL}/manga/${slug}`,
          url: `${BASE_URL}/manga/${slug}`,
          title: String(entry && entry.comic_title || "Sem título"),
          image: String(entry && entry.comic_cover || ""),
        });
      }
      return listResult(payload, items);
    }

    const params = [["page", currentPage], ["per_page", PAGE_SIZE]];
    if (text !== "__feed:popular" && text) params.push(["q", text.slice(0, 200)]);
    const payload = await fetchJSON(queryURL("/comics", params));
    const comics = Array.isArray(payload && payload.comics) ? payload.comics : [];
    return listResult(payload, comics.map(mangaItem));
  }

  async function extractDetails(value) {
    const slug = slugFrom(value);
    const item = await fetchJSON(`${API_URL}/comics/slug/${encodeURIComponent(slug)}`);
    const genres = Array.isArray(item && item.genres) ? item.genres.map((genre) => String(genre && genre.name || "")).filter(Boolean) : [];
    const alternatives = Array.isArray(item && item.title_alt) ? item.title_alt.filter(Boolean) : [];
    const statusMap = { ongoing: "Em publicação", completed: "Completo", hiatus: "Em hiato", cancelled: "Cancelado" };
    let description = String(item && item.synopsis || "").trim();
    if (alternatives.length) description += `${description ? "\n\n" : ""}Títulos alternativos: ${alternatives.join(", ")}`;
    return {
      id: slug,
      href: `${BASE_URL}/manga/${slug}`,
      url: `${BASE_URL}/manga/${slug}`,
      title: String(item && item.title || "Sem título"),
      description,
      image: String(item && item.cover || ""),
      authors: [], author: "", artists: [], artist: "",
      genres,
      status: statusMap[String(item && item.status || "").toLowerCase()] || String(item && item.status || "Desconhecido"),
    };
  }

  async function extractChapters(value) {
    const slug = slugFrom(value);
    const payload = await fetchJSON(queryURL(`/comics/slug/${encodeURIComponent(slug)}/chapters`, [
      ["page", 1], ["per_page", 10000], ["sort", "newest"],
    ]));
    const data = Array.isArray(payload && payload.chapters) ? payload.chapters : [];
    const chapters = data.map((item) => {
      const id = String(item && item.id || "");
      const raw = Number(item && item.number);
      const number = Number.isFinite(raw) ? raw : null;
      const formatted = number === null ? "" : String(number).replace(/\.0$/, "");
      const extra = String(item && item.title || "").trim();
      let title = formatted ? `Capítulo ${formatted}` : "Capítulo";
      if (extra && extra !== formatted && !/^cap[ií]tulo/i.test(extra)) title += ` - ${extra}`;
      return {
        id,
        href: `${BASE_URL}/chapter/${id}`,
        url: `${BASE_URL}/chapter/${id}`,
        title,
        number,
        releaseDate: item && item.published_at || null,
        language: "pt-BR",
      };
    }).filter((chapter) => chapter.id);
    if (!chapters.length) throw new Error("NoxManga não devolveu capítulos para este manga.");
    return chapters;
  }

  async function extractImages(value) {
    const id = chapterIDFrom(value);
    const payload = await fetchJSON(`${API_URL}/chapters/${encodeURIComponent(id)}?skip_view=true`);
    const pages = Array.isArray(payload && payload.pages) ? payload.pages.slice() : [];
    pages.sort((a, b) => Number(a && a.number || 0) - Number(b && b.number || 0));
    const result = pages.map((page) => String(page && page.image_url || "")).filter(Boolean).map((url) => ({
      url,
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*",
        Referer: `${BASE_URL}/`,
      },
    }));
    if (!result.length) throw new Error("NoxManga não devolveu páginas para este capítulo.");
    return result;
  }

  async function discoveryHome() {
    const [latest, popular] = await Promise.all([
      searchResults("__feed:latest", 1),
      searchResults("__feed:popular", 1),
    ]);
    return {
      sections: [
        { id: "latest", title: "Atualizações", items: latest.items },
        { id: "popular", title: "Populares", items: popular.items },
      ],
    };
  }

  async function discoveryFeed(feedID, page = 1) {
    const feed = String(feedID || "").toLowerCase() === "latest" ? "latest" : "popular";
    return searchResults(`__feed:${feed}`, page);
  }

  const handlers = { searchResults, extractDetails, extractChapters, extractImages, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers;
  Object.assign(globalThis, handlers);
})();
