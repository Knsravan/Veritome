/** A small picture of a PDF's first page, for the file card. */
export async function pdfThumbnail(data: Uint8Array, width = 220): Promise<string | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(data.slice());
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width * 2) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise;
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}
