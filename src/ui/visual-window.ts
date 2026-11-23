/**
 * The visualization window: the same skinned frame as the video window (its title piece covered, since it says
 * "video"), with the visualization canvas laid over the picture area. The info line shows the preset name.
 */
import { FrameWindow, type FrameButton } from './frame-window';

export class VisualWindow extends FrameWindow {
  readonly id = 'visual' as const;
  protected readonly menuKind = 'visual' as const;
  protected override readonly coverTitle = true;

  size() {
    return { ...this.ui.state.visualSize };
  }

  protected applySize(w: number, h: number): void {
    this.ui.setVisualSize(w, h);
  }

  protected buttonDefs(): FrameButton[] {
    const ui = this.ui;
    return [
      {
        id: 'mFull',
        tip: 'Fullscreen (F or Ctrl+F; Esc to leave)',
        run: () => ui.visualCommand('fullscreen'),
      },
      { id: 'mZoom1', tip: 'Normal size', run: () => ui.visualCommand('zoom1') },
      { id: 'mZoom2', tip: 'Double size', run: () => ui.visualCommand('zoom2') },
      { id: 'mNext', tip: 'Next preset', run: () => ui.visualCommand('next') },
      { id: 'mMenu', tip: 'Visualization menu', run: 'menu' },
    ];
  }

  protected toggleFullscreen(): void {
    this.ui.visualCommand('fullscreen');
  }

  protected infoLine(): string {
    return this.ui.state.visualTitle;
  }

  protected live(): boolean {
    return true;
  }
}
