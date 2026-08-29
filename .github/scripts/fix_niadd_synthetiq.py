from pathlib import Path

path = Path("modules/niadd-ptbr/index.js")
text = path.read_text(encoding="utf-8")

old = '''  async function extractImages(value) {
    const href = normalizedChapterURL(value);
    let html = await fetchHTML(href, `${BASE_URL}/`);
    let pages = imageEntriesFromHTML(html, href);

    if (!pages.length) {
      const sourceButton = html.match(/<a\\b[^>]*class=(["'])[^"']*cool-blue[^"']*vision-button[^"']*\\1[^>]*href=(["'])([^"']+)\\2/i);
      if (sourceButton) {
        const sourceURL = absoluteURL(sourceButton[3]);
        html = await fetchHTML(sourceURL, href);
        pages = imageEntriesFromHTML(html, sourceURL);
      }
    }

    if (!pages.length) {
      const direct = Array.from(html.matchAll(/<(?:a|img)\\b[^>]*(?:href|src)=(["'])(https?:\\/\\/[^"']+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"']*)?)\\1/gi));
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
'''

new = '''  function subPageURLsFromHTML(html, currentURL) {
    const urls = [];
    const seen = new Set();
    const selects = Array.from(String(html || "").matchAll(/<select\\b[^>]*class=(["'])[^"']*\\bsl-page\\b[^"']*\\1[^>]*>([\\s\\S]*?)<\\/select>/gi));
    for (const select of selects) {
      const options = Array.from(select[2].matchAll(/<option\\b[^>]*value=(["'])([^"']+)\\1[^>]*>/gi));
      for (const option of options) {
        const raw = decodeEntities(option[2]).trim();
        if (!raw) continue;
        let url = "";
        if (/^https?:\\/\\//i.test(raw)) url = raw;
        else if (raw.startsWith("/")) url = `${BASE_URL}${raw}`;
        else url = `${BASE_URL}/${raw.replace(/^\\//, "")}`;
        if (!url || url === currentURL || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
    return urls;
  }

  function appendUniquePages(target, incoming, seen) {
    for (const page of incoming || []) {
      const url = String(page && page.url || "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      target.push(page);
    }
  }

  async function appendSubPageImages(html, currentURL, pages, seen) {
    const subPages = subPageURLsFromHTML(html, currentURL);
    for (const subURL of subPages) {
      try {
        const subHTML = await fetchHTML(subURL, currentURL);
        appendUniquePages(pages, imageEntriesFromHTML(subHTML, subURL), seen);
      } catch (_) {
        // A broken optional sub-page must not make the entire chapter fail.
      }
    }
  }

  async function extractImages(value) {
    const href = normalizedChapterURL(value);
    let currentURL = href;
    let html = await fetchHTML(href, `${BASE_URL}/`);
    const pages = [];
    const seen = new Set();

    const allImages = String(html || "").match(/all_imgs_url\\s*:\\s*\\[([\\s\\S]*?)\\]/i);
    if (allImages) {
      appendUniquePages(pages, imageEntriesFromHTML(html, currentURL), seen);
    } else {
      const sourceButton = html.match(/<a\\b[^>]*class=(["'])[^"']*cool-blue[^"']*vision-button[^"']*\\1[^>]*href=(["'])([^"']+)\\2/i);
      if (sourceButton) {
        const sourceURL = absoluteURL(sourceButton[3]);
        html = await fetchHTML(sourceURL, href);
        currentURL = sourceURL;
      }
      appendUniquePages(pages, imageEntriesFromHTML(html, currentURL), seen);
    }

    // Niadd can split one chapter across several HTML sub-pages. The old
    // Synthetiq source only parsed the first one, which commonly exposed two
    // images. This mirrors the current Keiyoushi extension by following every
    // option in select.sl-page and merging the images in order.
    await appendSubPageImages(html, currentURL, pages, seen);

    if (!pages.length) {
      const direct = Array.from(html.matchAll(/<(?:a|img)\\b[^>]*(?:href|src)=(["'])(https?:\\/\\/[^"']+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"']*)?)\\1/gi));
      for (const entry of direct) {
        const url = decodeEntities(entry[2]);
        if (!url || seen.has(url) || /(?:cover|logo)/i.test(url)) continue;
        seen.add(url);
        pages.push({
          url,
          headers: {
            Accept: "image/avif,image/webp,image/*,*/*",
            Referer: currentURL,
          },
        });
      }
    }

    if (!pages.length) throw new Error("Niadd não devolveu imagens legíveis para este capítulo.");
    return pages;
  }
'''

if old not in text:
    raise SystemExit("Expected Niadd extractImages block not found")

path.write_text(text.replace(old, new, 1), encoding="utf-8")
