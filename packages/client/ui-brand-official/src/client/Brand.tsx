import { BrandLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the application logo.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <BrandLogo size={size} className={className} />
}

/**
 * Render the application name without its independently slotted mark.
 * @returns the application name.
 */
export function OfficialBrandName() {
  return <span>KL Agent Console</span>
}
