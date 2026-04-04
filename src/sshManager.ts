import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXTENSION_ID } from './constants';

interface SshHostNode {
    kind: 'host';
    host: string;
    hostname?: string;
    user?: string;
    port?: string;
}

interface SshErrorNode {
    kind: 'error';
    message: string;
}

type SshTreeNode = SshHostNode | SshErrorNode;

/**
 * 解析 SSH config 文件，返回主机列表
 * 跳过 Host * 全局配置块
 */
function parseSshConfig(configPath: string): SshHostNode[] {
    if (!fs.existsSync(configPath)) {
        throw new Error('SSH config file not found at ' + configPath);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    const hosts: SshHostNode[] = [];
    let currentHost: SshHostNode | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // 空行或注释行，跳过
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // 检查 Host 行
        if (trimmed.toLowerCase().startsWith('host ')) {
            // 保存之前的主机
            if (currentHost && currentHost.host !== '*') {
                hosts.push(currentHost);
            }

            // 提取 Host 别名
            const hostName = trimmed.substring(5).trim();
            currentHost = {
                kind: 'host',
                host: hostName,
            };

            // 跳过 Host * 全局配置
            if (hostName === '*') {
                currentHost = null;
            }
            continue;
        }

        // 解析主机配置字段（缩进的行）
        if (currentHost) {
            const keyValue = trimmed.split(/\s+/);
            if (keyValue.length >= 2) {
                const key = keyValue[0].toLowerCase();
                const value = keyValue.slice(1).join(' ');

                if (key === 'hostname') {
                    currentHost.hostname = value;
                } else if (key === 'user') {
                    currentHost.user = value;
                } else if (key === 'port') {
                    currentHost.port = value;
                }
            }
        }
    }

    // 保存最后一个主机
    if (currentHost && currentHost.host !== '*') {
        hosts.push(currentHost);
    }

    return hosts;
}

class SshServerProvider implements vscode.TreeDataProvider<SshTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<SshTreeNode | undefined | void> =
        new vscode.EventEmitter<SshTreeNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SshTreeNode | undefined | void> =
        this._onDidChangeTreeData.event;

    private configPath: string;
    private parseError: string | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;

    constructor() {
        this.configPath = path.join(os.homedir(), '.ssh', 'config');
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        try {
            const pattern = new vscode.RelativePattern(
                path.dirname(this.configPath),
                path.basename(this.configPath)
            );
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidChange(() => {
                this.refresh();
            });

            this.fileWatcher.onDidCreate(() => {
                this.refresh();
            });
        } catch (error) {
            console.error('Failed to setup file watcher:', error);
        }
    }

    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getParseError(): string | null {
        return this.parseError;
    }

    setParseError(error: string | null): void {
        this.parseError = error;
    }

    getTreeItem(element: SshTreeNode): vscode.TreeItem {
        if (element.kind === 'error') {
            const treeItem = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
            treeItem.iconPath = new vscode.ThemeIcon('error');
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(element.host, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = this.buildTooltip(element);
        treeItem.iconPath = new vscode.ThemeIcon('remote');
        treeItem.command = {
            command: `${EXTENSION_ID}.connectSsh`,
            title: 'Connect to SSH Host',
            arguments: [element],
        };
        return treeItem;
    }

    getChildren(element?: SshTreeNode): Thenable<SshTreeNode[]> {
        // 只有一层，无 children
        if (element) {
            return Promise.resolve([]);
        }

        try {
            const hosts = parseSshConfig(this.configPath);
            this.parseError = null;
            return Promise.resolve(hosts);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.parseError = errorMsg;
            return Promise.resolve([{
                kind: 'error',
                message: '❌ ' + errorMsg,
            }]);
        }
    }

    private buildTooltip(element: SshHostNode): string {
        const parts: string[] = [element.host];
        if (element.hostname) {
            parts.push(`Host: ${element.hostname}`);
        }
        if (element.user) {
            parts.push(`User: ${element.user}`);
        }
        if (element.port) {
            parts.push(`Port: ${element.port}`);
        }
        return parts.join('\n');
    }
}

/**
 * SSH 连接命令：新建终端并自动执行 ssh 命令
 */
async function connectSsh(node: SshTreeNode) {
    if (!node || node.kind !== 'host') {
        return;
    }

    const sshCommand = `ssh ${node.host}`;

    // 新建带 host 名的终端并自动执行
    const terminal = vscode.window.createTerminal({
        name: node.host,
    });

    terminal.show(true);
    terminal.sendText(sshCommand, true);
}

/**
 * 注册 SSH Server 视图
 */
export function registerSshServerView(context: vscode.ExtensionContext): vscode.Disposable[] {
    const provider = new SshServerProvider();
    const treeView = vscode.window.createTreeView(`${EXTENSION_ID}_ssh`, {
        treeDataProvider: provider,
        showCollapseAll: false,
    });

    // 注册 connectSsh 命令
    const connectCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.connectSsh`, connectSsh);

    // 注册 refreshSsh 命令
    const refreshCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.refreshSsh`, () => {
        provider.refresh();
    });

    // 创建一个 disposable 来清理 provider 的 file watcher
    const providerDisposable = vscode.Disposable.from(
        new vscode.Disposable(() => provider.dispose())
    );

    return [treeView, connectCmd, refreshCmd, providerDisposable];
}
