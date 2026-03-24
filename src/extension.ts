import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

const FONT = 'JetBrains Mono, monospace';
const FONT_SIZE = 14;

// Keybindings managed via user keybindings.json (highest priority, overrides all defaults)
const CUSTOM_KEYBINDINGS: Record<string, unknown>[] = [
    { key: 'ctrl+alt+e', command: 'copy-with-ref.revealFolderInExplorer' },
    // Copy with ref
    { key: 'ctrl+shift+c', command: 'copy-with-ref.copy', when: 'editorTextFocus' },
    // Run to Cursor
    { key: 'ctrl+shift+q', command: 'editor.debug.action.runToCursor' },
    // Ctrl+Q: close all diff editors instead of quit
    { key: 'ctrl+q', command: '-workbench.action.quit' },
    { key: 'ctrl+q', command: 'git.closeAllDiffEditors' },
    // Ctrl+P: remove default quick open (we rely on other access methods)
    { key: 'ctrl+p', command: '-workbench.action.quickOpen' },
    { key: 'ctrl+p', command: '-workbench.action.quickOpenNavigateNextInFilePicker', when: 'inFilesPicker && inQuickOpen' },
    // Ctrl+D: pin editor instead of add selection to next find match
    { key: 'ctrl+d', command: '-editor.action.addSelectionToNextFindMatch', when: 'editorFocus' },
    { key: 'ctrl+d', command: '-notebook.addFindMatchToSelection', when: 'config.notebook.multiCursor.enabled && notebookCellEditorFocused && activeEditor == \'workbench.editor.notebook\'' },
    { key: 'ctrl+d', command: 'workbench.action.pinEditor', when: '!activeEditorIsPinned' },
    { key: 'ctrl+shift+d', command: '-workbench.view.debug', when: 'viewContainer.workbench.view.debug.enabled' },
    { key: 'ctrl+k d', command: '-workbench.files.action.compareWithSaved' },
    { key: 'ctrl+k ctrl+d', command: '-editor.action.moveSelectionToNextFindMatch', when: 'editorFocus' },
    { key: 'ctrl+k shift+enter', command: '-workbench.action.pinEditor', when: '!activeEditorIsPinned' },
    { key: 'ctrl+; d', command: '-jupyter.moveCellsDown', when: 'editorTextFocus && jupyter.hascodecells && !jupyter.webExtension && !notebookEditorFocused' },
    // Shift+Enter in terminal: newline without execute
    { key: 'shift+enter', command: 'workbench.action.terminal.sendSequence', args: { text: '\u001b\r' }, when: 'terminalFocus' },
];

function applyUserKeybindings(context: vscode.ExtensionContext) {
    // Derive User dir from globalStorageUri: .../User/globalStorage/ext-id -> .../User
    const userDir = path.resolve(context.globalStorageUri.fsPath, '..', '..');
    const kbPath = path.join(userDir, 'keybindings.json');

    let content = '';
    try { content = fs.readFileSync(kbPath, 'utf8'); } catch { }

    // Deduplicate by checking if the key+command combo already exists in the file
    const toAdd = CUSTOM_KEYBINDINGS.filter(e => {
        const sig = `"key":"${e.key}","command":"${e.command}"`;
        return !content.replace(/\s/g, '').includes(sig.replace(/\s/g, ''));
    });
    if (!toAdd.length) return;

    const newLines = toAdd.map(e => `    ${JSON.stringify(e)}`).join(',\n');

    if (!content.trim() || content.trim() === '[]') {
        content = '[\n' + newLines + '\n]\n';
    } else {
        // Insert before the last ]
        const lastBracket = content.lastIndexOf(']');
        if (lastBracket === -1) return;
        const before = content.substring(0, lastBracket).trimEnd();
        const needsComma = !before.endsWith('[') && !before.endsWith(',');
        content = before + (needsComma ? ',' : '') + '\n' + newLines + '\n]\n';
    }

    fs.writeFileSync(kbPath, content);
}

function applySettings(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration();

    // UI behavior
    config.update('workbench.editor.pinnedTabsOnSeparateRow', true, vscode.ConfigurationTarget.Global);
    config.update('workbench.tree.expandMode', 'doubleClick', vscode.ConfigurationTarget.Global);
    config.update('explorer.compactFolders', false, vscode.ConfigurationTarget.Global);
    config.update('workbench.list.openMode', 'doubleClick', vscode.ConfigurationTarget.Global);

    // Default layout: hide auxiliary side bar
    vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');

    // JetBrains style
    config.update('workbench.colorTheme', 'JetBrains Darcula Theme', vscode.ConfigurationTarget.Global);
    config.update('editor.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('editor.fontSize', FONT_SIZE, vscode.ConfigurationTarget.Global);
    config.update('editor.fontLigatures', true, vscode.ConfigurationTarget.Global);
    config.update('terminal.integrated.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('terminal.integrated.fontSize', FONT_SIZE, vscode.ConfigurationTarget.Global);
    config.update('debug.console.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('debug.console.fontSize', FONT_SIZE, vscode.ConfigurationTarget.Global);
    config.update('notebook.outputFontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('notebook.outputFontSize', FONT_SIZE, vscode.ConfigurationTarget.Global);
    config.update('chat.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('chat.fontSize', FONT_SIZE, vscode.ConfigurationTarget.Global);
    config.update('editor.codeLensFontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('editor.inlayHints.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('editor.inlineSuggest.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('scm.inputFontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('notebook.markup.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('notebook.output.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('markdown.preview.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('gitlens.currentLine.fontFamily', FONT, vscode.ConfigurationTarget.Global);
    config.update('gitlens.blame.fontFamily', FONT, vscode.ConfigurationTarget.Global);

    // Notify if theme/font extension missing (only once per install)
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
    applySettings(context);
    applyUserKeybindings(context);

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
