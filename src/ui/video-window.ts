/**
 * The resizable video window: a skinned frame (video.bmp layout) around the picture. The picture itself is a
 * <video> element the host lays over `pictureRect`; the frame draws the buttons and an info line.
 */
import { formatTime } from '../playlist/model';
import { FrameWindow, type FrameButton } from './frame-window';

export class VideoWindow extends FrameWindow {
  readonly id = 'video' as const;
  protected readonly menuKind = 'video' as const;

  size() {
    return { ...this.ui.state.videoSize };
  }

  protected applySize(w: number, h: number): void {
    this.ui.setVideoSize(w, h);
  }

  protected buttonDefs(): FrameButton[] {
    const ui = this.ui;
    return [
      {
        id: 'vFull',
        tip: 'Fullscreen (F or Ctrl+F; Esc to leave)',
        run: () => ui.videoCommand('fullscreen'),
      },
      { id: 'vZoom1', tip: 'Original size (100%)', run: () => ui.videoCommand('zoom1') },
      { id: 'vZoom2', tip: 'Double size (200%)', run: () => ui.videoCommand('zoom2') },
      { id: 'vStretch', tip: 'Stretch to fill / keep aspect', run: () => ui.videoCommand('stretch') },
      { id: 'vMenu', tip: 'Video menu', run: 'menu' },
    ];
  }

  protected toggleFullscreen(): void {
    this.ui.videoCommand('fullscreen');
  }

  protected infoLine(): string {
    const st = this.ui.state;
    const time = st.duration ? `${formatTime(st.position)}/${formatTime(st.duration)}` : '';
    return `${st.title}${time ? `  ${time}` : ''}`;
  }

  protected live(): boolean {
    return this.ui.state.playState !== 'stopped';
  }
}
