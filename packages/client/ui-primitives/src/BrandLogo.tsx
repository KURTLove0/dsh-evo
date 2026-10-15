/** Shared KL Agent Console artwork served by the web application. */
import type { IconProps } from './icons/props.ts'

/**
 * Render the square application logo as decorative artwork.
 * @param props.size - Width and height in pixels, defaulting to 24.
 * @param props.className - Extra class for layout placement.
 * @returns The logo image; its host supplies the accessible label.
 */
export function BrandLogo({ size = 24, className }: IconProps) {
  return <img src="/icon.png" width={size} height={size} className={className} alt="" aria-hidden="true" />
}
