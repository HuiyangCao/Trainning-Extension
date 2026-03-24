# Copy with File Reference

一个 VS Code 插件，集成了文件引用复制、PyCharm 风格设置、快捷键绑定等多项实用功能。

## 安装

```bash
bash ./install.sh   # 不要 sudo
```

自动安装到 VS Code；如果检测到 Cursor 也会同时安装。

## 功能一览

### 1. 复制文件引用

选中代码（或仅放置光标），按 `Ctrl+Shift+C`，或右键菜单 → **Copy with File Reference**。

**选中多行：**
```
@src/mjlab/tasks/tracking/config/walk_env_cfg.py:28-29
```

**仅光标：**
```
@src/mjlab/tasks/tracking/config/walk_env_cfg.py:28
```

路径相对于工作区根目录，复制后状态栏会短暂提示。适合粘贴到终端、AI 对话、Issue 等场景。

### 2. 复制文件名

在资源管理器中右键文件 → **Copy File Name**，将文件名（不含路径）复制到剪贴板。

### 3. 复制文件到系统剪贴板

在资源管理器中右键选中文件 → **Copy to System Clipboard**，以 GNOME 文件管理器格式写入系统剪贴板，可直接在文件管理器中粘贴。

> 依赖 `xclip`，如未安装请执行：`sudo apt install xclip`

### 4. 快速定位文件夹

按 `Ctrl+Alt+E` 弹出文件夹搜索列表，选中后在资源管理器中展开对应目录。

### 5. 自动设置 PyCharm 风格

插件激活时自动应用以下全局设置：

| 设置项 | 值 |
|--------|----|
| 主题 | JetBrains Darcula Theme |
| 字体 | JetBrains Mono, 14px |
| 字体连字 | 启用 |

字体设置覆盖：编辑器、终端、调试控制台、Notebook、Chat、Markdown 预览、GitLens 等所有区域。

**首次激活时**，如果未安装 Darcula 主题或 JetBrains Mono 字体，插件会弹窗提示：
- 主题：点击提示可跳转到扩展商店搜索 **JetBrains Darcula Theme**
- 字体：Ubuntu 用户可执行 `sudo apt install fonts-jetbrains-mono`，或访问 [JetBrains Mono 官方下载页](https://www.jetbrains.com/lp/mono/#how-to-install)

### 6. 自动设置用户配置

插件激活时自动应用以下 VS Code 全局配置：

| 设置项 | 值 | 说明 |
|--------|-----|------|
| `workbench.tree.expandMode` | `doubleClick` | 文件树双击展开 |
| `workbench.list.openMode` | `doubleClick` | 双击才打开文件 |
| `explorer.compactFolders` | `false` | 禁用紧凑文件夹（每层单独显示） |
| `workbench.editor.pinnedTabsOnSeparateRow` | `true` | 固定标签页独立一行 |

同时自动关闭辅助侧边栏（Auxiliary Side Bar）。

### 7. 自动快捷键绑定

#### 通过 package.json 注册的快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+C` | 复制文件引用 |
| `Ctrl+Shift+Q` | Run to Cursor（调试） |
| `Ctrl+Q` | 关闭所有 Diff 编辑器（替代默认的退出） |
| `Ctrl+D` | 固定当前标签页（替代默认的选中下一个匹配） |
| `Ctrl+Shift+Alt+F` | 格式化选中内容 |
| `Shift+Enter`（终端中） | 发送换行但不执行（用于多行输入） |

#### 通过 keybindings.json 自动写入的快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Alt+E` | 搜索并在资源管理器中展开文件夹 |


