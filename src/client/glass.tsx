import { useEffect, useId, useRef } from 'react'

const bevel = 9
const displacement = 12

function lensTexture(width: number, height: number, corner: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width / 2)
  canvas.height = Math.ceil(height / 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(canvas.width, canvas.height)
  const radius = Math.min(corner, width / 2, height / 2)
  for (let y = 0; y < canvas.height; y++) {
    const dy = (y + .5) * height / canvas.height - height / 2
    const edgeY = Math.abs(dy) - height / 2 + radius
    for (let x = 0; x < canvas.width; x++) {
      const dx = (x + .5) * width / canvas.width - width / 2
      const edgeX = Math.abs(dx) - width / 2 + radius
      const roundX = Math.max(edgeX, 0), roundY = Math.max(edgeY, 0)
      const distance = Math.hypot(roundX, roundY)
      const depth = radius - distance - Math.min(0, Math.max(edgeX, edgeY))
      const bend = depth > 0 && depth < bevel ? 64 * Math.sin(Math.PI * depth / bevel) : 0
      const normalX = distance ? roundX / distance : Number(edgeX >= edgeY)
      const normalY = distance ? roundY / distance : Number(edgeY > edgeX)
      const i = (y * canvas.width + x) * 4
      // Red and green shift sampling inward along the bevel. The center is neutral.
      image.data[i] = 128 - Math.sign(dx) * normalX * bend
      image.data[i + 1] = 128 - Math.sign(dy) * normalY * bend
      image.data[i + 2] = 128
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

export function useGlassRefraction() {
  const ref = useRef<HTMLDivElement>(null)
  const texture = useRef<SVGFEImageElement>(null)
  const id = 'dd-lens-' + useId().replaceAll(':', '')
  const filter = `url("#${id}")`
  useEffect(() => {
    const surface = ref.current, image = texture.current
    if (!surface || !image || !CSS.supports('backdrop-filter', filter)) return
    let previous = ''
    const observer = new ResizeObserver(() => {
      const { width, height } = surface.getBoundingClientRect()
      if (width < 1 || height < 1) return
      const corner = parseFloat(getComputedStyle(surface).borderTopLeftRadius)
      const key = `${Math.round(width)}:${Math.round(height)}:${corner}`
      if (previous === key) return
      const url = lensTexture(width, height, corner)
      if (!url) return
      previous = key
      image.setAttribute('width', String(width))
      image.setAttribute('height', String(height))
      image.setAttribute('href', url)
      surface.style.setProperty('--dd-glass-refraction', filter)
    })
    observer.observe(surface, { box: 'border-box' })
    return () => { observer.disconnect(); surface.style.removeProperty('--dd-glass-refraction') }
  }, [filter])
  return { ref, optics: <svg className="dd-glass-optics" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage ref={texture} x="0" y="0" preserveAspectRatio="none" result="bevel" />
      <feDisplacementMap in="SourceGraphic" in2="bevel" scale={displacement} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </defs></svg> }
}
