import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { EXTENSION_ID } from './constants';

interface SshHostNode {
    kind: 'host';
    host: string;
    hostname?: string;
    user?: string;
    port?: string;
    latency?: number | null;
}

interface SshErrorNode {
    kind: 'error';
    message: string;
}

interface SyncHistoryEntry {
    local: string;
    remote: string;
    lastUsed: string;
    isDirectory: boolean;
}

interface ServerSyncHistory {
    uploads: SyncHistoryEntry[];
    downloads: SyncHistoryEntry[];
}

interface SyncConfig {
    servers: Record<string, ServerSyncHistory>;
}

type SshTreeNode = SshHostNode | SshErrorNode;

const SYNC_CONFIG_DIR = path.join(os.homedir(), '.config', 'user_extension', 'ssh_manager');
const SYNC_CONFIG_PATH = path.join(SYNC_CONFIG_DIR, 'config.json');
const MAX_HISTORY = 5;

function loadSyncConfig(): SyncConfig {
    if (!fs.existsSync(SYNC_CONFIG_PATH)) {
        return { servers: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(SYNC_CONFIG_PATH, 'utf-8'));
    } catch {
        return { servers: {} };
    }
}

function saveSyncConfig(config: SyncConfig): void {
    if (!fs.existsSync(SYNC_CONFIG_DIR)) {
        fs.mkdirSync(SYNC_CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(SYNC_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function addSyncHistory(server: string, direction: 'upload' | 'download', local: string, remote: string, isDirectory: boolean): void {
    const config = loadSyncConfig();
    if (!config.servers[server]) {
        config.servers[server] = { uploads: [], downloads: [] };
    }
    const list = direction === 'upload' ? config.servers[server].uploads : config.servers[server].downloads;
    const existing = list.findIndex(e => e.local === local && e.remote === remote);
    if (existing !== -1) {
        list.splice(existing, 1);
    }
    list.unshift({ local, remote, lastUsed: new Date().toISOString(), isDirectory });
    if (list.length > MAX_HISTORY) {
        list.length = MAX_HISTORY;
    }
    saveSyncConfig(config);
}

function getSyncHistory(server: string, direction: 'upload' | 'download'): SyncHistoryEntry[] {
    const config = loadSyncConfig();
    const serverHist = config.servers[server];
    if (!serverHist) return [];
    return direction === 'upload' ? serverHist.uploads : serverHist.downloads;
}

function getRemotePath(serverNode: SshHostNode, remotePath: string): string {
    const user = serverNode.user ? `${serverNode.user}@` : '';
    const host = serverNode.hostname || serverNode.host;
    const port = serverNode.port ? `-P ${serverNode.port} ` : '';
    return `${user}${host}:${remotePath}`;
}

function buildScpArgs(serverNode: SshHostNode): string[] {
    const args: string[] = [];
    if (serverNode.port) {
        args.push('-P', serverNode.port);
    }
    return args;
}
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
    private pingTimer: NodeJS.Timeout | null = null;
    private hosts: SshHostNode[] = [];

    constructor() {
        this.configPath = path.join(os.homedir(), '.ssh', 'config');
        this.setupFileWatcher();
        this.startPingTimer();
    }

    private async pingHost(host: SshHostNode): Promise<number | null> {
        const target = host.hostname || host.host;
        return new Promise((resolve) => {
            const start = Date.now();
            const proc = spawn('ping', ['-c', '1', '-W', '3', target], { timeout: 5000 });
            let output = '';
            proc.stdout.on('data', (data) => { output += data.toString(); });
            proc.on('close', (code) => {
                if (code === 0) {
                    const match = output.match(/time[=<](\d+\.?\d*)\s*ms/);
                    if (match) {
                        resolve(Math.round(parseFloat(match[1])));
                    } else {
                        resolve(Date.now() - start);
                    }
                } else {
                    resolve(null);
                }
            });
            proc.on('error', () => resolve(null));
        });
    }

    private async pingAll(): Promise<void> {
        for (const host of this.hosts) {
            host.latency = await this.pingHost(host);
        }
        this._onDidChangeTreeData.fire();
    }

    private startPingTimer(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        this.pingAll();
        this.pingTimer = setInterval(() => this.pingAll(), 2500);
    }

    private stopPingTimer(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
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
        this.stopPingTimer();
    }

    refresh(): void {
        this.hosts = [];
        this.parseError = null;
        try {
            this.hosts = parseSshConfig(this.configPath);
        } catch (error) {
            this.parseError = error instanceof Error ? error.message : String(error);
        }
        this._onDidChangeTreeData.fire();
        this.pingAll();
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

        const label = element.latency !== undefined && element.latency !== null
            ? `${element.host}  ${element.latency}ms`
            : element.host;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = this.buildTooltip(element);
        treeItem.iconPath = new vscode.ThemeIcon('remote');
        treeItem.contextValue = 'sshHost';
        return treeItem;
    }

    getChildren(element?: SshTreeNode): Thenable<SshTreeNode[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (this.parseError) {
            return Promise.resolve([{
                kind: 'error',
                message: '❌ ' + this.parseError,
            }]);
        }

        if (this.hosts.length === 0) {
            try {
                this.hosts = parseSshConfig(this.configPath);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.parseError = errorMsg;
                return Promise.resolve([{
                    kind: 'error',
                    message: '❌ ' + errorMsg,
                }]);
            }
        }
        return Promise.resolve(this.hosts);
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
        if (element.latency !== undefined && element.latency !== null) {
            parts.push(`Latency: ${element.latency}ms`);
        } else if (element.latency === null) {
            parts.push('Latency: unreachable');
        }
        return parts.join('\n');
    }
}

/**
 * 打开 SSH config 文件
 */
async function openSshConfig() {
    const configPath = path.join(os.homedir(), '.ssh', 'config');
    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
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

interface HistoryQuickPickItem extends vscode.QuickPickItem {
    entry: SyncHistoryEntry | 'browse';
}

/**
 * 显示同步历史选择 QuickPick，返回选中的历史条目或 null（用户选"浏览..."）
 */
function showHistoryQuickPick(
    history: SyncHistoryEntry[],
    direction: 'upload' | 'download'
): Thenable<SyncHistoryEntry | 'browse' | undefined> {
    const items: HistoryQuickPickItem[] = history.map(e => ({
        label: direction === 'upload'
            ? `$(history) ${e.isDirectory ? '$(folder)' : '$(file)'} ${e.local} → ${e.remote}`
            : `$(history) ${e.isDirectory ? '$(folder)' : '$(file)'} ${e.remote} → ${e.local}`,
        description: `Last used: ${new Date(e.lastUsed).toLocaleDateString()}`,
        detail: e.isDirectory ? 'Directory' : 'File',
        entry: e,
    }));

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, entry: 'browse' });
    items.push({
        label: `$(folder-opened) Browse ${direction === 'upload' ? 'local' : 'remote'}...`,
        entry: 'browse',
    });

    return vscode.window.showQuickPick(items, {
        placeHolder: `Select ${direction} history or browse...`,
    }).then(pick => pick?.entry);
}

/**
 * 本地文件浏览（QuickPick 统一风格）
 */
async function pickLocalPath(direction: 'upload' | 'download'): Promise<string | undefined> {
    let currentPath = process.env.HOME || '/';

    while (true) {
        try {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            const items: vscode.QuickPickItem[] = [];

            items.push({ label: `$(check) Select this local folder`, description: currentPath });
            if (currentPath !== '/') {
                items.push({ label: '$(arrow-up) ..', description: 'parent' });
            }

            const dirs: vscode.QuickPickItem[] = [];
            const files: vscode.QuickPickItem[] = [];
            for (const e of entries) {
                if (e.name.startsWith('.')) continue;
                const fullPath = path.join(currentPath, e.name);
                if (e.isDirectory()) {
                    dirs.push({ label: `$(folder) ${e.name}`, description: fullPath });
                } else if (direction === 'upload') {
                    files.push({ label: `$(file) ${e.name}`, description: fullPath });
                }
            }

            items.push(...dirs.sort((a, b) => a.label.localeCompare(b.label)));
            if (direction === 'upload') {
                items.push(...files.sort((a, b) => a.label.localeCompare(b.label)));
            }

            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: direction === 'upload'
                    ? `Select local file to upload: ${currentPath}`
                    : `Select local save folder: ${currentPath}`,
            });

            if (!pick) return undefined;
            if (pick.description === 'parent') {
                currentPath = path.dirname(currentPath);
                continue;
            }
            if (pick.label.startsWith('$(check)')) {
                return currentPath;
            }
            if (pick.description && pick.label.startsWith('$(folder)')) {
                currentPath = pick.description;
                continue;
            }
            if (pick.description) {
                return pick.description;
            }
        } catch {
            vscode.window.showErrorMessage(`Failed to read directory: ${currentPath}`);
            return undefined;
        }
    }
}

/**
 * 选择服务器上的目标路径（通过 SSH ls 列出文件）
 */
async function pickRemotePath(
    serverNode: SshHostNode,
    initialPath: string = '/'
): Promise<string | undefined> {
    const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
    if (serverNode.port) {
        sshArgs.push('-p', serverNode.port);
    }
    const user = serverNode.user ? `${serverNode.user}@` : '';
    const host = serverNode.hostname || serverNode.host;

    let currentPath = initialPath;

    while (true) {
        const lsCmd = `ls -la "${currentPath}" 2>/dev/null`;
        const fullCmd = `ssh ${sshArgs.join(' ')} ${user}${host} "${lsCmd}"`;

        try {
            const output = await new Promise<string>((resolve, reject) => {
                const proc = spawn('ssh', [...sshArgs, `${user}${host}`, lsCmd], { timeout: 10000 });
                let out = '';
                proc.stdout.on('data', (d) => { out += d.toString(); });
                proc.stderr.on('data', () => {});
                proc.on('close', (code) => {
                    if (code === 0) resolve(out);
                    else reject(new Error(`Failed to list remote directory`));
                });
                proc.on('error', reject);
            });

            const entries: { name: string; isDir: boolean; fullPath: string }[] = [];
            for (const line of output.split('\n').slice(1)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 9) continue;
                const name = parts.slice(8).join(' ');
                if (name === '.' || name === '..') continue;
                const isDir = parts[0].startsWith('d');
                entries.push({ name, isDir, fullPath: path.posix.join(currentPath, name) });
            }

            const items: vscode.QuickPickItem[] = [];
            items.push({ label: '$(check) Select this remote folder', description: currentPath });
            if (currentPath !== '/') {
                items.push({ label: '$(arrow-up) ..', description: 'parent' });
            }
            for (const e of entries.sort((a, b) => (a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1))) {
                items.push({
                    label: e.isDir ? `$(folder) ${e.name}` : `$(file) ${e.name}`,
                    description: e.fullPath,
                });
            }

            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: `Remote: ${currentPath}`,
            });

            if (!pick) return undefined;
            if (pick.description === 'parent') {
                currentPath = path.posix.dirname(currentPath);
                continue;
            }
            if (pick.label.startsWith('$(check)')) {
                return currentPath;
            }
            if (pick.description && pick.label.startsWith('$(folder)')) {
                currentPath = pick.description;
                continue;
            }
            // 选了文件，返回文件路径
            if (pick.description) {
                return pick.description;
            }
        } catch {
            vscode.window.showErrorMessage('Failed to connect to server to list files');
            return undefined;
        }
    }
}

/**
 * 执行 rsync 上传
 */
async function scpUpload(
    serverNode: SshHostNode,
    localPath: string,
    remoteDir: string
): Promise<void> {
    const user = serverNode.user ? `${serverNode.user}@` : '';
    const host = serverNode.hostname || serverNode.host;
    const remoteTarget = path.posix.join(remoteDir, path.basename(localPath));
    const remoteFull = `${user}${host}:${remoteTarget}`;

    const isDir = fs.statSync(localPath).isDirectory();
    const src = isDir ? `${localPath}/` : localPath;
    const dst = isDir ? `${remoteFull}/` : remoteFull;

    let sshOpts = '-e "ssh';
    if (serverNode.port) {
        sshOpts += ` -p ${serverNode.port}`;
    }
    sshOpts += '"';

    const cmd = `rsync -avz --progress --delete ${sshOpts} "${src}" "${dst}"`;

    const terminal = vscode.window.createTerminal({
        name: `Upload: ${path.basename(localPath)}`,
    });
    terminal.show(true);
    terminal.sendText(cmd, true);

    addSyncHistory(serverNode.host, 'upload', localPath, remoteDir, isDir);
    vscode.window.showInformationMessage(`Uploading ${isDir ? 'folder' : 'file'}: ${path.basename(localPath)}`);
}

/**
 * 执行 rsync 下载
 */
async function scpDownload(
    serverNode: SshHostNode,
    remotePath: string,
    localDir: string
): Promise<void> {
    const user = serverNode.user ? `${serverNode.user}@` : '';
    const host = serverNode.hostname || serverNode.host;
    const remoteFull = `${user}${host}:${remotePath}`;
    const localTarget = path.join(localDir, path.basename(remotePath));

    let sshOpts = '-e "ssh';
    if (serverNode.port) {
        sshOpts += ` -p ${serverNode.port}`;
    }
    sshOpts += '"';

    const isDir = remotePath.endsWith('/');
    const src = isDir ? `${remoteFull}/` : remoteFull;
    const dst = isDir ? `${localTarget}/` : localTarget;

    const cmd = `rsync -avz --progress --delete ${sshOpts} "${src}" "${dst}"`;

    const terminal = vscode.window.createTerminal({
        name: `Download: ${path.basename(remotePath)}`,
    });
    terminal.show(true);
    terminal.sendText(cmd, true);

    addSyncHistory(serverNode.host, 'download', localDir, remotePath, true);
    vscode.window.showInformationMessage(`Downloading: ${path.basename(remotePath)}`);
}

/**
 * 上传命令：选择本地 → 选择远程目标 → scp 上传
 */
async function syncUpload(node: SshTreeNode) {
    if (!node || node.kind !== 'host') return;

    const history = getSyncHistory(node.host, 'upload');
    if (history.length > 0) {
        const pick = await showHistoryQuickPick(history, 'upload');
        if (pick && pick !== 'browse') {
            await scpUpload(node, pick.local, pick.remote);
            return;
        }
        if (pick === undefined) return;
    }

    const localPath = await pickLocalPath('upload');
    if (!localPath) return;

    const remoteDir = await pickRemotePath(node);
    if (!remoteDir) return;

    await scpUpload(node, localPath, remoteDir);
}

/**
 * 下载命令：选择远程文件 → 选择本地目标 → scp 下载
 */
async function syncDownload(node: SshTreeNode) {
    if (!node || node.kind !== 'host') return;

    const history = getSyncHistory(node.host, 'download');
    if (history.length > 0) {
        const pick = await showHistoryQuickPick(history, 'download');
        if (pick && pick !== 'browse') {
            await scpDownload(node, pick.remote, pick.local);
            return;
        }
        if (pick === undefined) return;
    }

    const remotePath = await pickRemotePath(node);
    if (!remotePath) return;

    const localDir = await pickLocalPath('download');
    if (!localDir) return;

    await scpDownload(node, remotePath, localDir);
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

    const connectCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.connectSsh`, connectSsh);
    const openConfigCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.openSshConfig`, openSshConfig);
    const refreshCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.refreshSsh`, () => {
        provider.refresh();
    });
    const uploadCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.syncUpload`, syncUpload);
    const downloadCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.syncDownload`, syncDownload);

    const providerDisposable = vscode.Disposable.from(
        new vscode.Disposable(() => provider.dispose())
    );

    return [treeView, connectCmd, openConfigCmd, refreshCmd, uploadCmd, downloadCmd, providerDisposable];
}
