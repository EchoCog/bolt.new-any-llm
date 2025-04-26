import { WebContainer } from '@webcontainer/api';
import { createScopedLogger } from '../../utils/logger';
import { PROJECT_TEMPLATES, type ProjectTemplate } from '../../utils/projectCommands';

const logger = createScopedLogger('WebContainer:init-fs');

/**
 * Initialize the WebContainer file system with sample files
 */
export async function initializeFileSystem(instance: WebContainer) {
  logger.info('Initializing file system');
  const isDevMode = import.meta.env.DEV === true;

  try {
    // Ensure workdir exists
    await instance.fs.mkdir('/workdir', { recursive: true }).catch(err => {
      // Directory might already exist in dev mode due to HMR
      if (!isDevMode || !err.toString().includes('already exists')) {
        throw err;
      }
    });

    // In development mode, carefully handle file operations to avoid conflicts
    if (isDevMode) {
      try {
        // Check if we already have files from a previous initialization
        const files = await instance.fs.readdir('/workdir').catch(() => []);
        if (files && files.length > 0) {
          logger.info('Files already exist in workdir, preserving existing file system in dev mode');

          // Create a simple marker file to verify file system is responsive
          await instance.fs.writeFile('/workdir/.dev-mode-initialized', new Date().toISOString());

          return; // Skip initialization to preserve existing files
        }
      } catch (err) {
        logger.warn('Error checking for existing files in dev mode:', err);
        // Continue with initialization
      }
    }

    // Create initial files from a template
    await createInitialFiles(instance);

    logger.info('File system initialization completed successfully');
  } catch (error) {
    logger.error('Failed to initialize file system:', error);
    throw error;
  }
}

async function createInitialFiles(instance: WebContainer) {
  try {
    // Use the Python template as the default starter project
    const template = PROJECT_TEMPLATES.find(t => t.id === 'python') || PROJECT_TEMPLATES[0];

    if (!template) {
      throw new Error('No project templates available');
    }

    logger.info(`Creating initial files using template: ${template.id}`);
    await installProjectTemplate(instance, template);
  } catch (error) {
    logger.error('Failed to create initial files:', error);
    throw error;
  }
}

async function installProjectTemplate(instance: WebContainer, template: ProjectTemplate) {
  try {
    for (const [path, content] of Object.entries(template.files)) {
      const fullPath = `/workdir/${path}`;

      // Ensure parent directory exists
      const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dirPath.length > 0) {
        await instance.fs.mkdir(dirPath, { recursive: true });
      }

      // Write file with content
      await instance.fs.writeFile(fullPath, content);
    }

    logger.info(`Successfully installed project template: ${template.id}`);
  } catch (error) {
    logger.error(`Failed to install project template ${template.id}:`, error);
    throw error;
  }
}
