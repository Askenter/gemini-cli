/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileCommandLoader } from './FileCommandLoader.js';
import {
  Config,
  getProjectCommandsDir,
  getUserCommandsDir,
} from '@google/torch-pilot-core';
import mock from 'mock-fs';
import { assert, vi } from 'vitest';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import {
  SHELL_INJECTION_TRIGGER,
  SHORTHAND_ARGS_PLACEHOLDER,
} from './prompt-processors/types.js';
import {
  ConfirmationRequiredError,
  ShellProcessor,
} from './prompt-processors/shellProcessor.js';
import { ShorthandArgumentProcessor } from './prompt-processors/argumentProcessor.js';

const mockShellProcess = vi.hoisted(() => vi.fn());
vi.mock('./prompt-processors/shellProcessor.js', () => ({
  ShellProcessor: vi.fn().mockImplementation(() => ({
    process: mockShellProcess,
  })),
  ConfirmationRequiredError: class extends Error {
    constructor(
      message: string,
      public commandsToConfirm: string[],
    ) {
      super(message);
      this.name = 'ConfirmationRequiredError';
    }
  },
}));

vi.mock('./prompt-processors/argumentProcessor.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('./prompt-processors/argumentProcessor.js')
    >();
  return {
    ShorthandArgumentProcessor: vi
      .fn()
      .mockImplementation(() => new original.ShorthandArgumentProcessor()),
    DefaultArgumentProcessor: vi
      .fn()
      .mockImplementation(() => new original.DefaultArgumentProcessor()),
  };
});
vi.mock('@google/torch-pilot-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@google/torch-pilot-core')>();
  return {
    ...original,
    isCommandAllowed: vi.fn(),
    ShellExecutionService: {
      execute: vi.fn(),
    },
  };
});

describe('FileCommandLoader', () => {
  const signal: AbortSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShellProcess.mockImplementation((prompt) => Promise.resolve(prompt));
  });

  afterEach(() => {
    mock.restore();
  });

  it('loads a single command from a file', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'test.toml': 'prompt = "This is a test prompt"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('test');

    const result = await command.action?.(
      createMockCommandContext({
        invocation: {
          raw: '/test',
          name: 'test',
          args: '',
        },
      }),
      '',
    );
    if (result?.type === 'submit_prompt') {
      expect(result.content).toBe('This is a test prompt');
    } else {
      assert.fail('Incorrect action type');
    }
  });

  // Symlink creation on Windows requires special permissions that are not
  // available in the standard CI environment. Therefore, we skip these tests
  // on Windows to prevent CI failures. The core functionality is still
  // validated on Linux and macOS.
  const itif = (condition: boolean) => (condition ? it : it.skip);

  itif(process.platform !== 'win32')(
    'loads commands from a symlinked directory',
    async () => {
      const userCommandsDir = getUserCommandsDir();
      const realCommandsDir = '/real/commands';
      mock({
        [realCommandsDir]: {
          'test.toml': 'prompt = "This is a test prompt"',
        },
        // Symlink the user commands directory to the real one
        [userCommandsDir]: mock.symlink({
          path: realCommandsDir,
        }),
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command).toBeDefined();
      expect(command.name).toBe('test');
    },
  );

  itif(process.platform !== 'win32')(
    'loads commands from a symlinked subdirectory',
    async () => {
      const userCommandsDir = getUserCommandsDir();
      const realNamespacedDir = '/real/namespaced-commands';
      mock({
        [userCommandsDir]: {
          namespaced: mock.symlink({
            path: realNamespacedDir,
          }),
        },
        [realNamespacedDir]: {
          'my-test.toml': 'prompt = "This is a test prompt"',
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command).toBeDefined();
      expect(command.name).toBe('namespaced:my-test');
    },
  );

  it('loads multiple commands', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'test1.toml': 'prompt = "Prompt 1"',
        'test2.toml': 'prompt = "Prompt 2"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(2);
  });

  it('creates deeply nested namespaces correctly', async () => {
    const userCommandsDir = getUserCommandsDir();

    mock({
      [userCommandsDir]: {
        gcp: {
          pipelines: {
            'run.toml': 'prompt = "run pipeline"',
          },
        },
      },
    });
    const loader = new FileCommandLoader({
      getProjectRoot: () => '/path/to/project',
    } as Config);
    const commands = await loader.loadCommands(signal);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('gcp:pipelines:run');
  });

  it('creates namespaces from nested directories', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        git: {
          'commit.toml': 'prompt = "git commit prompt"',
        },
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('git:commit');
  });

  it('overrides user commands with project commands', async () => {
    const userCommandsDir = getUserCommandsDir();
    const projectCommandsDir = getProjectCommandsDir(process.cwd());
    mock({
      [userCommandsDir]: {
        'test.toml': 'prompt = "User prompt"',
      },
      [projectCommandsDir]: {
        'test.toml': 'prompt = "Project prompt"',
      },
    });

    const loader = new FileCommandLoader({
      getProjectRoot: () => process.cwd(),
    } as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();

    const result = await command.action?.(
      createMockCommandContext({
        invocation: {
          raw: '/test',
          name: 'test',
          args: '',
        },
      }),
      '',
    );
    if (result?.type === 'submit_prompt') {
      expect(result.content).toBe('Project prompt');
    } else {
      assert.fail('Incorrect action type');
    }
  });

  it('ignores files with TOML syntax errors', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'invalid.toml': 'this is not valid toml',
        'good.toml': 'prompt = "This one is fine"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('good');
  });

  it('ignores files that are semantically invalid (missing prompt)', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'no_prompt.toml': 'description = "This file is missing a prompt"',
        'good.toml': 'prompt = "This one is fine"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('good');
  });

  it('handles filename edge cases correctly', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'test.v1.toml': 'prompt = "Test prompt"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.name).toBe('test.v1');
  });

  it('handles file system errors gracefully', async () => {
    mock({}); // Mock an empty file system
    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);
    expect(commands).toHaveLength(0);
  });

  it('uses a default description if not provided', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'test.toml': 'prompt = "Test prompt"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.description).toBe('Custom command from test.toml');
  });

  it('uses the provided description', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'test.toml': 'prompt = "Test prompt"\ndescription = "My test command"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);
    const command = commands[0];
    expect(command).toBeDefined();
    expect(command.description).toBe('My test command');
  });

  it('should sanitize colons in filenames to prevent namespace conflicts', async () => {
    const userCommandsDir = getUserCommandsDir();
    mock({
      [userCommandsDir]: {
        'legacy:command.toml': 'prompt = "This is a legacy command"',
      },
    });

    const loader = new FileCommandLoader(null as unknown as Config);
    const commands = await loader.loadCommands(signal);

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toBeDefined();

    // Verify that the ':' in the filename was replaced with an '_'
    expect(command.name).toBe('legacy_command');
  });

  describe('Shorthand Argument Processor Integration', () => {
    it('correctly processes a command with {{args}}', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shorthand.toml':
            'prompt = "The user wants to: {{args}}"\ndescription = "Shorthand test"',
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shorthand');
      expect(command).toBeDefined();

      const result = await command!.action?.(
        createMockCommandContext({
          invocation: {
            raw: '/shorthand do something cool',
            name: 'shorthand',
            args: 'do something cool',
          },
        }),
        'do something cool',
      );
      expect(result?.type).toBe('submit_prompt');
      if (result?.type === 'submit_prompt') {
        expect(result.content).toBe('The user wants to: do something cool');
      }
    });
  });

  describe('Default Argument Processor Integration', () => {
    it('correctly processes a command without {{args}}', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'model_led.toml':
            'prompt = "This is the instruction."\ndescription = "Default processor test"',
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'model_led');
      expect(command).toBeDefined();

      const result = await command!.action?.(
        createMockCommandContext({
          invocation: {
            raw: '/model_led 1.2.0 added "a feature"',
            name: 'model_led',
            args: '1.2.0 added "a feature"',
          },
        }),
        '1.2.0 added "a feature"',
      );
      expect(result?.type).toBe('submit_prompt');
      if (result?.type === 'submit_prompt') {
        const expectedContent =
          'This is the instruction.\n\n/model_led 1.2.0 added "a feature"';
        expect(result.content).toBe(expectedContent);
      }
    });
  });

  describe('Shell Processor Integration', () => {
    it('instantiates ShellProcessor if the trigger is present', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run this: ${SHELL_INJECTION_TRIGGER}echo hello}"`,
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledWith('shell');
    });

    it('does not instantiate ShellProcessor if trigger is missing', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'regular.toml': `prompt = "Just a regular prompt"`,
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).not.toHaveBeenCalled();
    });

    it('returns a "submit_prompt" action if shell processing succeeds', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{echo 'hello'}"`,
        },
      });
      mockShellProcess.mockResolvedValue('Run hello');

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      const result = await command!.action!(
        createMockCommandContext({
          invocation: { raw: '/shell', name: 'shell', args: '' },
        }),
        '',
      );

      expect(result?.type).toBe('submit_prompt');
      if (result?.type === 'submit_prompt') {
        expect(result.content).toBe('Run hello');
      }
    });

    it('returns a "confirm_shell_commands" action if shell processing requires it', async () => {
      const userCommandsDir = getUserCommandsDir();
      const rawInvocation = '/shell rm -rf /';
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{rm -rf /}"`,
        },
      });

      // Mock the processor to throw the specific error
      const error = new ConfirmationRequiredError('Confirmation needed', [
        'rm -rf /',
      ]);
      mockShellProcess.mockRejectedValue(error);

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      const result = await command!.action!(
        createMockCommandContext({
          invocation: { raw: rawInvocation, name: 'shell', args: 'rm -rf /' },
        }),
        'rm -rf /',
      );

      expect(result?.type).toBe('confirm_shell_commands');
      if (result?.type === 'confirm_shell_commands') {
        expect(result.commandsToConfirm).toEqual(['rm -rf /']);
        expect(result.originalInvocation.raw).toBe(rawInvocation);
      }
    });

    it('re-throws other errors from the processor', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{something}"`,
        },
      });

      const genericError = new Error('Something else went wrong');
      mockShellProcess.mockRejectedValue(genericError);

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      await expect(
        command!.action!(
          createMockCommandContext({
            invocation: { raw: '/shell', name: 'shell', args: '' },
          }),
          '',
        ),
      ).rejects.toThrow('Something else went wrong');
    });

    it('assembles the processor pipeline in the correct order (Shell -> Argument)', async () => {
      const userCommandsDir = getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'pipeline.toml': `
            prompt = "Shell says: ${SHELL_INJECTION_TRIGGER}echo foo} and user says: ${SHORTHAND_ARGS_PLACEHOLDER}"
          `,
        },
      });

      // Mock the process methods to track call order
      const argProcessMock = vi
        .fn()
        .mockImplementation((p) => `${p}-arg-processed`);

      // Redefine the mock for this specific test
      mockShellProcess.mockImplementation((p) =>
        Promise.resolve(`${p}-shell-processed`),
      );

      vi.mocked(ShorthandArgumentProcessor).mockImplementation(
        () =>
          ({
            process: argProcessMock,
          }) as unknown as ShorthandArgumentProcessor,
      );

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'pipeline');
      expect(command).toBeDefined();

      await command!.action!(
        createMockCommandContext({
          invocation: {
            raw: '/pipeline bar',
            name: 'pipeline',
            args: 'bar',
          },
        }),
        'bar',
      );

      // Verify that the shell processor was called before the argument processor
      expect(mockShellProcess.mock.invocationCallOrder[0]).toBeLessThan(
        argProcessMock.mock.invocationCallOrder[0],
      );

      // Also verify the flow of the prompt through the processors
      expect(mockShellProcess).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
      );
      expect(argProcessMock).toHaveBeenCalledWith(
        expect.stringContaining('-shell-processed'), // It receives the output of the shell processor
        expect.any(Object),
      );
    });
  });
});
