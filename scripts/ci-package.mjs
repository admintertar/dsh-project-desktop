if (process.env.PACKAGE_FAMILY === 'mac') await import('./package-macos.mjs');
else if (process.env.PACKAGE_FAMILY === 'win') await import('./package-windows.mjs');
else throw new Error('Unknown package family');
