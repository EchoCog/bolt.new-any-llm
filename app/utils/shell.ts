import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';
import { atom } from 'nanostores';
import { createScopedLogger } from './logger';

const logger = createScopedLogger('Shell');

/**
 * Helper function to safely get error message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === 'string') {
    return error;
  } else {
    return 'Unknown error';
  }
}

export async function newShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
  const args: string[] = [];

  try {
    terminal.write('\r\nInitializing shell process...\r\n');

    // we spawn a JSH process with a fallback cols and rows in case the process is not attached yet to a visible terminal
    const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    if (!process || !process.input) {
      throw new Error('Failed to create process or process input stream');
    }

    let input;
    try {
      input = process.input.getWriter();
    } catch (writerErr) {
      logger.error('Failed to get writer for process input:', writerErr);
      throw new Error(`Failed to get writer for process: ${getErrorMessage(writerErr)}`);
    }

    if (!process.output) {
      throw new Error('Process output stream is not available');
    }
    const output = process.output;

    const jshReady = withResolvers<void>();
    let isInteractive = false;

    try {
      output.pipeTo(
        new WritableStream({
          write(data) {
            if (!isInteractive) {
              const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

              if (osc === 'interactive') {
                // wait until we see the interactive OSC
                isInteractive = true;
                jshReady.resolve();
              }
            }

            terminal.write(data);
          },
          close() {
            logger.debug('Shell output stream closed');
            terminal.write('\r\n\x1b[1;31mShell terminated\x1b[0m\r\n');
          },
          abort(reason) {
            logger.error('Shell output stream aborted:', reason);
            terminal.write(`\r\n\x1b[1;31mShell error: ${reason}\x1b[0m\r\n`);
          }
        })
      ).catch(err => {
        logger.error('Error in output pipe:', err);
      });
    } catch (pipeError) {
      logger.error('Failed to pipe output:', pipeError);
      terminal.write(`\r\n\x1b[1;31mFailed to connect to shell output: ${getErrorMessage(pipeError)}\x1b[0m\r\n`);
      // Still resolve so terminal is usable
      jshReady.resolve();
    }

    terminal.onData((data) => {
      try {
        if (isInteractive && input) {
          input.write(data).catch(err => {
            logger.error('Failed to write to input:', err);
          });
        }
      } catch (err) {
        logger.error('Error processing terminal data:', err);
      }
    });

    try {
      // Wait with a timeout to avoid hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout waiting for shell to become interactive')), 5000);
      });
      await Promise.race([jshReady.promise, timeoutPromise]);
    } catch (err) {
      logger.warn('Shell initialization timeout or error:', err);
      // Even if timeout, return the process so the terminal is still usable
    }

    return process;
  } catch (err) {
    logger.error('Failed to spawn shell process:', err);
    terminal.write(`\r\n\x1b[1;31mFailed to spawn shell: ${getErrorMessage(err)}\x1b[0m\r\n`);
    throw err;
  }
}

export type ExecutionResult = { output: string; exitCode: number } | undefined;

export class BoltShell {
  #initialized: (() => void) | undefined;
  #readyPromise: Promise<void>;
  #webcontainer: WebContainer | undefined;
  #terminal: ITerminal | undefined;
  #process: WebContainerProcess | undefined;
  executionState = atom<{ sessionId: string; active: boolean; executionPrms?: Promise<any> } | undefined>();
  #outputStream: ReadableStreamDefaultReader<string> | undefined;
  #shellInputStream: WritableStreamDefaultWriter<string> | undefined;
  #initRetries = 0;
  #maxRetries = 3;
  #processSpawned = false;

  constructor() {
    this.#readyPromise = new Promise((resolve) => {
      this.#initialized = resolve;
    });
  }

  ready() {
    return this.#readyPromise;
  }

  async init(webcontainer: WebContainer, terminal: ITerminal) {
    if (!webcontainer) {
      terminal.write('\r\n\x1b[1;31mCannot initialize shell: WebContainer not provided\x1b[0m\r\n');
      // Mark as initialized anyway so the app doesn't hang
      this.#initialized?.();
      return;
    }

    this.#webcontainer = webcontainer;
    this.#terminal = terminal;

    terminal.write('\r\nInitializing the Bolt terminal...\r\n');

    try {
      // Check if process is already spawned to avoid double initialization
      if (this.#processSpawned) {
        logger.warn('Process already spawned, skipping initialization');
        terminal.write('\r\n\x1b[1;33mTerminal already initialized, reconnecting...\x1b[0m\r\n');
        this.#initialized?.();
        return;
      }

      this.#processSpawned = true;

      const { process, output } = await this.newBoltShellProcess(webcontainer, terminal);

      if (!process) {
        throw new Error('Failed to create process');
      }

      this.#process = process;

      if (!output) {
        throw new Error('Process output stream is not available');
      }

      try {
        this.#outputStream = output.getReader();
      } catch (readerErr) {
        logger.error('Failed to get reader for process output:', readerErr);
        throw new Error(`Failed to get output reader: ${getErrorMessage(readerErr)}`);
      }

      try {
        await this.waitTillOscCode('interactive');
        logger.debug('Shell initialized successfully');
        terminal.write('\r\n\x1b[1;32mTerminal ready\x1b[0m\r\n');
      } catch (waitErr) {
        logger.warn('Error waiting for interactive shell:', waitErr);
        terminal.write(`\r\n\x1b[1;33mWarning: ${getErrorMessage(waitErr)}\x1b[0m\r\n`);
      }

      this.#initialized?.();
    } catch (error) {
      this.#processSpawned = false;
      logger.error('Failed to initialize shell:', error);
      terminal.write(`\r\n\x1b[1;31mFailed to initialize shell: ${getErrorMessage(error)}\x1b[0m\r\n`);

      if (this.#initRetries < this.#maxRetries) {
        this.#initRetries++;
        terminal.write(`\r\n\x1b[33mRetrying shell initialization (${this.#initRetries}/${this.#maxRetries})...\x1b[0m\r\n`);
        setTimeout(() => this.init(webcontainer, terminal), 1000);
      } else {
        terminal.write(`\r\n\x1b[1;31mFailed to initialize shell after ${this.#maxRetries} attempts\x1b[0m\r\n`);
        terminal.write('\r\n\x1b[1;33mTry running in fallback mode without shell access.\x1b[0m\r\n');
        // Mark as initialized anyway so the app can continue
        this.#initialized?.();
      }
    }
  }

  get terminal() {
    return this.#terminal;
  }

  get process() {
    return this.#process;
  }

  async executeCommand(sessionId: string, command: string): Promise<ExecutionResult> {
    try {
      await this.ready();

      if (!this.#process) {
        logger.error('Cannot execute command: Shell process not initialized');
        return { output: 'Error: Shell process not initialized', exitCode: 1 };
      }

      // Get or recreate the writer if needed
      if (!this.#shellInputStream) {
        try {
          if (!this.#process.input) {
            throw new Error('Process input stream is not available');
          }
          this.#shellInputStream = this.#process.input.getWriter();
        } catch (writerErr) {
          logger.error('Failed to get writer for command execution:', writerErr);
          return { output: `Error getting writer: ${getErrorMessage(writerErr)}`, exitCode: 1 };
        }
      }

      // Check if there's an existing execution in progress
      const currentState = this.executionState.get();

      if (currentState?.active) {
        if (currentState.sessionId !== sessionId) {
          logger.warn('Another command execution in progress, cannot execute now');
          return { output: 'Error: Another command is already running', exitCode: 1 };
        }

        // If same session is trying to execute again, wait for previous execution
        if (currentState.executionPrms) {
          try {
            await currentState.executionPrms;
          } catch (err) {
            // Ignore errors from previous execution
          }
        }
      }

      // Create a new execution promise
      const executionPromise = (async () => {
        try {
          // Write the command and execute it
          await this.#shellInputStream!.write(`${command.trim()}\n`);

          // Wait for the command to complete
          const result = await this.waitTillOscCode('exit');
          return result;
        } catch (execError) {
          logger.error('Error during command execution:', execError);
          return { output: `Command execution error: ${getErrorMessage(execError)}`, exitCode: 1 };
        } finally {
          // Make sure we have a valid session ID when resetting state
          const state = this.executionState.get();
          if (state) {
            this.executionState.set({
              sessionId: state.sessionId,
              active: false,
              executionPrms: state.executionPrms
            });
          }
        }
      })();

      // Update the execution state
      this.executionState.set({
        sessionId,
        active: true,
        executionPrms: executionPromise
      });

      return await executionPromise;
    } catch (error) {
      logger.error('Command execution error:', error);
      return { output: `Error executing command: ${getErrorMessage(error)}`, exitCode: 1 };
    }
  }

  async newBoltShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
    const args: string[] = [];

    try {
      terminal.write('\r\nStarting shell process...\r\n');

      // we spawn a JSH process with a fallback cols and rows in case the process is not attached yet to a visible terminal
      const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
        terminal: {
          cols: terminal.cols ?? 80,
          rows: terminal.rows ?? 15,
        },
      });

      if (!process || !process.input) {
        throw new Error('Failed to create process or process input stream');
      }

      let input;
      try {
        input = process.input.getWriter();
      } catch (writerErr) {
        logger.error('Failed to get writer for process input:', writerErr);
        throw new Error(`Failed to get writer: ${getErrorMessage(writerErr)}`);
      }

      this.#shellInputStream = input;

      if (!process.output) {
        throw new Error('Process output stream is not available');
      }

      // Create two copies of the output stream
      const [internalOutput, terminalOutput] = process.output.tee();

      const jshReady = withResolvers<void>();
      let isInteractive = false;

      try {
        terminalOutput.pipeTo(
          new WritableStream({
            write(data) {
              if (!isInteractive) {
                const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

                if (osc === 'interactive') {
                  // wait until we see the interactive OSC
                  isInteractive = true;
                  jshReady.resolve();
                }
              }

              terminal.write(data);
            },
            close() {
              logger.debug('BoltShell output stream closed');
              terminal.write('\r\n\x1b[1;31mBolt shell terminated\x1b[0m\r\n');
            },
            abort(reason) {
              logger.error('BoltShell output stream aborted:', reason);
              terminal.write(`\r\n\x1b[1;31mBolt shell error: ${reason}\x1b[0m\r\n`);
            }
          })
        ).catch(err => {
          logger.error('Error in BoltShell output pipe:', err);
        });
      } catch (pipeError) {
        logger.error('Failed to pipe BoltShell output:', pipeError);
        // Continue anyway so we can at least try to use the shell
      }

      terminal.onData((data) => {
        try {
          if (isInteractive && input) {
            input.write(data).catch(err => {
              logger.error('Failed to write to BoltShell input:', err);
            });
          }
        } catch (err) {
          logger.error('Error processing BoltShell terminal data:', err);
        }
      });

      try {
        // Wait with a timeout to avoid hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for Bolt shell to become interactive')), 5000);
        });
        await Promise.race([jshReady.promise, timeoutPromise]);
      } catch (err) {
        logger.warn('BoltShell initialization timeout or error:', err);
        // Continue anyway
      }

      return { process, output: internalOutput };
    } catch (err) {
      logger.error('Failed to spawn BoltShell process:', err);
      terminal.write(`\r\n\x1b[1;31mFailed to spawn Bolt shell: ${getErrorMessage(err)}\x1b[0m\r\n`);
      throw err;
    }
  }

  async waitTillOscCode(waitCode: string) {
    let fullOutput = '';
    let exitCode: number = 0;

    if (!this.#outputStream) {
      logger.error('No output stream available for waitTillOscCode');
      return { output: fullOutput, exitCode };
    }

    const tappedStream = this.#outputStream;

    try {
      const maxIterations = 1000; // Safety limit to prevent infinite loops
      let iterations = 0;

      while (iterations < maxIterations) {
        iterations++;

        const { value, done } = await tappedStream.read();

        if (done) {
          logger.debug('Output stream ended while waiting for OSC code');
          break;
        }

        const text = value || '';
        fullOutput += text;

        // Check if command completion signal with exit code
        const oscMatch = text.match(/\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/);
        if (oscMatch) {
          const [, osc, , , code] = oscMatch;

          if (osc === 'exit') {
            exitCode = parseInt(code, 10);
          }

          if (osc === waitCode) {
            break;
          }
        }
      }

      if (iterations >= maxIterations) {
        logger.warn('Reached max iterations while waiting for OSC code:', waitCode);
      }

      return { output: fullOutput, exitCode };
    } catch (err) {
      logger.error('Error waiting for OSC code:', err);
      return { output: fullOutput + `\nError: ${getErrorMessage(err)}`, exitCode: 1 };
    }
  }
}

export function newBoltShellProcess() {
  return new BoltShell();
}
