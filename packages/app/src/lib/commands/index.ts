export type PaletteCommand = {
  id: string;
  label: string;
  section: string;
  keywords?: string;
  run: () => void;
};

export type CommandRegistry = {
  register: (command: PaletteCommand) => void;
  list: () => PaletteCommand[];
};

export function createCommandRegistry(): CommandRegistry {
  const commands: PaletteCommand[] = [];
  return {
    register: (command) => {
      commands.push(command);
    },
    list: () => [...commands],
  };
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) => {
    const hay = `${cmd.label} ${cmd.section} ${cmd.keywords ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

export type BuildShellCommandsArgs = {
  registry: CommandRegistry;
  registerSessionCommands: (registry: CommandRegistry) => void;
  registerAgentCommands: (registry: CommandRegistry) => void;
  registerEditorCommands: (registry: CommandRegistry) => void;
};

export function buildShellCommandRegistry(args: BuildShellCommandsArgs): PaletteCommand[] {
  const registry = args.registry;
  args.registerSessionCommands(registry);
  args.registerAgentCommands(registry);
  args.registerEditorCommands(registry);
  return registry.list();
}
