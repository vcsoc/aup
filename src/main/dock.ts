interface DockVisibility {
  hide(): void;
  show(): Promise<void>;
}

/** A working tray is the entry point; restore the Dock if it is unavailable. */
export async function configureDock(dock: DockVisibility | undefined, hasTray: boolean, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'darwin' || !dock) return;
  if (hasTray) dock.hide();
  else await dock.show();
}
