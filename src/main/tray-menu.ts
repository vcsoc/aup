interface MenuTray<T> {
  setContextMenu(menu: T): void;
  popUpContextMenu(menu: T): void;
  on(event: 'right-click', listener: () => void): unknown;
}

export function configureTrayMenu<T>(tray: MenuTray<T>, menu: T, platform: NodeJS.Platform = process.platform): void {
  // AppKit also opens an attached context menu on left-click. Keep that click
  // exclusively for the panel; explicitly pop the menu only on right-click.
  if (platform === 'darwin') tray.on('right-click', () => tray.popUpContextMenu(menu));
  // Linux StatusNotifier requires an attached menu; Windows opens it on right-click.
  else tray.setContextMenu(menu);
}
