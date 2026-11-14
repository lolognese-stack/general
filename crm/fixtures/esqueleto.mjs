// Esqueleto de un HTML: cada etiqueta con su class/id, sin textos ni urls (para comparar estructura).
export function esqueleto(h) {
  const limpio = h.replace(/<script[\s\S]*?<\/script>/g, '<script></script>').replace(/<style[\s\S]*?<\/style>/g, '<style></style>');
  return [...limpio.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].map((m) => {
    const cls = (m[2].match(/\bclass="([^"]*)"/) || [])[1];
    const id = (m[2].match(/\bid="([^"]*)"/) || [])[1];
    return `${m[1].toLowerCase()}${id ? '#' + id : ''}${cls ? '.' + cls.trim().split(/\s+/).sort().join('.') : ''}`;
  });
}

