import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function registerDebugConfigurationProviderAndCommand(context: vscode.ExtensionContext) {
    const debugProvider = vscode.debug.registerDebugConfigurationProvider('*', {
        async resolveDebugConfiguration(
            _folder: vscode.WorkspaceFolder | undefined,
            config: vscode.DebugConfiguration,
        ): Promise<vscode.DebugConfiguration | undefined> {
            if (!config.args || !Array.isArray(config.args)) return config;

            const inputPattern = /\$\{input:([^}]+)\}/;
            const resolvedArgs: string[] = [];
            const configName = config.name || 'default';

            for (const arg of config.args as string[]) {
                const match = typeof arg === 'string' ? arg.match(inputPattern) : null;
                if (match) {
                    const inputName = match[1];
                    const inputDef = findInputDefinition(inputName);
                    const value = await promptForInput(context, configName, inputDef, inputName);
                    if (value === undefined) {
                        return undefined;
                    }
                    resolvedArgs.push(arg.replace(inputPattern, value));
                } else {
                    resolvedArgs.push(arg);
                }
            }

            config.args = resolvedArgs;
            return config;
        }
    }, vscode.DebugConfigurationProviderTriggerKind.Initial);

    return debugProvider;
}

function findInputDefinition(inputId: string): { type: string; description?: string; options?: string[]; default?: string } | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return undefined;

    const launchPath = path.join(folders[0].uri.fsPath, '.vscode', 'launch.json');
    try {
        const raw = fs.readFileSync(launchPath, 'utf8');
        const stripped = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
        const launch = JSON.parse(stripped);
        const inputs: any[] = launch.inputs || [];
        return inputs.find((i: any) => i.id === inputId);
    } catch {
        return undefined;
    }
}

async function promptForInput(
    context: vscode.ExtensionContext,
    configName: string,
    inputDef: { type: string; description?: string; options?: string[]; default?: string } | undefined,
    inputName: string
): Promise<string | undefined> {
    const stateKey = `debugInput.${configName}.${inputName}`;
    const lastValue = context.workspaceState.get<string>(stateKey);

    if (inputDef?.type === 'pickString' && inputDef.options?.length) {
        let options = [...inputDef.options];
        if (lastValue && options.includes(lastValue)) {
            options = [lastValue, ...options.filter(o => o !== lastValue)];
        }
        const value = await vscode.window.showQuickPick(options, {
            placeHolder: inputDef.description || `选择参数: ${inputName}`,
            ignoreFocusOut: true,
        });
        if (value !== undefined) {
            context.workspaceState.update(stateKey, value);
        }
        return value;
    }

    const value = await vscode.window.showInputBox({
        prompt: inputDef?.description || `输入参数: ${inputName}`,
        value: lastValue ?? inputDef?.default ?? '',
        ignoreFocusOut: true,
    });
    if (value !== undefined) {
        context.workspaceState.update(stateKey, value);
    }
    return value;
}
