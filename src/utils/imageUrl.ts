/**
 * Normalize well-known non-direct-image URLs to direct image URLs.
 * - Wikipedia media pages → Special:FilePath redirect (CORS-enabled)
 * - Wikimedia Commons file pages → Special:FilePath redirect
 */
export function normalizeImageUrl(raw: string): string {
  let url = raw.trim();

  // Wikipedia media page: .../wiki/...#/media/File:Name.jpg
  const wikiMediaMatch = url.match(
    /(\w+)\.wikipedia\.org\/wiki\/[^#]*#\/media\/File:(.+)$/
  );
  if (wikiMediaMatch) {
    const [, lang, filename] = wikiMediaMatch;
    return `https://${lang}.wikipedia.org/wiki/Special:FilePath/${filename}`;
  }

  // Wikipedia file page: .../wiki/File:Name.jpg
  const wikiFileMatch = url.match(
    /(\w+)\.wikipedia\.org\/wiki\/File:(.+)$/
  );
  if (wikiFileMatch) {
    const [, lang, filename] = wikiFileMatch;
    return `https://${lang}.wikipedia.org/wiki/Special:FilePath/${filename}`;
  }

  // Wikimedia Commons: commons.wikimedia.org/wiki/File:Name.jpg
  const commonsMatch = url.match(
    /commons\.wikimedia\.org\/wiki\/File:(.+)$/
  );
  if (commonsMatch) {
    const [, filename] = commonsMatch;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}`;
  }

  return url;
}

/**
 * Load an image from a URL with three fallback strategies:
 * 1. CORS fetch → blob → dataURL
 * 2. <img crossOrigin='anonymous'> → canvas → dataURL
 * 3. <img> without crossOrigin → canvas → dataURL (may taint canvas)
 */
export function loadImageFromUrl(
  rawUrl: string,
  onSuccess: (dataUrl: string) => void
): void {
  const url = normalizeImageUrl(rawUrl);

  // Attempt 1: CORS fetch
  fetch(url)
    .then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.blob();
    })
    .then((blob) => {
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const reader = new FileReader();
      reader.onload = (e) => onSuccess(e.target?.result as string);
      reader.readAsDataURL(blob);
    })
    .catch(() => {
      // Attempt 2: <img> with crossOrigin
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          onSuccess(c.toDataURL());
        } catch {
          // crossOrigin was set but server didn't cooperate — tainted canvas
          attemptWithoutCors();
        }
      };
      img.onerror = () => attemptWithoutCors();
      img.src = url;

      // Attempt 3: <img> without crossOrigin (regular browser request)
      function attemptWithoutCors() {
        const img2 = new Image();
        img2.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img2.naturalWidth;
            c.height = img2.naturalHeight;
            c.getContext('2d')!.drawImage(img2, 0, 0);
            onSuccess(c.toDataURL());
          } catch {
            alert(
              'This server blocks cross-origin image access.\n\n' +
                "Tip: Right-click the image \u2192 'Save image as\u2026', " +
                'then drag the saved file into the canvas.'
            );
          }
        };
        img2.onerror = () =>
          alert(
            'Could not load the image.\n\n' +
              "Tip: Right-click the image \u2192 'Copy image' " +
              "(not 'Copy image address'), then paste here with Ctrl+V."
          );
        img2.src = url;
      }
    });
}
