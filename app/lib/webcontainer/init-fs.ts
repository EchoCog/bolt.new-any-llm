import type { WebContainer } from '@webcontainer/api';
import { WORK_DIR } from '~/utils/constants';

/**
 * Initializes the file system with basic files to get started
 */
export async function initializeFileSystem(webcontainerInstance: WebContainer): Promise<void> {
  // Create some sample files to get the file manager started
  const files = {
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Welcome to Bolt.new</h1>
  <p>This is a sample project to help you get started with the file manager.</p>
  <script src="script.js"></script>
</body>
</html>`,
    'style.css': `body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  line-height: 1.6;
}

h1 {
  color: #2563eb;
}`,
    'script.js': `// This is a sample JavaScript file
console.log('Hello from Bolt.new!');

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');
});`,
    'README.md': `# My Project

This is a sample project created in the Bolt.new file manager.

## Getting Started

1. Edit the files in the file manager
2. Ask Bolt.new AI for help with coding tasks
3. Run your project by using the terminal

## File Structure

- \`index.html\` - The main HTML file
- \`style.css\` - CSS styles for the project
- \`script.js\` - JavaScript code
- \`README.md\` - This documentation file
`
  };

  // Create each file in the file system
  for (const [filename, content] of Object.entries(files)) {
    try {
      // Make sure path is correct - files go in the work directory
      const filePath = `${WORK_DIR}/${filename}`;
      await webcontainerInstance.fs.writeFile(filePath, content);
      console.log(`Created: ${filePath}`);
    } catch (error) {
      console.error(`Error writing ${filename}:`, error);
    }
  }

  console.log('File system initialized successfully');
}
