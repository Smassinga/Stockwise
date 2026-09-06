export const DOCUMENT_LOGO_PRINT_SIZE_PX = 68
export const REPORT_PDF_LOGO_SIZE_MM = 18

type DocumentLogoFrame = {
  x: number
  y: number
  width: number
  height: number
}

export function fitDocumentLogo(
  sourceWidth: number,
  sourceHeight: number,
  frame: DocumentLogoFrame,
): DocumentLogoFrame {
  const safeWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : frame.width
  const safeHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : frame.height
  const scale = Math.min(frame.width / safeWidth, frame.height / safeHeight)
  const width = safeWidth * scale
  const height = safeHeight * scale

  return {
    x: frame.x + ((frame.width - width) / 2),
    y: frame.y + ((frame.height - height) / 2),
    width,
    height,
  }
}
