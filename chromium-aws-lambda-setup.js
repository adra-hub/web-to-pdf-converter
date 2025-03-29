// Create this file in your project root

const path = require('path');
const fs = require('fs');

// Try to explicitly set the library path for Chrome
process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH 
  ? `${process.env.LD_LIBRARY_PATH}:/tmp:/tmp/lib:/var/task/node_modules/puppeteer-core/.local-chromium/linux-puppeteer-core/chrome-linux/lib`
  : `/tmp:/tmp/lib:/var/task/node_modules/puppeteer-core/.local-chromium/linux-puppeteer-core/chrome-linux/lib`;

// Check if the necessary libraries exist in various locations
const checkLibraries = () => {
  const locations = [
    '/tmp',
    '/tmp/lib',
    '/var/task/node_modules',
    '/var/task/node_modules/puppeteer-core/.local-chromium',
    process.cwd(),
    path.join(process.cwd(), '.vercel', 'output', 'functions')
  ];
  
  console.log('Checking for Chrome libraries...');
  
  locations.forEach(location => {
    try {
      if (fs.existsSync(location)) {
        console.log(`Directory exists: ${location}`);
        const files = fs.readdirSync(location);
        console.log(`Files in ${location}: ${files.join(', ')}`);
        
        if (files.some(file => file.includes('libnss3'))) {
          console.log(`Found libnss3 in ${location}`);
        }
      } else {
        console.log(`Directory does not exist: ${location}`);
      }
    } catch (error) {
      console.log(`Error checking ${location}: ${error.message}`);
    }
  });
};

// Export a function to be used in generate-pdf.js
module.exports = {
  setupChromePath: () => {
    checkLibraries();
    
    // Return path settings to be used with Puppeteer
    return {
      executablePath: process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        `--js-flags=--max-old-space-size=512`,
        '--disable-gpu',
        '--no-zygote',
        '--font-render-hinting=none'
      ]
    };
  }
};
