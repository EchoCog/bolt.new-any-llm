const reset = '\x1b[0m';

/**
 * ANSI escape codes for various terminal formatting options
 */
export const escapeCodes = {
  // Formatting
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright foreground colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',

  // Terminal control
  clear: '\x1b[2J',
  clearLine: '\x1b[2K',
  clearToEndOfLine: '\x1b[K',
  cursorUp: '\x1b[1A',
  cursorDown: '\x1b[1B',
  cursorForward: '\x1b[1C',
  cursorBackward: '\x1b[1D',
  cursorHome: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  saveCursorPosition: '\x1b[s',
  restoreCursorPosition: '\x1b[u',
};

/**
 * Helper functions to create colored and formatted text
 */
export const coloredText = {
  // Basic colors with bold
  red: (text: string) => `${escapeCodes.red}${text}${reset}`,
  green: (text: string) => `${escapeCodes.green}${text}${reset}`,
  yellow: (text: string) => `${escapeCodes.yellow}${text}${reset}`,
  blue: (text: string) => `${escapeCodes.blue}${text}${reset}`,
  magenta: (text: string) => `${escapeCodes.magenta}${text}${reset}`,
  cyan: (text: string) => `${escapeCodes.cyan}${text}${reset}`,
  white: (text: string) => `${escapeCodes.white}${text}${reset}`,

  // Bright colors
  brightRed: (text: string) => `${escapeCodes.brightRed}${text}${reset}`,
  brightGreen: (text: string) => `${escapeCodes.brightGreen}${text}${reset}`,
  brightYellow: (text: string) => `${escapeCodes.brightYellow}${text}${reset}`,
  brightBlue: (text: string) => `${escapeCodes.brightBlue}${text}${reset}`,
  brightMagenta: (text: string) => `${escapeCodes.brightMagenta}${text}${reset}`,
  brightCyan: (text: string) => `${escapeCodes.brightCyan}${text}${reset}`,
  brightWhite: (text: string) => `${escapeCodes.brightWhite}${text}${reset}`,

  // Formatting
  bold: (text: string) => `${escapeCodes.bold}${text}${reset}`,
  dim: (text: string) => `${escapeCodes.dim}${text}${reset}`,
  italic: (text: string) => `${escapeCodes.italic}${text}${reset}`,
  underline: (text: string) => `${escapeCodes.underline}${text}${reset}`,

  // Combined formatting
  boldRed: (text: string) => `${escapeCodes.bold}${escapeCodes.red}${text}${reset}`,
  boldGreen: (text: string) => `${escapeCodes.bold}${escapeCodes.green}${text}${reset}`,
  boldYellow: (text: string) => `${escapeCodes.bold}${escapeCodes.yellow}${text}${reset}`,
  boldBlue: (text: string) => `${escapeCodes.bold}${escapeCodes.blue}${text}${reset}`,

  // Status indicators
  success: (text: string) => `${escapeCodes.green}✓ ${text}${reset}`,
  error: (text: string) => `${escapeCodes.red}✗ ${text}${reset}`,
  warning: (text: string) => `${escapeCodes.yellow}⚠ ${text}${reset}`,
  info: (text: string) => `${escapeCodes.blue}ℹ ${text}${reset}`,

  // Utility for custom combinations
  custom: (text: string, ...codes: string[]) => {
    const prefix = codes.join('');
    return `${prefix}${text}${reset}`;
  }
};

/**
 * Generate a progress bar for terminal display
 * @param percent Percentage completed (0-100)
 * @param width Width of the progress bar in characters
 * @returns Formatted progress bar string
 */
export function progressBar(percent: number, width = 20): string {
  const completed = Math.floor(width * (percent / 100));
  const remaining = width - completed;

  const bar = '█'.repeat(completed) + '░'.repeat(remaining);
  return `${bar} ${Math.floor(percent)}%`;
}

/**
 * Format a string to have a fixed width in the terminal
 * @param text The text to format
 * @param width The desired width
 * @param align Alignment ('left', 'right', 'center')
 * @returns Formatted string with the specified width
 */
export function padText(text: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  if (text.length >= width) return text;

  const padding = ' '.repeat(width - text.length);

  switch (align) {
    case 'right':
      return padding + text;
    case 'center': {
      const half = Math.floor(padding.length / 2);
      return ' '.repeat(half) + text + ' '.repeat(padding.length - half);
    }
    default:
      return text + padding;
  }
}

/**
 * Create a formatted table for terminal output
 * @param headers Table headers
 * @param rows Table data rows
 * @param options Formatting options
 * @returns Formatted table string
 */
export function createTable(
  headers: string[],
  rows: string[][],
  options: {
    headerColor?: keyof typeof coloredText;
    borderColor?: keyof typeof coloredText;
    padding?: number;
  } = {}
): string {
  const {
    headerColor = 'bold',
    borderColor = 'dim',
    padding = 1
  } = options;

  // Calculate column widths
  const widths = headers.map((header, i) => {
    const maxDataWidth = rows.reduce((max, row) =>
      Math.max(max, (row[i] || '').length), 0);
    return Math.max(header.length, maxDataWidth) + padding * 2;
  });

  // Create border line
  const borderLine = coloredText[borderColor]('┌' +
    widths.map(w => '─'.repeat(w)).join('┬') + '┐');

  const headerLine = coloredText[borderColor]('│') +
    headers.map((header, i) =>
      coloredText[headerColor](padText(header, widths[i])))
      .join(coloredText[borderColor]('│')) +
    coloredText[borderColor]('│');

  const separator = coloredText[borderColor]('├' +
    widths.map(w => '─'.repeat(w)).join('┼') + '┤');

  const dataRows = rows.map(row =>
    coloredText[borderColor]('│') +
    row.map((cell, i) => padText(cell || '', widths[i]))
      .join(coloredText[borderColor]('│')) +
    coloredText[borderColor]('│')
  );

  const bottomLine = coloredText[borderColor]('└' +
    widths.map(w => '─'.repeat(w)).join('┴') + '┘');

  return [
    borderLine,
    headerLine,
    separator,
    ...dataRows,
    bottomLine
  ].join('\n');
}

/**
 * Format elapsed time in a human-readable format
 * @param ms Time in milliseconds
 * @returns Formatted time string
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
