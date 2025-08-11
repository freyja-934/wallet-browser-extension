const fs = require('fs');
const path = require('path');

// Simple function to create a basic PNG with size text
function createIcon(size) {
  // This is a placeholder - in production you'd use a proper image library
  // For now, we'll create a simple 1x1 transparent PNG
  const buffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, size/256, 0x00, 0x00, 0x00, size%256, // width, height
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, etc
    0x00, 0x00, 0x00, 0x00, // CRC placeholder
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82 // IEND chunk
  ]);
  
  const iconPath = path.join(__dirname, 'public', 'icons', `icon-${size}.png`);
  fs.writeFileSync(iconPath, buffer);
  console.log(`Created ${iconPath}`);
}

// Create icons
[16, 32, 48, 128].forEach(size => createIcon(size));
