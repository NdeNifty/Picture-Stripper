// main.js
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { exiftool } = require('exiftool-vendored');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f172a',
    title: 'Photo Forensics Tool',
  });

  mainWindow.loadFile('index.html');

  // Custom Menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-open-file')
        },
        { type: 'separator' },
        {
          label: 'Clear',
          click: () => mainWindow.webContents.send('menu-clear')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Photo Forensics Tool',
          click: async () => {
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Photo Forensics Tool',
              detail: 'A powerful desktop app to view detailed image metadata using ExifTool.\n\nVersion 1.0.0\nBuilt with Electron'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Electron Documentation',
          click: () => shell.openExternal('https://www.electronjs.org/docs')
        },
        {
          label: 'ExifTool Documentation',
          click: () => shell.openExternal('https://exiftool.org/')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    exiftool.end();
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'heic', 'webp', 'gif'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('extract-metadata', async (event, filePath) => {
  try {
    const tags = await exiftool.read(filePath);
    const data = tags.toJSON ? tags.toJSON() : tags;

    // Get actual file size from filesystem (in bytes)
    const stats = fs.statSync(filePath);
    const fileSizeBytes = stats.size;
    const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2) + ' MB';

    const useful = {
      file: {
        'File Name': path.basename(filePath),
        'File Size': fileSizeMB,
        'File Type': tags.FileType || tags.MIMEType || 'Unknown',
      },
      datetime: {
        'Date Taken': tags.DateTimeOriginal || tags.CreateDate || 'Not found',
        'Time Zone': tags.TimeZone || tags.OffsetTimeOriginal || 'Unknown',
        'Modified Date': tags.ModifyDate || 'Not found',
      },
      location: {
        'GPS Latitude': tags.GPSLatitudeRef && tags.GPSLatitude ? 
          `${tags.GPSLatitudeRef} ${tags.GPSLatitude}` : 'Not found',
        'GPS Longitude': tags.GPSLongitudeRef && tags.GPSLongitude ? 
          `${tags.GPSLongitudeRef} ${tags.GPSLongitude}` : 'Not found',
        'Altitude': tags.GPSAltitude || 'Not found',
        'Location': [tags.City, tags.State, tags.Country]
          .filter(Boolean).join(', ') || 'Not found',
      },
      camera: {
        'Camera Make': tags.Make?.trim() || 'Not found',
        'Camera Model': tags.Model?.trim() || 'Not found',
        'Lens': tags.LensModel || tags.Lens || 'Not found',
        'Focal Length': tags.FocalLength || 'Not found',
        'Aperture': tags.FNumber || tags.ApertureValue || 'Not found',
        'Shutter Speed': tags.ExposureTime || 'Not found',
        'ISO': tags.ISO || 'Not found',
      },
      author: {
        'Artist/Author': tags.Artist || tags.Creator || 'Not found',
        'Copyright': tags.Copyright || 'Not found',
        'Software': tags.Software || 'Not found',
      }
    };

    return { success: true, metadata: useful };
  } catch (err) {
    console.error('Exiftool error:', err);
    return { success: false, error: err.message || 'Failed to read metadata' };
  }
});