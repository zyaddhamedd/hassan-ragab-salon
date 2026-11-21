export function getFilenameFromContentDisposition(headerValue?: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const utfMatch = headerValue.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      return utfMatch[1].trim();
    }
  }

  const basicMatch = headerValue.match(/filename\s*=\s*"([^"]+)"/i) || headerValue.match(/filename\s*=\s*([^;]+)/i);
  return basicMatch?.[1]?.trim() || null;
}


export function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}
