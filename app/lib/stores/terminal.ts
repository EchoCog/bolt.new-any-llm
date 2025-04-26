import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newBoltShellProcess, newShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('TerminalStore');

export class TerminalStore {
  #webcontainer: Promise<WebContainer>;
  #terminals: Array<{ terminal: ITerminal; process: WebContainerProcess }> = [];
  #boltTerminal = newBoltShellProcess();
  #terminalAttachInProgress = false;
  #terminalAttachRetries = 0;
  #maxAttachRetries = 3;

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  get boltTerminal() {
    return this.#boltTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachBoltTerminal(terminal: ITerminal) {
    if (this.#terminalAttachInProgress) {
      logger.warn('Terminal attachment already in progress, skipping');
      terminal.write(coloredText.yellow('Terminal attachment in progress...\n'));
      return;
    }

    this.#terminalAttachInProgress = true;

    try {
      // Make sure we have cols/rows
      const cols = terminal.cols || 80;
      const rows = terminal.rows || 24;

      logger.info(`Attaching bolt terminal with dimensions: ${cols}x${rows}`);
      terminal.write(coloredText.blue('Initializing terminal...\n'));

      const wc = await Promise.race([
        this.#webcontainer,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for WebContainer')), 10000);
        })
      ]);

      await this.#boltTerminal.init(wc, terminal);
      logger.info('Bolt terminal attached successfully');
      this.#terminalAttachRetries = 0;
    } catch (error: any) {
      logger.error('Failed to spawn bolt shell:', error);

      // If we haven't exceeded retry attempts, try again
      if (this.#terminalAttachRetries < this.#maxAttachRetries) {
        this.#terminalAttachRetries++;
        this.#terminalAttachInProgress = false;

        const retryMessage = `\nRetrying terminal connection (${this.#terminalAttachRetries}/${this.#maxAttachRetries})...\n`;
        terminal.write(coloredText.red('Failed to spawn bolt shell: ') + error.message + coloredText.yellow(retryMessage));

        // Wait a bit before retrying
        setTimeout(() => {
          this.attachBoltTerminal(terminal);
        }, 2000);
        return;
      }

      // If we've exceeded retries, show error and give up
      terminal.write(
        coloredText.red('Failed to spawn bolt shell after multiple attempts\n\n') +
        error.message + '\n\n' +
        coloredText.yellow('Try reloading the page or checking browser console for errors.\n')
      );
    } finally {
      if (this.#terminalAttachRetries === 0) {
        this.#terminalAttachInProgress = false;
      }
    }
  }

  async attachTerminal(terminal: ITerminal) {
    try {
      logger.info('Attaching regular terminal');
      terminal.write(coloredText.blue('Initializing regular terminal...\n'));

      const wc = await Promise.race([
        this.#webcontainer,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for WebContainer')), 10000);
        })
      ]);

      const shellProcess = await newShellProcess(wc, terminal);
      this.#terminals.push({ terminal, process: shellProcess });
      logger.info('Regular terminal attached successfully');
    } catch (error: any) {
      logger.error('Failed to spawn shell:', error);
      terminal.write(
        coloredText.red('Failed to spawn shell\n\n') +
        error.message + '\n\n' +
        coloredText.yellow('Try using the Bolt Terminal instead or reload the page.\n')
      );
    }
  }

  onTerminalResize(cols: number, rows: number) {
    try {
      // Update all regular terminals
      for (const { process } of this.#terminals) {
        try {
          process.resize({ cols, rows });
        } catch (err) {
          logger.warn('Failed to resize terminal process:', err);
        }
      }

      // Also update the bolt terminal if it has a process
      const boltProcess = this.#boltTerminal.process;
      if (boltProcess) {
        try {
          boltProcess.resize({ cols, rows });
        } catch (err) {
          logger.warn('Failed to resize bolt terminal process:', err);
        }
      }
    } catch (err) {
      logger.error('Error in onTerminalResize:', err);
    }
  }
}
