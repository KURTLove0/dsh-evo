/** Cross-feature navigation into the existing settings panel. */
import { Context, Service } from '@deepseek-ai/cordis'
declare module '@deepseek-ai/cordis' { interface Context { settingsPanel: SettingsPanel } }
/** The settings shell owns section validation and its one pending navigation request. */
export class SettingsPanel extends Service {
  /**
   * Bind navigation to the owning shell's section registry and request store.
   * @param ctx - shell plugin context.
   * @param request - validate a registered section and open the existing panel.
   */
  constructor(ctx: Context, private readonly request: (section: string) => void) { super(ctx, 'settingsPanel') }
  /**
   * Open one registered settings section without creating another settings surface.
   * @param section - current settings.section registration id; unknown ids reject.
   */
  open(section: string): void { this.request(section) }
}
