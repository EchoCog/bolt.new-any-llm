// WebContainer context shared across the application
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('WebContainerContext');

export interface WebContainerContext {
  loaded: boolean;
  fileSystemReady: boolean;
  fallbackEnabled: boolean;
  initializing: boolean;
  error?: string;
  devMode: boolean;
  devModeRefreshCount: number;
  lastDevModeRefresh?: number;
}

// Detect development mode
const isDevMode = () => {
  try {
    // First try the Vite import.meta.env
    if (typeof import.meta !== 'undefined' &&
        typeof import.meta.env !== 'undefined' &&
        import.meta.env.DEV === true) {
      return true;
    }

    // Check for common dev server hostnames
    const hostname = window.location.hostname;
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.includes('gitpod.io') ||
        hostname.endsWith('.ws-dev.ai') ||
        hostname.includes('stackblitz')) {
      return true;
    }

    // Check for dev server ports
    const port = window.location.port;
    if (['3000', '5173', '8080', '4173'].includes(port)) {
      return true;
    }

    return false;
  } catch (e) {
    // If there's an error, assume we're not in dev mode
    return false;
  }
};

// Initialize context with dev mode detection
export const webcontainerContext: WebContainerContext = {
  loaded: false,
  fileSystemReady: false,
  fallbackEnabled: false,
  initializing: false,
  devMode: isDevMode(),
  devModeRefreshCount: 0
};

if (webcontainerContext.devMode) {
  logger.info('WebContainer context initialized in development mode');
}

/**
 * Triggers a development mode refresh of the WebContainer context
 * This helps ensure file system events are properly handled after HMR
 */
export function triggerDevModeRefresh() {
  if (!webcontainerContext.devMode) return;

  webcontainerContext.devModeRefreshCount++;
  webcontainerContext.lastDevModeRefresh = Date.now();
  logger.info(`Development mode refresh triggered (#${webcontainerContext.devModeRefreshCount})`);
}
