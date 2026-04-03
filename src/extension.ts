import * as vscode from 'vscode';
import { loadConfig, applySettings, applyUserKeybindings } from './config';
import {
    registerCopyWithRefCommand,
    registerCopyFilesToSystemCommand,
    registerAddFavoriteFolderCommand,
    registerRevealFolderCommand,
    registerCopyFileNameCommand,
    registerKillPythonDebugCommand,
} from './commands';
import { registerDebugConfigurationProviderAndCommand } from './debug';

export function activate(context: vscode.ExtensionContext) {
    const cfg = loadConfig(context.extensionPath);
    applySettings(context, cfg.settings);
    applyUserKeybindings(context, cfg.keybindings);

    const cmd = registerCopyWithRefCommand(context);
    const copyFilesCmd = registerCopyFilesToSystemCommand();
    const addFavoriteFolderCmd = registerAddFavoriteFolderCommand(context);
    const revealFolderCmd = registerRevealFolderCommand(context);
    const copyFileNameCmd = registerCopyFileNameCommand();
    const killPythonDebugCmd = registerKillPythonDebugCommand();
    const debugProvider = registerDebugConfigurationProviderAndCommand(context);

    context.subscriptions.push(cmd, copyFilesCmd, addFavoriteFolderCmd, revealFolderCmd, copyFileNameCmd, killPythonDebugCmd, debugProvider);
}

export function deactivate() {}
