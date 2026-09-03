// Source: https://reactbits.dev/components/spotlight-card  (MIT)
import { useRef } from 'react'

export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(31, 58, 95, 0.12)',
}) {
  const divRef = useRef(null)

  const handleMouseMove = e => {
    const rect = divRef.current.getBoundingClientRect()
    divRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    divRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
    divRef.current.style.setProperty('--spotlight-color', spotlightColor)
  }

  return (
    <div ref={divRef} onMouseMove={handleMouseMove} className={`rb-spotlight ${className}`}>
      {children}
    </div>
  )
}
