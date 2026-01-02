// main.js
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exiftool } = require('exiftool-vendored');
const ExifReader = require('exifreader');

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
              detail: 'A powerful desktop app to view detailed image metadata.\n\nVersion 1.0.0\nBuilt with Electron'
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
    // Primary: ExifTool
    const tagsPrimary = await exiftool.read(filePath);

    // Get file size from fs (always accurate)
    const stats = fs.statSync(filePath);
    const fileSizeBytes = stats.size;
    const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2) + ' MB';

    // Extract useful from primary
    let useful = {
      file: {
        'File Name': path.basename(filePath),
        'File Size': fileSizeMB,
        'File Type': tagsPrimary.FileType || tagsPrimary.MIMEType || 'Unknown',
      },
      datetime: {
        'Date Taken': tagsPrimary.DateTimeOriginal || tagsPrimary.CreateDate || 'Not found',
        'Time Zone': tagsPrimary.TimeZone || tagsPrimary.OffsetTimeOriginal || 'Unknown',
        'Modified Date': tagsPrimary.ModifyDate || 'Not found',
      },
      location: {
        'GPS Latitude': tagsPrimary.GPSLatitudeRef && tagsPrimary.GPSLatitude ? 
          `${tagsPrimary.GPSLatitudeRef} ${tagsPrimary.GPSLatitude}` : 'Not found',
        'GPS Longitude': tagsPrimary.GPSLongitudeRef && tagsPrimary.GPSLongitude ? 
          `${tagsPrimary.GPSLongitudeRef} ${tagsPrimary.GPSLongitude}` : 'Not found',
        'Altitude': tagsPrimary.GPSAltitude || 'Not found',
        'Location': [tagsPrimary.City, tagsPrimary.State, tagsPrimary.Country]
          .filter(Boolean).join(', ') || 'Not found',
      },
      camera: {
        'Camera Make': tagsPrimary.Make?.trim() || 'Not found',
        'Camera Model': tagsPrimary.Model?.trim() || 'Not found',
        'Lens': tagsPrimary.LensModel || tagsPrimary.Lens || 'Not found',
        'Focal Length': tagsPrimary.FocalLength || 'Not found',
        'Aperture': tagsPrimary.FNumber || tagsPrimary.ApertureValue || 'Not found',
        'Shutter Speed': tagsPrimary.ExposureTime || 'Not found',
        'ISO': tagsPrimary.ISO || 'Not found',
      },
      author: {
        'Artist/Author': tagsPrimary.Artist || tagsPrimary.Creator || 'Not found',
        'Copyright': tagsPrimary.Copyright || 'Not found',
        'Software': tagsPrimary.Software || 'Not found',
      }
    };

    // Check for any 'Not found' or empty fields
    const hasMissing = Object.values(useful).some(section => 
      Object.values(section).some(value => value === 'Not found' || value === 'Unknown' || !value)
    );

    if (hasMissing) {
      // Fallback: ExifReader
      const buffer = fs.readFileSync(filePath);
      const tagsFallback = ExifReader.load(buffer);

      // Merge/override missing fields
      useful.datetime['Date Taken'] = useful.datetime['Date Taken'] !== 'Not found' ? useful.datetime['Date Taken'] :
        (tagsFallback.DateTimeOriginal?.description || tagsFallback.CreateDate?.description || 'Not found');
      useful.datetime['Time Zone'] = useful.datetime['Time Zone'] !== 'Unknown' ? useful.datetime['Time Zone'] :
        (tagsFallback.TimeZone?.description || tagsFallback.OffsetTimeOriginal?.description || 'Unknown');
      useful.datetime['Modified Date'] = useful.datetime['Modified Date'] !== 'Not found' ? useful.datetime['Modified Date'] :
        (tagsFallback.ModifyDate?.description || 'Not found');

      useful.location['GPS Latitude'] = useful.location['GPS Latitude'] !== 'Not found' ? useful.location['GPS Latitude'] :
        (tagsFallback.GPSLatitudeRef?.description && tagsFallback.GPSLatitude?.description ? 
          `${tagsFallback.GPSLatitudeRef.description} ${tagsFallback.GPSLatitude.description}` : 'Not found');
      useful.location['GPS Longitude'] = useful.location['GPS Longitude'] !== 'Not found' ? useful.location['GPS Longitude'] :
        (tagsFallback.GPSLongitudeRef?.description && tagsFallback.GPSLongitude?.description ? 
          `${tagsFallback.GPSLongitudeRef.description} ${tagsFallback.GPSLongitude.description}` : 'Not found');
      useful.location['Altitude'] = useful.location['Altitude'] !== 'Not found' ? useful.location['Altitude'] :
        (tagsFallback.GPSAltitude?.description || 'Not found');
      useful.location['Location'] = useful.location['Location'] !== 'Not found' ? useful.location['Location'] :
        ([tagsFallback.City?.description, tagsFallback.State?.description, tagsFallback.Country?.description]
          .filter(Boolean).join(', ') || 'Not found');

      useful.camera['Camera Make'] = useful.camera['Camera Make'] !== 'Not found' ? useful.camera['Camera Make'] :
        (tagsFallback.Make?.description?.trim() || 'Not found');
      useful.camera['Camera Model'] = useful.camera['Camera Model'] !== 'Not found' ? useful.camera['Camera Model'] :
        (tagsFallback.Model?.description?.trim() || 'Not found');
      useful.camera['Lens'] = useful.camera['Lens'] !== 'Not found' ? useful.camera['Lens'] :
        (tagsFallback.LensModel?.description || tagsFallback.Lens?.description || 'Not found');
      useful.camera['Focal Length'] = useful.camera['Focal Length'] !== 'Not found' ? useful.camera['Focal Length'] :
        (tagsFallback.FocalLength?.description || 'Not found');
      useful.camera['Aperture'] = useful.camera['Aperture'] !== 'Not found' ? useful.camera['Aperture'] :
        (tagsFallback.FNumber?.description || tagsFallback.ApertureValue?.description || 'Not found');
      useful.camera['Shutter Speed'] = useful.camera['Shutter Speed'] !== 'Not found' ? useful.camera['Shutter Speed'] :
        (tagsFallback.ExposureTime?.description || 'Not found');
      useful.camera['ISO'] = useful.camera['ISO'] !== 'Not found' ? useful.camera['ISO'] :
        (tagsFallback.ISO?.description || 'Not found');

      useful.author['Artist/Author'] = useful.author['Artist/Author'] !== 'Not found' ? useful.author['Artist/Author'] :
        (tagsFallback.Artist?.description || tagsFallback.Creator?.description || 'Not found');
      useful.author['Copyright'] = useful.author['Copyright'] !== 'Not found' ? useful.author['Copyright'] :
        (tagsFallback.Copyright?.description || 'Not found');
      useful.author['Software'] = useful.author['Software'] !== 'Not found' ? useful.author['Software'] :
        (tagsFallback.Software?.description || 'Not found');
    }

    return { success: true, metadata: useful };
  } catch (err) {
    console.error('Metadata extraction error:', err);
    return { success: false, error: err.message || 'Failed to read metadata' };
  }
});