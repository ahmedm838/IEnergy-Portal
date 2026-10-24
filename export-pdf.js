/** Download paginated A4 portrait PDFs. Canvas preserves browser Arabic shaping. */
export async function exportPdf({ title, sections, filename }) {
  await document.fonts.ready
  const width = 1240, height = 1754, margin = 70
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const pages = []
  let y
  function startPage() {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    y = margin
  }
  function finishPage() {
    ctx.font = '18px Arial'
    ctx.fillStyle = '#64748b'
    ctx.fillText(`iEnergy | Page ${pages.length + 1}`, margin, height - 35)
    pages.push(Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.94).split(',')[1]), c => c.charCodeAt(0)))
  }
  function lines(text, maxWidth) {
    const result = []
    for (const paragraph of String(text ?? '').split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue }
        if (line) result.push(line)
        line = ''
        // Even a single long identifier must fit within the printable area.
        for (const char of word) {
          if (ctx.measureText(line + char).width > maxWidth && line) { result.push(line); line = '' }
          line += char
        }
      }
      result.push(line)
    }
    return result
  }
  function text(value, { bold = false, size = 23, indent = 0 } = {}) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Arial`
    const wrapped = lines(value, width - margin * 2 - indent)
    for (const line of wrapped) {
      if (y + size + 12 > height - margin) {
        finishPage(); startPage()
        ctx.font = `${bold ? 'bold ' : ''}${size}px Arial`
      }
      ctx.fillStyle = bold ? '#173652' : '#17212b'
      const rtl = /[\u0600-\u06ff]/.test(line) && !/[a-zA-Z]/.test(line)
      ctx.direction = rtl ? 'rtl' : 'ltr'
      ctx.textAlign = rtl ? 'right' : 'left'
      ctx.fillText(line, rtl ? width - margin : margin + indent, y + size)
      ctx.textAlign = 'left'; ctx.direction = 'ltr'
      y += size + 10
    }
  }
  startPage()
  text(title, { bold: true, size: 32 })
  y += 16
  for (const section of sections) {
    if (y > height - margin - 130) { finishPage(); startPage() }
    text(section.title, { bold: true, size: 26 })
    for (const [label, value] of section.rows) text(`${label}: ${value ?? ''}`, { indent: 12 })
    y += 24
  }
  finishPage()

  // Each image is one fixed portrait A4 page; content is wrapped and paginated
  // before encoding, never cropped from a scrolling viewport.
  const encoder = new TextEncoder()
  const chunks = []
  const offsets = [0]
  let length = 0
  const append = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length }
  const object = (id, content) => { offsets[id] = length; append(`${id} 0 obj\n${content}\nendobj\n`) }
  append('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`)
  pages.forEach((jpeg, i) => {
    const id = 3 + i * 3
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`)
    offsets[id + 1] = length
    append(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    append(jpeg); append('\nendstream\nendobj\n')
    const stream = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q\n'
    object(id + 2, `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`)
  })
  const xref = length
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, '0')} 00000 n \n`))
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
