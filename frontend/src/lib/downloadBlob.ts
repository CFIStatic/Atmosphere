/** Trigger a file download from an in-memory Blob without opening a new tab. */
export function downloadBlob(filename: string, blob: Blob) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 5000);
}
