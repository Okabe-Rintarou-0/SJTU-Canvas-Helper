import { useEffect, useRef, type ReactNode } from "react"
import type { SxProps, Theme } from "@mui/material"
import { Box } from "@mui/material"

interface Props {
  children: ReactNode
  delay?: number
  sx?: SxProps<Theme>
}

export default function ScrollReveal({ children, delay = 0, sx }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => el.classList.add("revealed"), delay)
          observer.unobserve(el)
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [delay])

  return (
    <Box ref={ref} className="scroll-reveal" sx={sx}>
      {children}
    </Box>
  )
}
