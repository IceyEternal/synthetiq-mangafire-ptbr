from pathlib import Path

path = Path("modules/niadd-ptbr/index.js")
text = path.read_text(encoding="utf-8")

marker = '''  async function appendSubPageImages(html, currentURL, pages, seen) {
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
'''

replacement = '''  function pageCountFromHTML(html) {
    let maximum = 0;
    const text = stripHTML(String(html || ""));
    const patterns = [
      /\\b\\d+\\s+of\\s+(\\d{1,3})\\b/gi,
      /\\b\\d+\\s*\\/\\s*(\\d{1,3})\\b/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const count = Number(match[1]);
        if (Number.isFinite(count) && count > maximum && count <= 300) maximum = count;
      }
    }
    return maximum;
  }

  function generatedChapterPageURL(chapterURL, pageNumber) {
    const clean = String(chapterURL || "").split("#")[0].split("?")[0];
    if (pageNumber <= 1) return clean;
    if (/\\-\\d+\\.html$/i.test(clean)) return clean.replace(/\\-\\d+\\.html$/i, `-${pageNumber}.html`);
    if (/\\/$/.test(clean)) return `${clean.slice(0, -1)}-${pageNumber}.html`;
    if (/\\.html$/i.test(clean)) return clean.replace(/\\.html$/i, `-${pageNumber}.html`);
    return `${clean}-${pageNumber}.html`;
  }

  function genericImageEntriesFromHTML(html, referer) {
    const pages = [];
    const seen = new Set();
    const matches = Array.from(String(html || "").matchAll(/<(?:a|img)\\b[^>]*(?:href|src|data-src)=(["'])(https?:\\/\\/[^"']+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"']*)?)\\1/gi));
    for (const entry of matches) {
      const url = decodeEntities(entry[2]);
      if (!url || seen.has(url) || /(?:cover|logo|avatar|icon)/i.test(url)) continue;
      if (!/(?:yx247\\.com|mangadogs\\.com|niadd\\.com)/i.test(url)) continue;
      seen.add(url);
      pages.push({
        url,
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*",
          Referer: referer,
        },
      });
    }
    return pages;
  }

  async function appendSubPageImages(html, currentURL, chapterURL, pages, seen) {
    const subPages = subPageURLsFromHTML(html, currentURL);
    for (const subURL of subPages) {
      try {
        const subHTML = await fetchHTML(subURL, currentURL);
        let found = imageEntriesFromHTML(subHTML, subURL);
        if (!found.length) found = genericImageEntriesFromHTML(subHTML, subURL);
        appendUniquePages(pages, found, seen);
      } catch (_) {
        // A broken optional sub-page must not make the entire chapter fail.
      }
    }

    const count = pageCountFromHTML(html);
    if (count > 1) {
      for (let pageNumber = 2; pageNumber <= count; pageNumber += 1) {
        const subURL = generatedChapterPageURL(chapterURL, pageNumber);
        try {
          const subHTML = await fetchHTML(subURL, chapterURL);
          let found = imageEntriesFromHTML(subHTML, subURL);
          if (!found.length) found = genericImageEntriesFromHTML(subHTML, subURL);
          appendUniquePages(pages, found, seen);
        } catch (_) {
          // Keep pages already recovered.
        }
      }
    }
  }
'''

if marker not in text:
    raise SystemExit("Niadd appendSubPageImages block not found")

text = text.replace(marker, replacement, 1)
text = text.replace(
    '    await appendSubPageImages(html, currentURL, pages, seen);',
    '    await appendSubPageImages(html, currentURL, href, pages, seen);',
    1,
)
path.write_text(text, encoding="utf-8")
