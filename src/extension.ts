import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

interface ExtConfig {
    settings: Record<string, unknown>;
    keybindings: Record<string, unknown>[];
}

function loadConfig(extensionPath: string): ExtConfig {
    const configPath = path.join(extensionPath, 'config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
}

function applyUserKeybindings(context: vscode.ExtensionContext, keybindings: Record<string, unknown>[]) {
    const userDir = path.resolve(context.globalStorageUri.fsPath, '..', '..');
    const kbPath = path.join(userDir, 'keybindings.json');

    let raw = '';
    try { raw = fs.readFileSync(kbPath, 'utf8'); } catch { }

    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
    let existing: Record<string, unknown>[] = [];
    try { existing = JSON.parse(stripped || '[]'); } catch { existing = []; }

    const identity = (e: Record<string, unknown>) => `${e.key}|${e.command}`;

    const existingMap = new Map<string, { index: number; entry: Record<string, unknown> }>();
    existing.forEach((e, i) => existingMap.set(identity(e), { index: i, entry: e }));

    let changed = false;
    for (const desired of keybindings) {
        const id = identity(desired);
        const found = existingMap.get(id);
        if (found) {
            if (JSON.stringify(found.entry) !== JSON.stringify(desired)) {
                existing[found.index] = desired;
                changed = true;
            }
        } else {
            existing.push(desired);
            changed = true;
        }
    }

    if (!changed) return;

    const lines = existing.map(e => `    ${JSON.stringify(e)}`).join(',\n');
    fs.writeFileSync(kbPath, `[\n${lines}\n]\n`);
}

function applySettings(context: vscode.ExtensionContext, settings: Record<string, unknown>) {
    const config = vscode.workspace.getConfiguration();

    for (const [key, value] of Object.entries(settings)) {
        config.update(key, value, vscode.ConfigurationTarget.Global);
    }

    vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');

    const notified = context.globalState.get<boolean>('jetbrainsNotified');
    if (!notified) {
        context.globalState.update('jetbrainsNotified', true);

        const hasTheme = vscode.extensions.all.some(e =>
            e.id.toLowerCase().includes('darcula') || e.id.toLowerCase().includes('jetbrains')
        );
        if (!hasTheme) {
            vscode.window.showWarningMessage(
                'JetBrains Darcula Theme 未安装，主题设置暂不生效。',
                '去应用商店安装'
            ).then(action => {
                if (action) {
                    vscode.commands.executeCommand('workbench.extensions.search', 'JetBrains Darcula Theme');
                }
            });
        }

        vscode.window.showInformationMessage(
            '如果字体显示不正常，请先安装 JetBrains Mono 字体。Ubuntu 用户可运行：sudo apt install fonts-jetbrains-mono',
            '官方下载页',
            '知道了'
        ).then(action => {
            if (action === '官方下载页') {
                vscode.env.openExternal(vscode.Uri.parse('https://www.jetbrains.com/lp/mono/#how-to-install'));
            }
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    const cfg = loadConfig(context.extensionPath);
    applySettings(context, cfg.settings);
    applyUserKeybindings(context, cfg.keybindings);

    const cmd = vscode.commands.registerCommand('copy-with-ref.copy', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;

        // Get relative path from workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let filePath = editor.document.fileName;
        if (workspaceFolders) {
            const root = workspaceFolders[0].uri.fsPath;
            filePath = path.relative(root, filePath);
        }

        // 1-based line numbers
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const lineRef = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

        const content = `@${filePath}:${lineRef}`;

        await vscode.env.clipboard.writeText(content);
        vscode.window.setStatusBarMessage(`Copied: ${filePath}:${lineRef}`, 2000);
    });

    const copyFilesCmd = vscode.commands.registerCommand(
        'copy-with-ref.copyFilesToSystem',
        async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            const targets = uris?.length ? uris : (uri ? [uri] : []);
            if (!targets.length) return;

            // GNOME file manager clipboard format
            const content = 'copy\n' + targets.map(u => u.toString()).join('\n');

            const xclip = spawn('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files']);
            xclip.on('error', () => {
                vscode.window.showErrorMessage('Copy to system clipboard failed: xclip not found. Run: sudo apt install xclip');
            });
            xclip.stdin.write(content);
            xclip.stdin.end();
            xclip.on('close', (code) => {
                if (code === 0) {
                    vscode.window.setStatusBarMessage(`Copied ${targets.length} file(s) to system clipboard`, 2000);
                }
            });
        }
    );

    const revealFolderCmd = vscode.commands.registerCommand(
        'copy-with-ref.revealFolderInExplorer',
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;

            const root = workspaceFolders[0].uri.fsPath;

            const output = await new Promise<string>((resolve, reject) => {
                const proc = spawn('find', [
                    root, '-type', 'd',
                    '-not', '-path', '*/.git/*',
                    '-not', '-path', '*/.git',
                    '-not', '-path', '*/node_modules/*',
                    '-not', '-path', '*/__pycache__/*',
                    '-not', '-path', '*/.venv/*',
                ]);
                let buf = '';
                proc.stdout.on('data', (data: Buffer) => { buf += data.toString(); });
                proc.on('close', () => resolve(buf));
                proc.on('error', reject);
            });

            const dirs = output.trim().split('\n')
                .filter(d => d && d !== root)
                .map(d => path.relative(root, d))
                .sort();

            const selected = await vscode.window.showQuickPick(dirs, {
                placeHolder: '搜索文件夹，选中后在资源管理器中展开',
            });

            if (selected) {
                const uri = vscode.Uri.file(path.join(root, selected));
                await vscode.commands.executeCommand('revealInExplorer', uri);
            }
        }
    );

    const copyFileNameCmd = vscode.commands.registerCommand(
        'copy-with-ref.copyFileName',
        async (uri: vscode.Uri) => {
            if (!uri) return;
            const fileName = path.basename(uri.fsPath);
            await vscode.env.clipboard.writeText(fileName);
            vscode.window.setStatusBarMessage(`Copied: ${fileName}`, 2000);
        }
    );

    context.subscriptions.push(cmd, copyFilesCmd, revealFolderCmd, copyFileNameCmd);
}

export function deactivate() {}
